"""
トークン使用量のトラッキング・永続化・アラート管理。
data/token_usage.json に日次・累積の使用量を保存し、閾値超過時にアラートを返す。
"""

import os
import json
import datetime

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
USAGE_PATH = os.path.join(DATA_DIR, "token_usage.json")

# デフォルト上限（.env の TOKEN_DAILY_LIMIT で上書き可能）
DEFAULT_DAILY_LIMIT = 100_000  # 1日あたりのトークン上限
WARN_THRESHOLD = 0.8           # 80% で警告


def _today_str():
    return datetime.date.today().isoformat()


def load_usage():
    """使用量データを読み込む。"""
    if not os.path.exists(USAGE_PATH):
        return {"daily": {}, "total_input": 0, "total_output": 0, "total_requests": 0}
    try:
        with open(USAGE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"daily": {}, "total_input": 0, "total_output": 0, "total_requests": 0}


def save_usage(usage):
    """使用量データを保存する。"""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(USAGE_PATH, "w", encoding="utf-8") as f:
        json.dump(usage, f, ensure_ascii=False, indent=2)


def get_daily_limit():
    """日次トークン上限を取得する。"""
    try:
        return int(os.getenv("TOKEN_DAILY_LIMIT", DEFAULT_DAILY_LIMIT))
    except (ValueError, TypeError):
        return DEFAULT_DAILY_LIMIT


def record_usage(input_tokens, output_tokens, model="", caller=""):
    """
    トークン使用量を記録し、アラート情報を返す。

    Returns:
        dict: {"alert": None|"warn"|"block", "message": str, "daily_used": int, "daily_limit": int}
    """
    usage = load_usage()
    today = _today_str()

    # 日次レコードを更新
    if today not in usage["daily"]:
        usage["daily"][today] = {"input": 0, "output": 0, "requests": 0, "history": []}

    day = usage["daily"][today]
    day["input"] += input_tokens
    day["output"] += output_tokens
    day["requests"] += 1

    # 直近のリクエスト履歴を追加（最大50件保持）
    day["history"].append({
        "time": datetime.datetime.now().strftime("%H:%M:%S"),
        "model": model,
        "caller": caller,
        "input": input_tokens,
        "output": output_tokens,
    })
    if len(day["history"]) > 50:
        day["history"] = day["history"][-50:]

    # 累積を更新
    usage["total_input"] = usage.get("total_input", 0) + input_tokens
    usage["total_output"] = usage.get("total_output", 0) + output_tokens
    usage["total_requests"] = usage.get("total_requests", 0) + 1

    # 古い日次データを7日分だけ保持
    sorted_days = sorted(usage["daily"].keys(), reverse=True)
    if len(sorted_days) > 7:
        for old_day in sorted_days[7:]:
            del usage["daily"][old_day]

    save_usage(usage)

    # アラート判定
    daily_limit = get_daily_limit()
    daily_used = day["input"] + day["output"]
    ratio = daily_used / daily_limit if daily_limit > 0 else 0

    alert_info = {
        "alert": None,
        "message": "",
        "daily_used": daily_used,
        "daily_limit": daily_limit,
        "ratio": ratio,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }

    if ratio >= 1.0:
        alert_info["alert"] = "block"
        alert_info["message"] = (
            f"🚨 日次トークン上限に到達しました！"
            f"（{daily_used:,} / {daily_limit:,} トークン = {ratio:.0%}）"
            f"\n新しいAPI呼び出しはブロックされます。"
            f"\n上限を変更する場合は .env の TOKEN_DAILY_LIMIT を変更してください。"
        )
    elif ratio >= WARN_THRESHOLD:
        alert_info["alert"] = "warn"
        alert_info["message"] = (
            f"⚠️ 日次トークン使用量が {ratio:.0%} に達しています"
            f"（{daily_used:,} / {daily_limit:,} トークン）"
        )

    return alert_info


def check_budget():
    """
    APIリクエスト実行前にバジェットを確認する。
    上限到達時は True（ブロック）を返す。

    Returns:
        tuple: (should_block: bool, message: str)
    """
    usage = load_usage()
    today = _today_str()
    day = usage.get("daily", {}).get(today, {"input": 0, "output": 0})
    daily_used = day.get("input", 0) + day.get("output", 0)
    daily_limit = get_daily_limit()

    if daily_limit > 0 and daily_used >= daily_limit:
        return True, (
            f"🚨 日次トークン上限（{daily_limit:,}）に到達済みのため、"
            f"APIリクエストをブロックしました。"
            f"\n.env の TOKEN_DAILY_LIMIT で上限を変更できます。"
        )
    return False, ""


def get_usage_summary():
    """現在の使用量サマリーを返す（UI表示用）。"""
    usage = load_usage()
    today = _today_str()
    day = usage.get("daily", {}).get(today, {"input": 0, "output": 0, "requests": 0})
    daily_limit = get_daily_limit()
    daily_used = day.get("input", 0) + day.get("output", 0)
    ratio = daily_used / daily_limit if daily_limit > 0 else 0

    return {
        "today": today,
        "daily_input": day.get("input", 0),
        "daily_output": day.get("output", 0),
        "daily_total": daily_used,
        "daily_requests": day.get("requests", 0),
        "daily_limit": daily_limit,
        "ratio": ratio,
        "total_input": usage.get("total_input", 0),
        "total_output": usage.get("total_output", 0),
        "total_requests": usage.get("total_requests", 0),
        "history": day.get("history", []),
    }
