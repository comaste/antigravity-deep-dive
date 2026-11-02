"""
Notionの全ページを取得し、差分更新を行って data/store.json に保存する同期スクリプト。
画像ブロックが含まれる場合は Gemini で内容・文字をテキスト化して含める。
Geminiクライアントは gemini_client.py で一元管理（API Key / Vertex AI 自動切替）。
"""

import os
import json
import time
import datetime
import requests
from dotenv import load_dotenv

# .env を読み込み
load_dotenv()

NOTION_TOKEN = os.getenv("NOTION_TOKEN")

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}
NOTION_BASE_URL = "https://api.notion.com/v1"
STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "store.json")
META_PATH = os.path.join(os.path.dirname(__file__), "data", "meta.json")


def describe_image_with_gemini(image_url):
    """画像URLをダウンロードし、Geminiで写っている文字と内容をテキスト化する。"""
    from token_tracker import check_budget

    blocked, block_msg = check_budget()
    if blocked:
        return f"[画像解析スキップ: トークン上限到達]"

    try:
        res = requests.get(image_url, timeout=20)
        res.raise_for_status()
        image_bytes = res.content
        mime_type = res.headers.get("Content-Type", "image/png").split(";")[0].strip()
        if not mime_type.startswith("image/"):
            mime_type = "image/png"

        from gemini_client import generate_with_image
        prompt = (
            "この画像に含まれるテキスト（OCR）と、画像が表している図表・写真の内容や要点を"
            "日本語で詳しく読み取って簡潔に記述してください。"
        )
        result, alert = generate_with_image(image_bytes, mime_type, prompt, caller="sync_image")
        if alert.get("alert") == "warn":
            print(f"  {alert['message']}")
        return result

    except Exception as e:
        print(f"[警告] 画像のGemini解析に失敗しました: {e}")
        return f"[画像: {image_url} (解析エラー: {e})]"


