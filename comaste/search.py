"""
DocProbe 2段階検索スクリプト:
1. 第1段階 (ベクトル検索):
   質問をGemini埋め込みモデル (gemini-embedding-2, 768次元) でベクトル化し、
   data/store.json 内の各ページとのコサイン類似度を算出。上位5件を抽出。
2. 第2段階 (LLM生成):
   コサイン類似度の上位5件のみを gemini-3.8-flash に渡し、
   最新版判定・3行要約・詳細回答を生成。
"""

import os
import sys
import json
import numpy as np
from dotenv import load_dotenv

load_dotenv()

STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "store.json")


def load_store():
    """data/store.json から同期済みページデータを読み込む。"""
    if not os.path.exists(STORE_PATH):
        return []
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "pages" in data:
                return data["pages"]
    except Exception as e:
        print(f"[エラー] store.json 読み込み失敗: {e}")
    return []


def compute_cosine_similarity(v1, v2):
    """2つのベクトルのコサイン類似度を計算する。"""
    if not v1 or not v2:
        return 0.0
    a = np.array(v1, dtype=np.float32)
    b = np.array(v2, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def search(query, pages=None, top_k=5):
    """
    2段階検索を実行する。
    1. ベクトル検索 (Top-K 抽出)
    2. LLM (gemini-3.8-flash) による最新版判定 & 3行要約

    Returns:
        tuple: (result_text: str, top_candidates: list[dict], alert_info: dict|None)
    """
    if pages is None:
        pages = load_store()

    if not pages:
        msg = "⚠️ 同期されたデータがありません。先に sync.py を実行するか、画面の「今すぐ同期」を行ってください。"
        return msg, [], None

    from gemini_client import get_embedding, generate

    # --- 第1段階: 質問のベクトル化と類似度計算 ---
    print(f"[第1段階] クエリをベクトル化中: '{query}'")
    query_vector = get_embedding(query, output_dimensionality=768, caller="search_query_embedding")

    scored_pages = []
    for p in pages:
        page_vec = p.get("embedding")
        # embedding が未計算の場合はオンデマンドで生成
        if not page_vec:
            embed_text = f"{p.get('title', '')}\n\n{p.get('text', '')}".strip()
            page_vec = get_embedding(embed_text, output_dimensionality=768, caller="ondemand_embedding")
            p["embedding"] = page_vec

        score = compute_cosine_similarity(query_vector, page_vec)
        scored_pages.append({
            "id": p.get("id"),
            "title": p.get("title", "(無題)"),
            "url": p.get("url", ""),
            "updated": p.get("updated", ""),
            "source": p.get("source", "notion"),
            "text": p.get("text", ""),
            "score": score,
        })

    # スコア降順にソートして上位 top_k 件を取得
    scored_pages.sort(key=lambda x: x["score"], reverse=True)
    top_candidates = scored_pages[:top_k]

    print(f"[第1段階完了] 上位 {len(top_candidates)} 件の候補を抽出:")
    for rank, cand in enumerate(top_candidates, 1):
        print(f"  #{rank} [類似度: {cand['score']:.4f}] {cand['title']}")

    # --- 第2段階: 上位候補のみをGemini (gemini-3.8-flash) に渡して要約・判定 ---
    print("[第2段階] 上位候補をGeminiに渡し、最新版判定・要約を生成中...")

    candidates_context_list = []
    for rank, c in enumerate(top_candidates, 1):
        ctx = (
            f"--- 候補 [{rank}] (類似度スコア: {c['score']:.4f}) ---\n"
            f"タイトル: {c['title']}\n"
            f"最終更新日: {c['updated']}\n"
            f"URL: {c['url']}\n"
            f"本文テキスト:\n{c['text']}\n"
        )
        candidates_context_list.append(ctx)

    context_str = "\n".join(candidates_context_list)

    system_prompt = (
        "あなたは研究室の資料探査アシスタント「DocProbe」です。\n"
        "ベクトル検索によって抽出された上位の関連候補ドキュメント（類似度スコア順）を精査し、"
        "ユーザーの質問に対して回答してください。\n\n"
        "【回答構成】\n"
        "1. **結論・該当ドキュメント**: 関連するドキュメントと各類似度スコア・リンク\n"
        "2. **最新版判定**: 同種・同テーマの手順書や資料に複数バージョン（旧版、最終版、下書きなど）がある場合、"
        "どれが現在有効な最新正式版であるか、古い版や下書きとの差異を踏まえて明確に判定・解説。\n"
        "3. **3行要約**: 最も重要なドキュメント、または各候補について、要点を『3行要約』として端的に提示。\n"
        "4. **詳細ポイント**: 質問に対する具体的な回答や重要な注意点。"
    )

    user_prompt = (
        f"【ベクトル検索で抽出された上位候補ドキュメント】\n{context_str}\n\n"
        f"【ユーザーの質問】\n{query}\n\n"
        "上記指示に従って、丁寧でわかりやすい日本語で回答してください。"
    )

    result_text, alert_info = generate(
        contents=[system_prompt, user_prompt],
        caller="search_summary",
        models_to_try=("gemini-3.8-flash", "gemini-3.5-flash")
    )

    return result_text, top_candidates, alert_info


def main():
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
    else:
        query = input("🔍 検索クエリを入力してください: ").strip()

    if not query:
        print("クエリが入力されていません。")
        return

    print(f"\n検索実行中: '{query}' ...\n")
    result_text, candidates, alert = search(query)

    print("=" * 60)
    print("【第1段階: ベクトル検索結果 (Top 5)】")
    for i, c in enumerate(candidates, 1):
        print(f"  {i}. [{c['score']:.4f}] {c['title']} ({c['updated']})")
    print("=" * 60)
    print("【第2段階: Geminiによる最新版判定 & 3行要約】")
    print(result_text)
    print("=" * 60)

    if alert and alert.get("alert"):
        print(f"\n{alert['message']}")


if __name__ == "__main__":
    main()
