# 利用可能なレシピ一覧を表示する
default:
    @just --list

# 依存パッケージをインストールする
install-deps:
    pnpm install

# 1Password (op) から API キーを取得し macOS Keychain へ保存する
sync-secrets vault="${OP_VAULT:-gr4p5pppcegvlhgustjrcocd5a}" item="${OP_ITEM:-t4pry4hmbshvyomayodaluy4gi}":
    OP_VAULT="{{ vault }}" OP_ITEM="{{ item }}" ./bin/sync-keychain-secrets.sh

# 特定の1つのシークレットを 1Password の任意の op:// 参照から macOS Keychain へ保存する
set-secret key op_ref:
    security add-generic-password -U -s "dev.kexi.notion-box-search" -a "{{ key }}" -w "$(op read "{{ op_ref }}")"

# ローカルの Firestore Emulator を起動する
start-emulator:
    pnpm exec firebase emulators:start --only firestore --project demo-notion-box-search

# 開発サーバー（API + Web）を並列起動する（APIキーは macOS Keychain から自動取得）
run-dev:
    pnpm dev

# ローカル環境にデモ用のシードデータを投入する
seed-data:
    pnpm --filter @antigravity/server seed

# 全パッケージのテストを実行する
run-test:
    pnpm test

# 全パッケージの型チェックを実行する
check-types:
    pnpm typecheck

# コードの静的解析（Lint）を実行する
lint-code:
    pnpm lint

# コードを自動整形する
format-code:
    pnpm format

# システム利用ガイド（docs/index.html）をブラウザでプレビュー表示する
preview-docs:
    open docs/index.html

# システム利用ガイドのファイル存在とシンボリックリンクの整合性を検証する
check-docs:
    test -f packages/web/public/guide.html && test -L docs/index.html && test -e docs/index.html

# Terraform の実行計画を確認する
plan-infra:
    cd infra/terraform && terraform init -backend=false && terraform validate

# Cloud Build を使用してコンテナイメージを Artifact Registry へビルド・プッシュする
build-image project_id="antigravity-deep" image_tag="asia-northeast1-docker.pkg.dev/antigravity-deep/notion-box-search/app:latest":
    gcloud builds submit --project="{{ project_id }}" --tag="{{ image_tag }}" .

# Terraform でインフラリソース（Cloud Run, Firestore, Secret Manager 等）を適用する
apply-infra:
    cd infra/terraform && terraform apply -auto-approve

# コンテナイメージのビルドから Terraform による本番デプロイまでを一括実行する
deploy-app:
    just build-image
    just apply-infra