def search_all_notion_pages():
    """Notionから連携されている全ページを取得する。"""
    pages = []
    payload = {"filter": {"property": "object", "value": "page"}, "page_size": 100}
    has_more = True

    while has_more:
        resp = requests.post(f"{NOTION_BASE_URL}/search", headers=NOTION_HEADERS, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        pages.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        if has_more:
            payload["start_cursor"] = data["next_cursor"]

    return pages


def get_page_title(page):
    """Notionページオブジェクトからタイトルを取得する。"""
    props = page.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            title_parts = prop.get("title", [])
            return "".join(t.get("plain_text", "") for t in title_parts)

    child_page = page.get("child_page", {})
    if child_page.get("title"):
        return child_page["title"]

    return "(無題)"


def extract_rich_text(rich_text_list):
    """rich_text リストから文字列を結合して取得。"""
    return "".join(rt.get("plain_text", "") for rt in rich_text_list)


def fetch_text_file_content(file_url, file_name=""):
    """添付テキストファイル（.py, .txt, .csv, .md, .json等）の内容をダウンロードしてテキスト化する。"""
    try:
        res = requests.get(file_url, timeout=15)
        res.raise_for_status()
        # UTF-8でデコード
        text = res.content.decode("utf-8", errors="replace")
        ext = os.path.splitext(file_name)[1].lower().replace(".", "") or "txt"
        truncated_text = text[:5000]
        if len(text) > 5000:
            truncated_text += "\n... (以降省略)"
        return f"\n[添付ファイル: {file_name}]\n```{ext}\n{truncated_text}\n```\n"
    except Exception as e:
        return f"[添付ファイル: {file_name} (取得エラー: {e})]"


def extract_block_content(block):
    """1つのブロックからテキストまたは画像解析テキストを取得する。"""
    btype = block.get("type", "")
    body = block.get(btype, {})

    if "rich_text" in body:
        text = extract_rich_text(body.get("rich_text", []))
        if btype.startswith("heading_"):
            return f"\n### {text}\n"
        return text

    if btype == "table_row":
        cells = body.get("cells", [])
        return " | ".join(extract_rich_text(cell) for cell in cells)

    if btype == "code":
        text = extract_rich_text(body.get("rich_text", []))
        lang = body.get("language", "")
        return f"```{lang}\n{text}\n```"

    if btype == "to_do":
        checked = "[x]" if body.get("checked") else "[ ]"
        return f"{checked} {extract_rich_text(body.get('rich_text', []))}"

    # 画像ブロックのGemini連携
    if btype == "image":
        img_type = body.get("type", "")
        img_url = ""
        if img_type == "external":
            img_url = body.get("external", {}).get("url", "")
        elif img_type == "file":
            img_url = body.get("file", {}).get("url", "")

        if img_url:
            print(f"       -> 画像ブロックを検出。Geminiでテキスト化中...")
            return describe_image_with_gemini(img_url)
        return "[画像: URLなし]"

    # ファイルブロック（スクリプト、ソースコード、テキスト等の内容抽出）
    if btype == "file":
        f_type = body.get("type", "")
        furl = ""
        if f_type == "file":
            furl = body.get("file", {}).get("url", "")
        elif f_type == "external":
            furl = body.get("external", {}).get("url", "")
        fname = body.get("name", "")

        text_extensions = (".py", ".txt", ".csv", ".tsv", ".md", ".json", ".yaml", ".yml", ".sh", ".sql", ".js", ".html")
        if furl and any(fname.lower().endswith(ext) for ext in text_extensions):
            print(f"       -> 添付ファイル '{fname}' のテキスト内容を取得中...")
            return fetch_text_file_content(furl, fname)
        elif furl:
            return f"[添付ファイル: {fname} ({furl[:80]}...)]"
        return f"[添付ファイル: {fname}]"

    if btype == "child_page":
        return f"[子ページ: {body.get('title', '')}]"

    if btype == "child_database":
        return f"[子データベース: {body.get('title', '')}]"

    if btype in ("pdf", "video"):
        furl = body.get(body.get("type", ""), {}).get("url", "")
        return f"[{btype}: {furl}]"

    if btype == "bookmark":
        return f"[ブックマーク: {body.get('url', '')}]"

    if btype == "divider":
        return "---"

    return ""


def fetch_blocks_recursive(block_id, max_retries=3):
    """ブロックの子要素を再帰的に取得してテキストリストを返す。"""
    lines = []
    start_cursor = None
    has_more = True

    while has_more:
        url = f"{NOTION_BASE_URL}/blocks/{block_id}/children?page_size=100"
        if start_cursor:
            url += f"&start_cursor={start_cursor}"

        data = None
        for attempt in range(max_retries):
            try:
                resp = requests.get(url, headers=NOTION_HEADERS, timeout=20)
                if resp.status_code in (429, 500, 502, 503, 504):
                    time.sleep(1.5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                if attempt == max_retries - 1:
                    lines.append(f"[ブロック取得エラー: {e}]")
                    return lines
                time.sleep(1.5 * (attempt + 1))

        if not data:
            break

        for block in data.get("results", []):
            content = extract_block_content(block)
            if content:
                lines.append(content)

            if block.get("has_children"):
                sub_lines = fetch_blocks_recursive(block["id"], max_retries=max_retries)
                lines.extend(sub_lines)

        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")

    return lines


def load_existing_store():
    """既存の store.json をロードする。"""
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
        print(f"[警告] store.json の読み込みエラー: {e}")
    return []


def save_store(pages):
    """ページのリストを store.json および meta.json に保存する。"""
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    with open(STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(pages, f, ensure_ascii=False, indent=2)

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    meta = {
        "last_synced_at": now_iso,
        "total_pages": len(pages),
    }
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def sync():
    """Notionの全ページを取得し、更新差分のみ再取得して保存する。"""
    if not NOTION_TOKEN:
        print("エラー: .env に NOTION_TOKEN が設定されていません。")
        return {"status": "error", "message": "NOTION_TOKEN が設定されていません。"}

    print("🔄 Notionとの同期を開始します...")
    existing_items = load_existing_store()
    existing_map = {}
    for item in existing_items:
        key = item.get("id") or item.get("url")
        if key:
            existing_map[key] = item

    notion_pages = search_all_notion_pages()
    print(f"Notion上の全ページ数: {len(notion_pages)}")

    updated_count = 0
    skipped_count = 0
    synced_items = []

    for i, page in enumerate(notion_pages, 1):
        page_id = page["id"]
        last_edited = page.get("last_edited_time", "")
        url = page.get("url", "")
        title = get_page_title(page)

        existing = existing_map.get(page_id) or existing_map.get(url)

        # 差分判定: 既存に存在し、更新日時が一致し、すでにベクトル化済みであればスキップ
        if existing and existing.get("updated") == last_edited and existing.get("embedding"):
            print(f"[{i}/{len(notion_pages)}] ⏭️ スキップ（変更なし・ベクトル化済）: {title}")
            synced_items.append(existing)
            skipped_count += 1
            continue

        # 本文が既にあり、embedding のみ欠落している場合は本文再取得を省略
        if existing and existing.get("updated") == last_edited and existing.get("text"):
            full_text = existing.get("text", "")
            print(f"[{i}/{len(notion_pages)}] 🔄 ベクトル化実行中（本文再利用）: {title} ...")
        else:
            print(f"[{i}/{len(notion_pages)}] 📥 取得中（新規または更新あり）: {title} ...")
            body_lines = fetch_blocks_recursive(page_id)
            full_text = "\n".join(body_lines).strip()

        # Gemini 埋め込みモデル（gemini-embedding-2, 768次元）でベクトル化
        from gemini_client import get_embedding
        embed_input = f"{title}\n\n{full_text}".strip()
        embedding = get_embedding(embed_input, output_dimensionality=768, caller="sync_embedding")

        item = {
            "id": page_id,
            "source": "notion",
            "title": title,
            "updated": last_edited,
            "url": url,
            "text": full_text,
            "embedding": embedding,
        }
        synced_items.append(item)
        updated_count += 1
        time.sleep(0.3)

    save_store(synced_items)
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    summary = f"同期完了 ({now_str}): 新規/更新 {updated_count}件、スキップ {skipped_count}件、合計 {len(synced_items)}件"
    print(f"✅ {summary}")
    return {
        "status": "success",
        "message": summary,
        "updated_count": updated_count,
        "skipped_count": skipped_count,
        "total_count": len(synced_items),
        "last_synced_at": now_str,
    }


if __name__ == "__main__":
    sync()
