# 🔍 DocProbe (ドックプローブ)

> **研究室の資料探査機** ― NotionやBoxに埋もれた資料を、あいまいな質問から探り当てる

Notionの散在するページ・ドキュメント・添付画像・Pythonスクリプトをローカルにキャッシュ同期し、Geminiの最新埋め込みモデル（768次元ベクトル検索）とLLM（最新版判定・3行要約）を組み合わせた2段階ハイブリッド探査ツールです。

---

## ✨ 主な機能

1. **差分同期（Sync）**
   - Notion APIで全ページを取得し、更新があったページのみを差分再取得
   - ページ内の画像（ホワイトボード写真、測定グラフなど）をGeminiで高精度OCR・キャプション化
   - 添付スクリプト（`.py`など）を自動展開してテキストインデックス化
   - Geminiの最新埋め込みモデル（`gemini-embedding-2`, 768次元）で各ページをベクトル化

2. **2段階ナレッジ探査（Search）**
   - **第1段階**: 質問クエリをベクトル化し、コサイン類似度で上位5件を瞬時に抽出
   - **第2段階**: 上位候補のみをコンテキストとしてGemini（`gemini-3.8-flash`）に渡し、「現在有効な最新正式版の判定」「3行要約」「詳細注意点」を生成

3. **Streamlit Web UI（App）**
   - 「今すぐ同期」ボタン ＆ 最終同期時刻の表示
   - コサイン類似度スコア（パーセンテージ付きプログレスバー）の表示
   - トークン使用量トラッキング & アラート機能（使いすぎ防止）
   - Google Cloud (Vertex AI) / Gemini API のシームレスな切替

---

## 🛠️ セットアップ

### 1. 依存ライブラリのインストール
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. 環境変数の設定
`.env.example` をコピーして `.env` を作成し、必要なキーを入力します。

```bash
cp .env.example .env
```

```env
NOTION_TOKEN=secret_xxxxxxx
GEMINI_API_KEY=AIzaxxxxxxx
TOKEN_DAILY_LIMIT=100000
```

---

## 🚀 使い方

### Web アプリを起動する
```bash
source venv/bin/activate
streamlit run app.py
```

### コマンドラインから同期・検索する
```bash
# Notionから最新データを同期
python sync.py

# 自然言語で探査・検索
python search.py "測定手順書の最新版について教えて"
```
