"""
Notion APIで連携済みの全ページを取得し、
タイトル・最終更新日・URL・本文テキスト（子ブロック含む）を表示する。
"""

import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

NOTION_TOKEN = os.getenv("NOTION_TOKEN")
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}
BASE_URL = "https://api.notion.com/v1"


def search_all_pages():
    """連携が共有されている全ページを検索して返す。デバッグ情報（ステータスコード、最初のレスポンス）も返す。"""
    pages = []
    payload = {"filter": {"property": "object", "value": "page"}, "page_size": 100}
    has_more = True
    first_resp_info = None

    while has_more:
        try:
            resp = requests.post(f"{BASE_URL}/search", headers=HEADERS, json=payload)
        except Exception as e:
            return pages, None, f"リクエスト送信エラー: {e}"

        if first_resp_info is None:
            first_resp_info = {
                "status_code": resp.status_code,
                "text": resp.text,
            }

        if not resp.ok:
            return pages, first_resp_info, f"HTTPエラー: {resp.status_code}"

        data = resp.json()
        pages.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        if has_more:
            payload["start_cursor"] = data["next_cursor"]

    return pages, first_resp_info, None


def get_page_title(page):
    """ページオブジェクトからタイトル文字列を取得する。"""
    # データベース内のページ
    props = page.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            title_parts = prop.get("title", [])
            return "".join(t.get("plain_text", "") for t in title_parts)

    # 子ページ（child_page タイプ）
    child_page = page.get("child_page", {})
    if child_page.get("title"):
        return child_page["title"]

    return "(無題)"


def extract_rich_text(rich_text_list):
    """rich_text 配列からプレーンテキストを結合して返す。"""
    return "".join(rt.get("plain_text", "") for rt in rich_text_list)


def extract_block_text(block):
    """1つのブロックからテキストを抽出する。"""
    btype = block.get("type", "")
    body = block.get(btype, {})

    # rich_text を持つブロック（paragraph, heading, list, quote, callout, toggle 等）
    if "rich_text" in body:
        return extract_rich_text(body["rich_text"])

    # テーブル行
    if btype == "table_row":
        cells = body.get("cells", [])
        return " | ".join(extract_rich_text(cell) for cell in cells)

    # コードブロック
    if btype == "code":
        text = extract_rich_text(body.get("rich_text", []))
        lang = body.get("language", "")
        return f"[code:{lang}] {text}"

    # To-do
    if btype == "to_do":
        checked = "☑" if body.get("checked") else "☐"
        return f"{checked} {extract_rich_text(body.get('rich_text', []))}"

    # 子ページ・子DB
    if btype == "child_page":
        return f"[子ページ] {body.get('title', '')}"
    if btype == "child_database":
        return f"[子DB] {body.get('title', '')}"

    # 画像・ファイル等
    if btype in ("image", "file", "pdf", "video"):
        url = ""
        if body.get("type") == "external":
            url = body.get("external", {}).get("url", "")
        elif body.get("type") == "file":
            url = body.get("file", {}).get("url", "")[:80] + "..."
        return f"[{btype}] {url}"

    # ブックマーク・埋め込み
    if btype == "bookmark":
        return f"[bookmark] {body.get('url', '')}"
    if btype == "embed":
        return f"[embed] {body.get('url', '')}"

    # 区切り線など
    if btype == "divider":
        return "---"

    return ""


def fetch_blocks_text(block_id, indent=0, max_retries=3):
    """ブロックの子要素を再帰的に取得してテキストのリストを返す。一時的なエラー（502, 504, 429など）はリトライする。"""
    lines = []
    start_cursor = None
    has_more = True
    prefix = "  " * indent

    while has_more:
        url = f"{BASE_URL}/blocks/{block_id}/children?page_size=100"
        if start_cursor:
            url += f"&start_cursor={start_cursor}"

        data = None
        for attempt in range(max_retries):
            try:
                resp = requests.get(url, headers=HEADERS, timeout=15)
                if resp.status_code in (429, 500, 502, 503, 504):
                    time.sleep(1.5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                if attempt == max_retries - 1:
                    lines.append(f"{prefix}[子ブロック取得エラー: {e}]")
                    return lines
                time.sleep(1.5 * (attempt + 1))

        if not data:
            break

        for block in data.get("results", []):
            text = extract_block_text(block)
            if text:
                lines.append(f"{prefix}{text}")

            # 子ブロックがあれば再帰的に取得
            if block.get("has_children"):
                lines.extend(fetch_blocks_text(block["id"], indent + 1, max_retries=max_retries))

        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")

    return lines


def main():
    if not NOTION_TOKEN:
        print("エラー: .env に NOTION_TOKEN が設定されていません。")
        return

    print("Notion API からページを取得中...\n")
    pages, resp_info, err = search_all_pages()

    if err:
        print(f"❌ エラーが発生しました: {err}")
        if resp_info:
            print(f"ステータスコード: {resp_info['status_code']}")
            print(f"レスポンス本文:\n{resp_info['text']}")
        return

    print(f"取得ページ数: {len(pages)}\n")

    if len(pages) == 0:
        print("⚠️ 取得されたページが0件でした。デバッグ情報を表示します。")
        if resp_info:
            print(f"ステータスコード: {resp_info['status_code']}")
            print(f"レスポンス本文:\n{resp_info['text']}")
        print("=" * 60)
        return

    print("=" * 60)

    for i, page in enumerate(pages, 1):
        title = get_page_title(page)
        last_edited = page.get("last_edited_time", "不明")
        url = page.get("url", "不明")

        print(f"\n📄 [{i}] {title}")
        print(f"   最終更新: {last_edited}")
        print(f"   URL: {url}")
        print(f"   --- 本文 ---")

        body_lines = fetch_blocks_text(page["id"])
        if body_lines:
            for line in body_lines:
                print(f"   {line}")
        else:
            print("   (本文なし)")

        print("-" * 60)

    print(f"\n✅ 全 {len(pages)} ページの取得が完了しました。")


if __name__ == "__main__":
    main()
