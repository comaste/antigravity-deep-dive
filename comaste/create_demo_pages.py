"""
Notion APIで「Notionにようこそ！」の下に、研究室の資料を想定したデモページを6つ作成するスクリプト。
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


def find_parent_page_id():
    """「Notionにようこそ！」のページIDを検索して取得する。"""
    payload = {
        "query": "Notionにようこそ",
        "filter": {"property": "object", "value": "page"},
        "page_size": 10,
    }
    resp = requests.post(f"{BASE_URL}/search", headers=HEADERS, json=payload)
    resp.raise_for_status()
    data = resp.json()
    for item in data.get("results", []):
        # 該当ページを返す
        return item["id"]
    
    # 見つからない場合は前回の既知IDをフォールバック
    return "303d12bd-16d5-8066-8fcdee32ef16f9bc"


def build_block(text, block_type="paragraph"):
    """テキストからNotionブロックオブジェクトを生成する。"""
    if block_type == "heading_2":
        return {
            "object": "block",
            "type": "heading_2",
            "heading_2": {
                "rich_text": [{"type": "text", "text": {"content": text}}]
            },
        }
    elif block_type == "bulleted_list_item":
        return {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": text}}]
            },
        }
    else:
        return {
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [{"type": "text", "text": {"content": text}}]
            },
        }


def get_demo_pages_data():
    """6つのデモページの定義データを返す。"""
    return [
        {
            "title": "①測定手順書（2024年版）",
            "lines": [
                ("【版情報】初版（v1.0） | 作成日: 2024年4月10日 | 作成者: 田中（M2）", "paragraph"),
                ("概要", "heading_2"),
                ("本手順書は分光光度計（SpectraLab-200）の標準測定プロトコルを定めたものです。", "paragraph"),
                ("1. 測定開始30分前に本体主電源をONにし、光源ランプを十分ウォームアップしてください。", "bulleted_list_item"),
                ("2. 石英セルは測定前に超純水（Milli-Q）およびエタノールで3回以上洗浄します。", "bulleted_list_item"),
                ("3. 溶媒のみを入れたセルをセットし、測定波長範囲（350nm〜800nm）でブランク測定を実施します。", "bulleted_list_item"),
                ("4. 調製済みサンプル溶液をセルに入れ、気泡が入らないよう静かにホルダーへ装填します。", "bulleted_list_item"),
                ("5. 遮光カバーを確実に閉め、測定ソフトの「Start Scan」をクリックして計測します。", "bulleted_list_item"),
                ("6. 得られた吸光度スペクトルデータをCSV形式でローカルUSBメモリにエクスポートします。", "bulleted_list_item"),
                ("7. 測定終了後はセルを速やかに洗浄して乾燥ボックスに戻し、装置ログノートに記入してください。", "bulleted_list_item"),
            ],
        },
        {
            "title": "②測定手順書_最終版（2026年版、手順を一部変更）",
            "lines": [
                ("【版情報】改訂第2版（v2.0 最終版） | 改訂日: 2026年5月15日 | 改訂者: 佐藤（助教）", "paragraph"),
                ("改訂概要と注意事項", "heading_2"),
                ("新型検出器ユニット導入に伴い、2024年版からのウォームアップ時間短縮およびデータ保存先を変更しました。", "paragraph"),
                ("1. 装置起動: 検出器の改良により、ウォームアップ時間は従来の30分から5分に短縮されました。", "bulleted_list_item"),
                ("2. セル洗浄: 超音波洗浄器での洗浄手順を標準化しました（出力弱で2分間）。", "bulleted_list_item"),
                ("3. キャリブレーション: 新設の自動ブランク補正ボタンを押すだけで背景補正が完了します。", "bulleted_list_item"),
                ("4. サンプル測定: 測定波長範囲（200nm〜900nm対応）を指定し、測定を開始します。", "bulleted_list_item"),
                ("5. セーフティ機能: 遮光カバーが半開きの状態では自動停止する安全インターロックが作動します。", "bulleted_list_item"),
                ("6. データ保存: USBメモリの使用は禁止となり、研究室共有NAS（/nas/lab_data/2026/）へ直接保存します。", "bulleted_list_item"),
                ("7. 終了処理: 測定完了メールが自動送信されるため、ノート記入は不要ですが電源OFFは各自確認してください。", "bulleted_list_item"),
            ],
        },
        {
            "title": "③測定手順書_最終版2（書きかけの下書き）",
            "lines": [
                ("【版情報】下書き（v2.1 Draft / 未完成） | 作成日: 2026年9月28日 | 担当: 鈴木（B4）", "paragraph"),
                ("※注意: 本文書はレビュー前の草案です。現行の測定には2026年最終版（v2.0）を参照してください。", "paragraph"),
                ("検討中の改訂ポイント", "heading_2"),
                ("低温測定用クライオスタット併用時のフローを追加予定（※山田先輩に温度制御のコツを聞くこと）。", "paragraph"),
                ("1. 液体窒素の充填手順（※安全メガネと耐熱グローブ必須、酸欠センサー確認！）", "bulleted_list_item"),
                ("2. 設定温度（77K〜室温）の昇温レート閾値は要検討（0.5K/min または 1.0K/min ?）", "bulleted_list_item"),
                ("3. 【未定】センサー感度のゲイン設定パラメータは自動化できるかメーカーに問い合わせ中", "bulleted_list_item"),
                ("4. サンプルホルダーのネジ締めトルクが強すぎるとセルが割れるので目安トルク値（TODO: 確認）", "bulleted_list_item"),
                ("5. データ取得後のバックグラウンドノイズ除去フィルターの選定（移動平均 vs FFT）", "bulleted_list_item"),
                ("※次回ゼミ（10月予定）で先生に確認して承認をもらったら正式版にする。", "paragraph"),
            ],
        },
        {
            "title": "④ゼミ議事録 2026年10月",
            "lines": [
                ("【版情報】確定版（v1.0） | 開催日: 2026年10月20日 15:00-17:30 | 記録: 高橋（M1）", "paragraph"),
                ("出席者および連絡事項", "heading_2"),
                ("出席者: 中村教授、佐々木准教授、佐藤助教、M2(3名)、M1(4名)、B4(3名)", "paragraph"),
                ("1. 中間報告（田中M2）: 薄膜サンプルの結晶性評価について進捗報告。ピーク分離の精度向上を指示。", "bulleted_list_item"),
                ("2. 中間報告（鈴木B4）: 新型測定手順書の草案提出。低温測定時の安全対策を追記の上再提出すること。", "bulleted_list_item"),
                ("3. 共通備品点検: クリーンベンチのHEPAフィルター交換が11月5日に決定。当日午前中は利用停止。", "bulleted_list_item"),
                ("4. 学会発表準備: 12月の応用物理学会の予稿締切は11月10日厳守。原稿レビューは来週金曜まで。", "bulleted_list_item"),
                ("5. 予算執行: 今年度の消耗品費申請は11月末まで。試薬の発注リストを今週中にまとめること。", "bulleted_list_item"),
                ("6. 次回ゼミ日程: 2026年10月27日（火）15:00〜（発表担当: 伊藤M1、渡辺M1）。", "bulleted_list_item"),
                ("決定事項: 実験室の入室カードリーダー故障のため、今週中はテンキー暗証番号（0428#）で開錠。", "paragraph"),
            ],
        },
        {
            "title": "⑤解析コードの使い方",
            "lines": [
                ("【版情報】v1.3 | 更新日: 2026年10月12日 | 作成・メンテナ: 渡辺（M1）", "paragraph"),
                ("リポジトリ構成と環境構築", "heading_2"),
                ("本リポジトリ（lab-spectro-analyzer）は測定スペクトルの自動ピークフィッティング用スクリプト群です。", "paragraph"),
                ("1. 事前準備: Python 3.11以上がインストールされていることを確認してください。", "bulleted_list_item"),
                ("2. 仮想環境作成: python -m venv venv && source venv/bin/activate を実行します。", "bulleted_list_item"),
                ("3. 依存ライブラリ導入: pip install -r requirements.txt （numpy, scipy, pandas, matplotlib等）", "bulleted_list_item"),
                ("4. データ配置: 測定出力CSVを data/raw/ ディレクトリ配下に「YYYYMMDD_sampleID.csv」で格納します。", "bulleted_list_item"),
                ("5. 解析実行: python run_fit.py --config config/default.yaml --batch を実行します。", "bulleted_list_item"),
                ("6. 出力確認: output/figures/ にフィッティング済みPDF、output/tables/ にピーク積分値CSVが出力されます。", "bulleted_list_item"),
                ("エラー時: scipy.optimize.curve_fit の収束エラーが出る場合は、initial_guess.json の初期値を調整してください。", "paragraph"),
            ],
        },
        {
            "title": "⑥機材の貸し出しルール",
            "lines": [
                ("【版情報】規程第3版（v3.0） | 施行日: 2026年4月1日 | 管理責任者: 佐藤助教", "paragraph"),
                ("目的と基本方針", "heading_2"),
                ("本ルールは研究室共通の高額機材および共用ポータブル測定器の適正利用と紛失防止を目的とします。", "paragraph"),
                ("1. 対象機材: デジタルオシロスコープ、赤外放射温度計、ポータブルラマン分光計、一眼レフカメラ等。", "bulleted_list_item"),
                ("2. 予約手続き: 使用日の3日前までに研究室Notionの「機材予約カレンダー」に対象機材と使用目的を登録。", "bulleted_list_item"),
                ("3. 貸出期間: 原則として最長3日間。学外持ち出しやフィールド測定の場合は事前承認が必要です。", "bulleted_list_item"),
                ("4. 受け渡し: 機材保管庫（302号室）の施錠キーを管理責任者から受け取り、持出台帳に日時・氏名を記入。", "bulleted_list_item"),
                ("5. 返却前点検: 付属品（プローブ、充電アダプタ、接続ケーブル等）の欠品がないかチェックリストで照合。", "bulleted_list_item"),
                ("6. トラブル対応: 機器の異常や破損が発生した場合は、速やかに管理責任者へSlack #trouble で報告すること。", "bulleted_list_item"),
                ("注意事項: 飲食禁止エリアでの機材使用や、無断での第三者への転貸は厳禁とします。", "paragraph"),
            ],
        },
    ]


def create_page(parent_id, page_data):
    """Notion APIで子ページを作成する。"""
    children_blocks = [
        build_block(text, btype) for text, btype in page_data["lines"]
    ]

    payload = {
        "parent": {"page_id": parent_id},
        "properties": {
            "title": [
                {
                    "text": {
                        "content": page_data["title"]
                    }
                }
            ]
        },
        "children": children_blocks,
    }

    resp = requests.post(f"{BASE_URL}/pages", headers=HEADERS, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    if not NOTION_TOKEN:
        print("エラー: .env に NOTION_TOKEN が設定されていません。")
        return

    print("親ページ「Notionにようこそ！」を検索中...")
    parent_id = find_parent_page_id()
    print(f"親ページID: {parent_id}\n")

    pages_to_create = get_demo_pages_data()
    print(f"作成予定ページ数: {len(pages_to_create)}\n")
    print("=" * 60)

    for i, pdata in enumerate(pages_to_create, 1):
        print(f"[{i}/6] ページ作成中: {pdata['title']} ...", end="", flush=True)
        try:
            created = create_page(parent_id, pdata)
            url = created.get("url", "")
            print(f" 成功！")
            print(f"      URL: {url}")
        except Exception as e:
            print(f" 失敗: {e}")
        # APIレート制限対策
        time.sleep(0.5)

    print("=" * 60)
    print("✅ すべてのデモページの作成処理が完了しました。")


if __name__ == "__main__":
    main()
