"""
プロジェクトフォルダ内の3ファイルを、Notion APIの file_uploads 機能を使い
対応するNotionページの末尾に追加するスクリプト。
・whiteboard_memo.png → 「④ゼミ議事録 2026年10月」
・lineA3_resistivity_curve.png → 「⑤解析コードの使い方」
・tem_inversion_demo.py → 「⑤解析コードの使い方」
"""

import os
import sys
import mimetypes
import requests
from dotenv import load_dotenv

load_dotenv()

NOTION_TOKEN = os.getenv("NOTION_TOKEN")
if not NOTION_TOKEN:
    print("エラー: .env に NOTION_TOKEN が設定されていません。")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
}
BASE_URL = "https://api.notion.com/v1"
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


def search_page_id_by_title(target_title):
    """タイトルでNotionページを検索し、最も合致するページIDを返す。"""
    payload = {
        "query": target_title,
        "filter": {"property": "object", "value": "page"},
        "page_size": 20,
    }
    resp = requests.post(f"{BASE_URL}/search", headers={**HEADERS, "Content-Type": "application/json"}, json=payload)
    resp.raise_for_status()
    results = resp.json().get("results", [])

    for page in results:
        # タイトルプロパティをチェック
        props = page.get("properties", {})
        for p in props.values():
            if p.get("type") == "title":
                title = "".join(t.get("plain_text", "") for t in p.get("title", []))
                if target_title in title or title in target_title:
                    return page["id"], title

        # child_page の場合
        child_title = page.get("child_page", {}).get("title", "")
        if child_title and (target_title in child_title or child_title in target_title):
            return page["id"], child_title

    raise ValueError(f"ページが見つかりませんでした: '{target_title}'")


def upload_file_to_notion(file_path):
    """
    Notion File Upload API (file_uploads) を使用してファイルをアップロードし、
    file_upload_id を返す。
    """
    filename = os.path.basename(file_path)
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        mime_type = "application/octet-stream"
    if file_path.endswith(".py"):
        mime_type = "text/x-python"

    print(f"  [Step 1] file_uploads オブジェクト作成: {filename} ({mime_type}) ...")
    create_payload = {
        "mode": "single_part",
        "filename": filename,
        "content_type": mime_type,
    }
    create_resp = requests.post(
        f"{BASE_URL}/file_uploads",
        headers={**HEADERS, "Content-Type": "application/json"},
        json=create_payload,
        timeout=30,
    )
    create_resp.raise_for_status()
    file_upload_data = create_resp.json()
    file_upload_id = file_upload_data["id"]
    print(f"          -> 作成成功 (ID: {file_upload_id})")

    print(f"  [Step 2] ファイル本体を送信中: {filename} ...")
    with open(file_path, "rb") as f:
        send_resp = requests.post(
            f"{BASE_URL}/file_uploads/{file_upload_id}/send",
            headers=HEADERS,
            files={"file": (filename, f, mime_type)},
            timeout=60,
        )
    send_resp.raise_for_status()
    print(f"          -> 送信完了！")

    return file_upload_id


def append_block_to_page(page_id, block_type, file_upload_id):
    """ページの末尾に画像またはファイルブロックを追加する。"""
    print(f"  [Step 3] ページに {block_type} ブロックとしてアペンド中...")
    block_data = {
        "object": "block",
        "type": block_type,
        block_type: {
            "type": "file_upload",
            "file_upload": {
                "id": file_upload_id,
            },
        },
    }

    resp = requests.patch(
        f"{BASE_URL}/blocks/{page_id}/children",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"children": [block_data]},
        timeout=30,
    )
    resp.raise_for_status()
    print(f"          -> ページへのアペンド成功！")


def main():
    tasks = [
        {
            "file_name": "whiteboard_memo.png",
            "page_title": "④ゼミ議事録 2026年10月",
            "block_type": "image",
        },
        {
            "file_name": "lineA3_resistivity_curve.png",
            "page_title": "⑤解析コードの使い方",
            "block_type": "image",
        },
        {
            "file_name": "tem_inversion_demo.py",
            "page_title": "⑤解析コードの使い方",
            "block_type": "file",
        },
    ]

    print("🚀 Notion API file_uploads によるテストファイル追加処理を開始します...\n")

    for i, task in enumerate(tasks, 1):
        file_path = os.path.join(PROJECT_DIR, task["file_name"])
        if not os.path.exists(file_path):
            print(f"❌ エラー: ファイルが存在しません: {file_path}")
            continue

        print(f"[{i}/{len(tasks)}] 対象: '{task['file_name']}' -> '{task['page_title']}' ({task['block_type']})")
        try:
            page_id, found_title = search_page_id_by_title(task["page_title"])
            print(f"  ページ特定: '{found_title}' (ID: {page_id})")

            # 1. file_uploads でアップロード
            upload_id = upload_file_to_notion(file_path)

            # 2. ページに追加
            append_block_to_page(page_id, task["block_type"], upload_id)
            print(f"  ✅ 完了: {task['file_name']}\n")
        except Exception as e:
            print(f"  ❌ 失敗: {e}\n")

    print("🎉 すべてのファイル追加処理が終了しました。")


if __name__ == "__main__":
    main()
