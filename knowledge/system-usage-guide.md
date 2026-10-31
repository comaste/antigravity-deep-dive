---
okf_version: "0.2"
id: system-usage-guide
title: システム利用ガイド（HTML ドキュメント）のマルチチャネル配信アーキテクチャ
tags:
  - documentation
  - static-hosting
  - gcp
status: verified
updated_at: "2026-10-31"
trust_signals:
  verification_method: "Vite public アセット配信仕様、docs/index.html 相対シンボリックリンク解決、および Hono /guide /guide.html エンドポイントの Vitest 単体テスト検証"
  verified_by: "agent"
  evidence:
    - "packages/server/src/index.ts"
    - "packages/server/src/guide-serving.test.ts"
    - "docs/index.html"
    - "packages/web/public/guide.html"
---

# システム利用ガイド（HTML ドキュメント）のマルチチャネル配信アーキテクチャ

## 背景と課題

Notion & Box 横断検索システムは社内の全従業員（エンジニア・非エンジニア双方）が日常的に利用する検索ポータルであり、また情報システム管理者やセキュリティ担当者による OAuth 接続設定や定期同期ジョブの監視運用を伴う。

そのため、以下の要件を満たす包括的なシステム利用ガイド・運用ドキュメントの提供が必要であった。

1. **ゼロ外部依存・高速表示**: CDN や外部スクリプト、重いクライアントサイド JavaScript フレームワークの初期化を待たずに、単一の静的 HTML ファイルとしてブラウザで瞬時に開けること。
2. **マルチチャネル配信（Multi-channel Distribution）**:
   - **GitHub Pages / ドキュメント公開基盤**: リポジトリの `docs/index.html` からそのままホスティング可能であること。
   - **Web フロントエンド (Cloud Run)**: React SPA と同一オリジンの `/guide.html` から直接遷移・閲覧可能であること。
   - **API サーバー直接アクセス**: バックエンド単体起動時でも `/guide` または `/guide.html` から直接ドキュメントを参照可能であること。
3. **単一の信頼できる情報源（Single Source of Truth: SSOT）**: 複数チャネルで同じドキュメントを公開するにあたり、ファイルのコピーや二重管理による記述の食い違いを完全に防ぐこと。

## アーキテクチャと設計詳細

```
                                    +----------------------------------------+
                                    | packages/web/public/guide.html (SSOT)  |
                                    +----------------------------------------+
                                        |                   |
               相対シンボリックリンク   |                   | Vite build / dev
               (docs/index.html -> ...) |                   | 自動コピー
                                        v                   v
                     +----------------------+       +-------------------------+
                     |   GitHub Pages /     |       | Cloud Run Web Frontend  |
                     |   Static Hosting     |       | (https://<domain>/      |
                     |   (docs/index.html)  |       |        guide.html)      |
                     +----------------------+       +-------------------------+
                                                            ^
                                                            | Node fs readFile
                                                            | & 302 Redirect
                                                    +-------------------------+
                                                    | Cloud Run API Backend   |
                                                    | (GET /guide -> 302)     |
                                                    | (GET /guide.html -> 200)|
                                                    +-------------------------+
```

### 1. 相対シンボリックリンクによる整合性保証

- **実体ファイル**: `packages/web/public/guide.html`（CSS、レスポンシブデザイン、およびサイドバー追従スクリプトを単一ファイルにインライン内包）。
- **GitHub Pages 向けエンドポイント**: `docs/index.html` を `../packages/web/public/guide.html` への相対シンボリックリンクとして作成。
- Git はシンボリックリンクを追跡するため、`packages/web/public/guide.html` を更新するだけで `docs/index.html` も自動的に最新化され、二重管理コストがゼロとなる。

### 2. Vite による Web フロントエンド自動バンドル配信

- Vite の仕様上、`public/` ディレクトリ配下に置かれた静的アセットは、`pnpm dev`（開発サーバー）時および `pnpm build`（本番ビルド）時にビルド成果物ルート（`dist/`）へそのまま出力される。
- これにより、本番環境の Cloud Run 上で Web サーバーが稼働する際、追加の設定不要で `https://<domain>/guide.html` として配信される。

### 3. Hono API サーバーによるバックエンド直接配信とリダイレクト

API サーバー単体で起動・検証している環境や、バックエンドのポート（`:3001` または `:8787`）に直接アクセスした利用者のために、Hono API サーバーへ以下のルートを追加した。

- **`GET /guide`**: `302 Found` で `/guide.html` へリダイレクト。
- **`GET /guide.html`**: カレントディレクトリおよびスクリプト配置元から複数の候補パス（`packages/web/public/guide.html`, `docs/index.html` 等）を順次探索し、実体ファイルを `text/html; charset=utf-8` で配信。
- **Why not サードパーティ静的配信ミドルウェア**: サーブ対象が単一のドキュメントファイルに限定されるため、`@hono/node-server/serve-static` などの追加パッケージを入れず、Node.js 組み込みの `node:fs` と `node:path` で完結させることでサプライチェーンの安全性を維持した。
- **Why not ストリーム配信**: ガイド HTML は約 44KB の静的ドキュメントであり、メモリへの負荷が極めて小さいため、一括読み込みによる文字列返却の方が I/O ハンドリングが単純でオーバーヘッドが少ないため。

### 4. Justfile による運用・検証自動化

開発者が即座にドキュメントの閲覧と整合性チェックを行えるよう、`justfile` に以下のレシピを定義した。

- `just preview-docs`: デフォルトブラウザで `docs/index.html` を即時プレビュー表示。
- `just check-docs`: `packages/web/public/guide.html` の実体存在と `docs/index.html` のシンボリックリンク妥当性をシェルで自動検証。

## 検証結果 (Trust Signals)

1. **シンボリックリンク解決検証**: `test -f packages/web/public/guide.html && test -L docs/index.html && test -e docs/index.html` を実行し、シンボリックリンクが切れておらず（dangling symlink ではない）正常に実体を指していることを確認。
2. **API サーバー統合テスト**: `packages/server/src/guide-serving.test.ts` を作成し、Vitest にて以下を保証。
   - `GET /guide` が `/guide.html` へ 302 リダイレクトされること。
   - `GET /guide.html` がステータス 200 かつ `Content-Type: text/html` でガイド HTML を返却すること。
   - 返却された HTML 本文にシステムの主要概念（Notion, Box, ハイブリッド検索）が含まれていること。
