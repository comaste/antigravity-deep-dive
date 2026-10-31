# Notion & Box 横断検索システム (AGENTS.md)

## プロジェクト概要

Notion ワークスペースと Box ストレージに分散した社内ドキュメントを横断検索するシステム。
Google Cloud (Cloud Run + Firestore Native + Gemini Embeddings) 上で動作し、ベクトル検索（意味検索）と Bi-gram トークン検索（キーワード検索）を Reciprocal Rank Fusion (RRF) で統合したハイブリッド検索を提供する。

## アーキテクチャ

- **フロントエンド (`packages/web`)**: React + TanStack Router + TanStack Query + Vite
- **バックエンド (`packages/server`)**: Hono (Node.js) + Firestore Native + Google Gen AI SDK (`gemini-embedding-001` 768次元 / `gemini-3.8-flash`)
- **共通スキーマ (`packages/shared`)**: Zod による API・Firestore ドキュメント型定義と日本語 Bi-gram トークナイザ・RRF アルゴリズム
- **インフラ (`infra/terraform`)**:
  - Cloud Run (`asia-northeast1`): API & Web ホスティング、IAP による Google Workspace (`cureapp.jp`) ドメイン制限
  - Firestore (`FIRESTORE_NATIVE`, `asia-northeast1`): ドキュメント・チャンク・接続設定・同期ジョブ管理、Vector Search Index (768次元 flat) + Array-Contains Index
  - Secret Manager (`asia-northeast1` user-managed replication): Notion / Box OAuth Secret, Gemini API Key
  - Cloud Scheduler (`*/30 * * * *`, `Asia/Tokyo`): OIDC 認証で `/api/sync/trigger` を定期呼び出し

## ディレクトリ構成

```text
.
├── AGENTS.md                 # AI エージェント向けプロジェクト説明書（本ファイル）
├── docs/                     # 静的公開ドキュメント（GitHub Pages 等対応）
│   └── index.html            # packages/web/public/guide.html へのシンボリックリンク
├── firebase.json             # ローカル Firestore Emulator 設定
├── firestore.indexes.json    # Firestore 複合・ベクトルインデックス定義
├── firestore.rules           # Firestore セキュリティルール
├── infra/
│   └── terraform/            # GCP インフラ定義 (Terraform)
├── justfile                  # タスクランナーレシピ定義
├── knowledge/                # Open Knowledge Format (OKF) 技術知見ドキュメント
│   ├── index.md
│   ├── tags.yml
│   └── firestore-hybrid-search.md
├── packages/
│   ├── shared/               # 共通スキーマ・トークナイザ・RRF ロジック
│   ├── server/               # バックエンド API・コネクタ・インデクサ
│   └── web/                  # フロントエンド UI
│       ├── public/
│       │   └── guide.html    # スタンドアロン静的 HTML 利用マニュアル
│       └── src/
│           └── pages/
│               ├── SearchPage.tsx
│               ├── AdminPage.tsx
│               └── GuidePage.tsx  # アプリ内利用ガイド (/guide)
└── pnpm-workspace.yaml       # pnpm ワークスペース・サプライチェーン防御設定
```

## 開発コマンド一覧

タスク実行には `just` または `pnpm` を使用する。

| コマンド | 説明 |
| :--- | :--- |
| `just install-deps` (`pnpm install`) | 依存パッケージのインストール |
| `just sync-secrets` | 1Password (`op`) から API キー・シークレットを取得し macOS Keychain へ保存 |
| `just set-secret <KEY> <op://...>` | 個別のシークレットを 1Password から macOS Keychain へ保存 |
| `just start-emulator` | ローカル Firestore Emulator の起動 (`127.0.0.1:8080`, UI: `4000`) |
| `just run-dev` (`pnpm dev`) | API (`:3001`) と Web (`:5173`) の開発サーバー並列起動 |
| `just seed-data` | ローカル環境へのデモ用シードデータ投入 |
| `just run-test` (`pnpm test`) | Vitest によるユニットテスト実行 |
| `just check-types` (`pnpm typecheck`) | TypeScript 型チェック (`tsc --noEmit`) |
| `just lint-code` (`pnpm lint`) | `oxlint` による静的解析 |
| `just format-code` (`pnpm format`) | `oxfmt` によるコード整形 |
| `just plan-infra` | Terraform 構文・構成検証 |

## コーディング規約・運用ルール

- **パッケージ管理**: `pnpm` のみを使用する（`minimumReleaseAge: 1440` 等でサプライチェーン防御を有効化済み）。
- **ログ出力**: 1 イベント 1 行の構造化 JSON ログを出力し、`traceId` / `requestId` を伝播させる。
- **条件分岐・関数設計**: `if` の条件式には説明的な変数名を付け、早期リターンを徹底する。
- **知見管理**: 調査・設計で得た知見は `knowledge/` 配下に OKF (Open Knowledge Format) 準拠で記録する。

## AI モデル方針

- **Gemini API / Vertex AI**: テキスト生成および回答要約には `gemini-3.8-flash`、テキスト埋め込みには `gemini-embedding-001` (768次元) を使用する。
- **AI エージェント作業**: 設計・レビュー・コーディングの全工程で `gemini-3.8-flash`（サブエージェント委譲時は `Model: "flash"`）を統一して使用する。
