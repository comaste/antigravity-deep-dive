"""
Geminiクライアントの一元管理モジュール。
- API Key と Vertex AI (Google Cloud) の自動切替
- トークン使用量トラッキングの統合
- フォールバック付きモデル呼び出し
"""

import os
import time
from dotenv import load_dotenv
from token_tracker import record_usage, check_budget

load_dotenv()

# Gemini クライアントのシングルトン
_client = None
_backend = None  # "apikey" or "vertexai"


def get_client():
    """
    Geminiクライアントを初期化して返す。
    環境変数に応じて API Key モードと Vertex AI モードを自動切替する。

    優先順位:
      1. GOOGLE_CLOUD_PROJECT が設定されている → Vertex AI (ADC認証)
      2. GEMINI_API_KEY が設定されている → API Key モード
    """
    global _client, _backend
    if _client is not None:
        return _client, _backend

    from google import genai

    gcp_project = os.getenv("GOOGLE_CLOUD_PROJECT")
    gcp_location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    api_key = os.getenv("GEMINI_API_KEY")

    if gcp_project:
        try:
            _client = genai.Client(
                vertexai=True,
                project=gcp_project,
                location=gcp_location,
            )
            _backend = "vertexai"
            print(f"[Gemini] Vertex AI モードで初期化 (project={gcp_project}, location={gcp_location})")
            return _client, _backend
        except Exception as e:
            print(f"[Gemini] Vertex AI 初期化エラー: {e} → API Key モードにフォールバックします")

    if api_key:
        _client = genai.Client(api_key=api_key)
        _backend = "apikey"
        print("[Gemini] API Key モードで初期化")
        return _client, _backend

    raise RuntimeError(
        "Geminiクライアントを初期化できません。\n"
        ".env に GEMINI_API_KEY または GOOGLE_CLOUD_PROJECT を設定してください。"
    )


def _extract_token_counts(response):
    """レスポンスからトークン使用量を取得する。"""
    input_tokens = 0
    output_tokens = 0
    try:
        um = response.usage_metadata
        if um:
            input_tokens = getattr(um, "prompt_token_count", 0) or 0
            output_tokens = getattr(um, "candidates_token_count", 0) or 0
    except Exception:
        pass
    return input_tokens, output_tokens


def generate(contents, caller="unknown", models_to_try=("gemini-3.8-flash", "gemini-3.5-flash")):
    """
    Geminiモデルを呼び出してテキストを返す。
    - バジェット超過チェック
    - 複数モデルのフォールバック
    - トークン使用量の記録とアラート

    Returns:
        tuple: (result_text: str, alert_info: dict)
    """
    # バジェット確認
    blocked, block_msg = check_budget()
    if blocked:
        return block_msg, {"alert": "block", "message": block_msg}

    client, backend = get_client()
    last_err = None
    used_model = ""

    for model_name in models_to_try:
        try:
            print(f"[Gemini] モデル '{model_name}' を呼び出し中... (backend={backend})")
            timeout_ms = 10000 if model_name == "gemini-3.8-flash" else 30000
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config={"http_options": {"timeout": timeout_ms}}
            )
            used_model = model_name

            # トークン使用量を記録
            input_tokens, output_tokens = _extract_token_counts(response)
            alert_info = record_usage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model=model_name,
                caller=caller,
            )

            print(
                f"[Gemini] '{model_name}' 応答OK "
                f"(in={input_tokens:,}, out={output_tokens:,}, "
                f"日次合計={alert_info['daily_used']:,}/{alert_info['daily_limit']:,})"
            )

            if alert_info.get("alert"):
                print(f"[トークン警告] {alert_info['message']}")

            return response.text, alert_info

        except Exception as e:
            last_err = e
            print(f"[Gemini] '{model_name}' エラー: {e} → 次のモデルを試行します")
            continue

    error_msg = f"❌ Gemini API エラー（全モデル失敗）: {last_err}"
    return error_msg, {"alert": "error", "message": error_msg}


def generate_with_image(image_bytes, mime_type, prompt, caller="image_analysis"):
    """
    画像をGeminiに渡してテキスト化する。

    Returns:
        tuple: (result_text: str, alert_info: dict)
    """
    blocked, block_msg = check_budget()
    if blocked:
        return f"[画像解析スキップ: {block_msg}]", {"alert": "block", "message": block_msg}

    from google.genai import types
    part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

    client, backend = get_client()
    last_err = None

    for model_name in ("gemini-3.8-flash", "gemini-3.5-flash"):
        try:
            timeout_ms = 10000 if model_name == "gemini-3.8-flash" else 30000
            response = client.models.generate_content(
                model=model_name,
                contents=[part, prompt],
                config={"http_options": {"timeout": timeout_ms}}
            )

            input_tokens, output_tokens = _extract_token_counts(response)
            alert_info = record_usage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model=model_name,
                caller=caller,
            )

            result = f"[画像解析 ({model_name}): {response.text.strip()}]"
            if alert_info.get("alert"):
                print(f"[トークン警告] {alert_info['message']}")
            return result, alert_info

        except Exception as e:
            last_err = e
            print(f"[画像解析] {model_name} エラー: {e}")
            continue

    return f"[画像解析エラー: {last_err}]", {"alert": "error", "message": str(last_err)}


def get_embedding(text, models_to_try=("gemini-embedding-2", "gemini-embedding-001"), output_dimensionality=768, caller="embedding"):
    """
    Gemini埋め込みモデルを用いてテキストをベクトル化する（デフォルト768次元）。

    Returns:
        list[float]: 埋め込みベクトル
    """
    if not text or not text.strip():
        return [0.0] * output_dimensionality

    blocked, block_msg = check_budget()
    if blocked:
        print(f"[埋め込みスキップ] {block_msg}")
        return [0.0] * output_dimensionality

    from google.genai import types
    client, backend = get_client()
    last_err = None

    # 長すぎるテキストは先頭8000文字程度にトリム（モデル上限対策）
    trimmed_text = text[:8000].strip()

    for model_name in models_to_try:
        try:
            config = types.EmbedContentConfig(output_dimensionality=output_dimensionality)
            resp = client.models.embed_content(
                model=model_name,
                contents=trimmed_text,
                config=config,
            )
            if resp.embeddings and len(resp.embeddings) > 0:
                values = resp.embeddings[0].values
                # トークン使用量（大まかに文字数換算または記録）
                record_usage(
                    input_tokens=len(trimmed_text) // 2,
                    output_tokens=0,
                    model=model_name,
                    caller=caller,
                )
                return values
        except Exception as e:
            last_err = e
            print(f"[埋め込み] モデル '{model_name}' エラー: {e} -> 次を試行")
            continue

    print(f"[警告] 埋め込み生成に失敗しました: {last_err}")
    return [0.0] * output_dimensionality


def get_backend_info():
    """現在のバックエンド情報を返す（UI表示用）。"""
    try:
        _, backend = get_client()
    except Exception:
        backend = "未接続"

    gcp_project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    gcp_location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    return {
        "backend": backend,
        "gcp_project": gcp_project,
        "gcp_location": gcp_location,
        "has_api_key": bool(os.getenv("GEMINI_API_KEY")),
        "has_gcp_project": bool(gcp_project),
    }
