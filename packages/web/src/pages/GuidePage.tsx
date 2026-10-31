import React, { useState } from "react"
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Layers,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react"

type GuideTab = "overview" | "quickstart" | "search" | "admin" | "architecture" | "commands"

interface CommandItem {
  command: string
  title: string
  description: string
  tag: string
}

const COMMAND_LIST: readonly CommandItem[] = [
  {
    command: "just install-deps",
    title: "依存関係インストール",
    description:
      "pnpm ワークスペース配下の全依存パッケージを解決・インストールします。",
    tag: "Setup",
  },
  {
    command: "just sync-secrets",
    title: "1Password シークレット同期",
    description:
      "1Password CLI 経由で Gemini / Notion / Box の API キーを取得し macOS Keychain へ保存します。",
    tag: "Auth",
  },
  {
    command: "just set-secret <KEY> <op://...>",
    title: "個別シークレット保存",
    description:
      "任意の 1Password 参照から指定したキーを macOS Keychain へ登録します。",
    tag: "Auth",
  },
  {
    command: "just start-emulator",
    title: "Firestore Emulator 起動",
    description:
      "ベクトル検索 (findNearest) と複合インデックスをエミュレートする Firestore (ポート 8080) を起動します。",
    tag: "DB",
  },
  {
    command: "just run-dev",
    title: "開発サーバー並列起動",
    description:
      "Hono API サーバー (:3001) と Vite フロントエンド (:5173) を同時に立ち上げます。",
    tag: "Dev",
  },
  {
    command: "just seed-data",
    title: "デモデータ投入 (Seed)",
    description:
      "ローカル Firestore Emulator に Notion 規程や Box 設計書のデモチャンクを一括投入します。",
    tag: "Dev",
  },
  {
    command: "just run-test",
    title: "単体テスト実行",
    description:
      "Vitest による日本語トークナイザや RRF スコア計算、Gemini クライアントのテストを実行します。",
    tag: "QA",
  },
  {
    command: "just check-types",
    title: "TypeScript 型チェック",
    description: "tsc --noEmit により全ワークスペースの型安全性を検証します。",
    tag: "QA",
  },
  {
    command: "just lint-code",
    title: "静的解析 (Lint)",
    description: "oxlint により高速かつ網羅的なコード品質チェックを行います。",
    tag: "QA",
  },
  {
    command: "just format-code",
    title: "コード整形 (Format)",
    description: "oxfmt により全ソースコードを自動フォーマットします。",
    tag: "QA",
  },
  {
    command: "just plan-infra",
    title: "Terraform 構文検証",
    description:
      "Cloud Run や Firestore、IAP などの GCP インフラ定義を検証します。",
    tag: "Infra",
  },
] as const

/**
 * 使い方ガイド・運用マニュアル画面コンポーネント。
 * Web UI 内での対話的な閲覧に加え、社内 Wiki や共有用に独立して配布・利用できるスタンドアロン HTML 版への導線を提供する
 * （Why not: 画面遷移せずインラインで読める SPA ルートと、外部サーバーやオフラインでも配布可能な静的単一 HTML の両方を提供することで、開発者の閲覧性と業務利用時のポータビリティを両立するため）。
 */
export function GuidePage(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<GuideTab>("overview")
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const handleCopy = (text: string, key: string): void => {
    const isClipboardSupported =
      typeof navigator !== "undefined" && "clipboard" in navigator
    if (!isClipboardSupported) {
      return
    }

    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => {
        setCopiedKey(null)
      }, 2500)
    })
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Standalone HTML Guide Banner */}
      <div className="mb-8 flex flex-col items-start justify-between gap-4 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/60 via-slate-900/80 to-slate-900/90 p-5 shadow-xl sm:flex-row sm:items-center">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600/30 border border-indigo-400/30 text-indigo-300">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">
                DeepSearch 使い方・運用ガイド
              </h2>
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
                Official Manual
              </span>
            </div>
            <p className="text-xs text-slate-300">
              オフライン動作対応・単一ファイルで社内配布可能なスタンドアロン
              HTML 版もご利用いただけます。
            </p>
          </div>
        </div>

        <a
          href="/guide.html"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 hover:border-indigo-300"
        >
          <span>スタンドアロン HTML 版を開く</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Hero Header */}
      <div className="mb-8 rounded-3xl border border-slate-800 bg-radial-[circle_at_top_left] from-indigo-950/40 via-slate-900/90 to-slate-950 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300">
            Cloud Run + Firestore Native + Gemini 3.8 Flash
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
            Reciprocal Rank Fusion (RRF k=60)
          </span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          Notion &amp; Box 横断検索システム 利用マニュアル
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
          社内 Notion ワークスペースと Box
          ストレージに分散した重要ドキュメントを単一のインデックスに集約。
          意味検索（Semantic）と文字 Bi-gram キーワード検索を融合した
          <strong>ハイブリッド RRF 検索</strong> と、
          <strong>Gemini 3.8 Flash</strong> による参照番号付きの AI
          回答を提供します。
        </p>

        {/* Tab Navigation */}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-800/80 pt-6">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === "overview"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>概要 &amp; 特徴</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("quickstart")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === "quickstart"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>クイックスタート</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("search")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === "search"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>検索画面の使い方</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("admin")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === "admin"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            <span>同期・管理画面の使い方</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("architecture")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === "architecture"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>ハイブリッド RRF 設計</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("commands")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === "commands"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>開発コマンド一覧</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                <Sparkles className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-white">
                ハイブリッド RRF 検索
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Google <code>gemini-embedding-001</code> (768次元)
                の意味検索と、日本語文字 Bi-gram
                トークンによる語彙検索を順位逆数加算 (RRF)
                で統合。語彙の揺らぎと固有名詞の完全一致を両立します。
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
                <Database className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-white">
                Firestore Native Vector Search
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                専用の Elasticsearch クラスタを立てず、Firestore Native の{" "}
                <code>findNearest</code> (KNN Flat)
                と複合インデックスを活用。運用コストと保守負荷を極小化しています。
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
                <Cpu className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-white">
                Gemini 3.8 Flash RAG
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                最新の Gemini Interactions API
                を利用。検索結果の上位チャンクを文脈として注入し、参照番号{" "}
                <code>[1]</code> <code>[2]</code>{" "}
                付きの信頼性の高い要約回答を生成します。
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h3 className="text-base font-bold text-white mb-3">
              システムアーキテクチャの要約
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 text-xs text-slate-300">
              <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
                <div className="font-semibold text-indigo-300">
                  🌐 フロントエンド (`packages/web`)
                </div>
                <div>
                  React 19 + TanStack Router + TanStack Query + Tailwind CSS v4
                </div>
                <div className="text-slate-400">
                  SPA
                  構成。高速なクライアントサイドキャッシュとリアルタイム検索体験。
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
                <div className="font-semibold text-emerald-300">
                  ⚙️ バックエンド (`packages/server`)
                </div>
                <div>
                  Hono (Node.js) + Google Gen AI SDK + Firestore Native Client
                </div>
                <div className="text-slate-400">
                  Notion / Box コネクタ、チャンク分割、768次元ベクトル化、RRF
                  統合サービス。
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
                <div className="font-semibold text-amber-300">
                  📦 共通ロジック (`packages/shared`)
                </div>
                <div>
                  Zod スキーマ + 日本語 Bi-gram トークナイザ + RRF アルゴリズム
                </div>
                <div className="text-slate-400">
                  型安全なドキュメント・チャンク定義と、単体テスト済みの順位統合ロジック。
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
                <div className="font-semibold text-rose-300">
                  ☁️ クラウドインフラ (`infra/terraform`)
                </div>
                <div>Cloud Run (東京) + IAP ドメイン制限 + Secret Manager</div>
                <div className="text-slate-400">
                  Cloud Scheduler による 30 分間隔の自動差分同期と社内 Google
                  アカウント認証。
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Quickstart */}
      {activeTab === "quickstart" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h3 className="text-base font-bold text-white mb-2">
              わずか 3 ステップでローカル開発環境を立ち上げる
            </h3>
            <p className="text-xs text-slate-400 mb-6">
              前提: <code>pnpm</code>, <code>just</code>,{" "}
              <code>firebase-tools</code> (Java 11+)。
            </p>

            <div className="space-y-6">
              {/* Step 1 */}
              <div className="relative rounded-xl border border-slate-800 bg-slate-950/70 p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[11px] font-bold text-indigo-300 font-mono">
                    STEP 1
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy("just sync-secrets", "step1")}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    {copiedKey === "step1" ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">コピー完了</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>コピー</span>
                      </>
                    )}
                  </button>
                </div>
                <h4 className="text-sm font-bold text-white mb-1">
                  1Password からシークレットを同期
                </h4>
                <p className="text-xs text-slate-400 mb-3">
                  1Password CLI 経由で Gemini API キーや Notion/Box
                  トークンを取得し、macOS Keychain{" "}
                  <code>dev.kexi.notion-box-search</code> へ保存します。
                </p>
                <div className="rounded-lg bg-slate-900 p-2.5 font-mono text-xs text-indigo-300 border border-slate-800">
                  just sync-secrets
                </div>
              </div>

              {/* Step 2 */}
              <div className="relative rounded-xl border border-slate-800 bg-slate-950/70 p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[11px] font-bold text-sky-300 font-mono">
                    STEP 2
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy("just start-emulator", "step2")}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    {copiedKey === "step2" ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">コピー完了</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>コピー</span>
                      </>
                    )}
                  </button>
                </div>
                <h4 className="text-sm font-bold text-white mb-1">
                  ローカル Firestore Emulator を起動
                </h4>
                <p className="text-xs text-slate-400 mb-3">
                  Firestore Emulator (<code>127.0.0.1:8080</code>, UI:{" "}
                  <code>4000</code>) を起動します。
                </p>
                <div className="rounded-lg bg-slate-900 p-2.5 font-mono text-xs text-sky-300 border border-slate-800">
                  just start-emulator
                </div>
              </div>

              {/* Step 3 */}
              <div className="relative rounded-xl border border-slate-800 bg-slate-950/70 p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300 font-mono">
                    STEP 3
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy("just run-dev", "step3")}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    {copiedKey === "step3" ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">コピー完了</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>コピー</span>
                      </>
                    )}
                  </button>
                </div>
                <h4 className="text-sm font-bold text-white mb-1">
                  API &amp; Web 開発サーバーを並列起動
                </h4>
                <p className="text-xs text-slate-400 mb-3">
                  API (:3001) と Web (:5173) が立ち上がります。ブラウザで{" "}
                  <code>http://localhost:5173</code> を開き、ヘッダーの{" "}
                  <strong>「サンプルデータ投入 (Seed)」</strong>{" "}
                  をクリックして動作確認を行えます。
                </p>
                <div className="rounded-lg bg-slate-900 p-2.5 font-mono text-xs text-emerald-300 border border-slate-800">
                  just run-dev
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Search Screen Guide */}
      {activeTab === "search" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
            <div>
              <h3 className="text-base font-bold text-white mb-1">
                🔍 横断検索画面 (`/`) の詳細な使い方
              </h3>
              <p className="text-xs text-slate-400">
                日常の社内ドキュメント探索や問い合わせ解決に活用します。
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-2">
                  <Search className="h-4 w-4" />
                  <span>1. クエリの入力とサジェスト</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  検索バーに質問またはキーワードを入力します。「リモートワーク手当」「システム構成図」などの候補タグをクリックして即座に検索することも可能です。
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-sky-400 font-bold text-sm mb-2">
                  <Layers className="h-4 w-4" />
                  <span>2. 検索モードの切り替え</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                  <li>
                    <strong>ハイブリッド (RRF)</strong>: 意味検索 +
                    キーワード検索の順位融合。通常はこれを使用します。
                  </li>
                  <li>
                    <strong>意味検索 (Semantic)</strong>:
                    概念や意図が近い文書を検索。
                  </li>
                  <li>
                    <strong>キーワード (Keyword)</strong>: Bi-gram
                    による厳密な字面一致。
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>3. ソース絞り込み (Provider)</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  「すべて」「Notion」「Box」のボタンで、特定のプラットフォームに保存されたドキュメントのみに対象を瞬時に絞り込めます。
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-sm mb-2">
                  <Sparkles className="h-4 w-4" />
                  <span>4. AI 回答と引用バッジの連携</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Gemini 3.8 Flash が検索結果の上位チャンクを根拠として要約。
                  回答文内の <code>[1]</code> <code>[2]</code>{" "}
                  をクリックすると該当ドキュメントカードへジャンプし、Notion や
                  Box の原本 URL をワンクリックで開けます。
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-2">
                スコア内訳（Score Breakdown）の読み方
              </h4>
              <div className="grid gap-2 sm:grid-cols-3 text-xs text-slate-300">
                <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
                  <div className="font-semibold text-amber-300">RRF スコア</div>
                  <div className="text-slate-400 text-[11px] mt-1">
                    ベクトル順位とキーワード順位の逆数和。高いほど両検索で上位であることを示します。
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
                  <div className="font-semibold text-indigo-300">
                    Semantic Rank
                  </div>
                  <div className="text-slate-400 text-[11px] mt-1">
                    768次元ベクトル空間での近傍順位とコサイン距離（0に近いほど意味的に一致）。
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
                  <div className="font-semibold text-emerald-300">
                    Keyword Rank
                  </div>
                  <div className="text-slate-400 text-[11px] mt-1">
                    文字 Bi-gram トークンの一致率（カバレッジ）に基づく順位。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Admin Screen Guide */}
      {activeTab === "admin" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
            <div>
              <h3 className="text-base font-bold text-white mb-1">
                ⚙️ データソース・同期管理画面 (`/admin`) の詳細な使い方
              </h3>
              <p className="text-xs text-slate-400">
                Notion / Box
                の接続状況、同期対象リソース、および定期実行ジョブを制御します。
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-2">
                  <ShieldCheck className="h-4 w-4" />
                  <span>1. 接続ステータス (Notion / Box)</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed mb-2">
                  Notion は Internal Integration Token (
                  <code>NOTION_API_KEY</code>) または OAuth、 Box は Developer
                  Token (<code>BOX_DEVELOPER_TOKEN</code>) または OAuth
                  を参照します。
                </p>
                <div className="text-[11px] text-slate-400 bg-slate-900 p-2.5 rounded border border-slate-800">
                  トークンが有効であれば「接続済み
                  (Active)」と表示されます。設定変更は macOS Keychain または
                  1Password で行います。
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-sky-400 font-bold text-sm mb-2">
                  <Database className="h-4 w-4" />
                  <span>2. 同期対象リソース（Sync Targets）の追加・管理</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside">
                  <li>
                    <strong>Notion Database / Page</strong>: 対象の Database ID
                    または Page ID
                    を登録します。配下のブロックも自動走査されます。
                  </li>
                  <li>
                    <strong>Box Folder</strong>: 対象フォルダ ID
                    を登録します（ルート直下は <code>0</code>）。
                  </li>
                  <li>
                    <strong>有効化スイッチ</strong>:
                    特定のリソースの同期を一時停止したい場合、削除せずにトグルで無効化できます。
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-2">
                  <Terminal className="h-4 w-4" />
                  <span>3. 手動同期の実行とジョブ履歴</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  「今すぐ同期を実行」ボタンを押すと、バックグラウンドで最新ドキュメントの取得、チャンク分割、768次元ベクトル生成、Bi-gram
                  抽出が行われます。下部のジョブ履歴で処理ステータス（COMPLETED
                  / FAILED）、処理件数、エラーメッセージを確認できます。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Architecture & RRF */}
      {activeTab === "architecture" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
            <div>
              <h3 className="text-base font-bold text-white mb-1">
                🧠 ハイブリッド RRF アルゴリズムとアーキテクチャ詳細
              </h3>
              <p className="text-xs text-slate-400">
                Firestore Native と Gemini を組み合わせた高精度検索の仕組み。
              </p>
            </div>

            {/* Architecture Steps */}
            <div className="space-y-3">
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-4">
                <div className="text-xs font-bold text-indigo-400 mb-1">
                  PATH A: 意味検索 (Semantic Search)
                </div>
                <div className="text-xs text-slate-300 leading-relaxed">
                  1. ユーザー入力クエリを Google Gen AI SDK の{" "}
                  <code>gemini-embedding-001</code> に送信し、768
                  次元ベクトルを生成。
                  <br />
                  2. Firestore の <code>findNearest</code> を使用し、Cosine
                  距離に基づきインデックスから近傍上位 $N$ 件を取得。
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4">
                <div className="text-xs font-bold text-emerald-400 mb-1">
                  PATH B: 語彙検索 (Keyword Search)
                </div>
                <div className="text-xs text-slate-300 leading-relaxed">
                  1. クエリを NFKC 正規化し、日本語文字 Bi-gram (2文字組)
                  および英数字単語トークンに分解。
                  <br />
                  2. Firestore の <code>array-contains-any</code> (最大30要素)
                  でインデックスから高速に候補を絞り込み、アプリ層でクエリトークンの一致率（カバレッジ）を再計算。
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4">
                <div className="text-xs font-bold text-amber-400 mb-1">
                  FUSION: Reciprocal Rank Fusion (k=60)
                </div>
                <div className="text-xs text-slate-300 leading-relaxed">
                  スケールが異なるコサイン距離と語彙一致率を直接足さず、各手法の順位の逆数を加算して総合スコアを算出:
                  <div className="my-2 rounded bg-slate-950 p-2 font-mono text-amber-300 text-[11px] border border-amber-500/30">
                    RRF_Score(d) = (1 / (60 + rank_vec)) + (1 / (60 + rank_kw))
                  </div>
                  両検索で上位のチャンクが大きくブーストされ、片方にしか現れない固有コードも上位に残ります。
                </div>
              </div>

              <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-4">
                <div className="text-xs font-bold text-rose-400 mb-1">
                  SYNTHESIS: Gemini 3.8 Flash 要約
                </div>
                <div className="text-xs text-slate-300 leading-relaxed">
                  RRF
                  で上位にランクインしたチャンク本文とタイトルをシステムコンテキストに含め、Gemini
                  Interactions API を呼び出し。参照番号 <code>[1]</code>{" "}
                  <code>[2]</code> を付与した信頼性の高い要約を生成します。
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Commands */}
      {activeTab === "commands" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h3 className="text-base font-bold text-white mb-2">
              🛠️ 開発・運用コマンドリファレンス (`justfile`)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              プロジェクト内の全タスクは <code>just</code>{" "}
              で一元管理されています。
            </p>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-300 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">コマンド</th>
                    <th className="py-3 px-4 font-semibold">分類</th>
                    <th className="py-3 px-4 font-semibold">概要</th>
                    <th className="py-3 px-4 font-semibold text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/50">
                  {COMMAND_LIST.map((item) => (
                    <tr
                      key={item.command}
                      className="hover:bg-slate-800/40 transition"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-indigo-300">
                        {item.command}
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                          {item.tag}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        <div className="font-semibold text-white">
                          {item.title}
                        </div>
                        <div className="text-slate-400 text-[11px] mt-0.5">
                          {item.description}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleCopy(item.command, item.command)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-700 hover:text-white"
                        >
                          {copiedKey === item.command ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" />
                              <span className="text-emerald-400">完了</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Footer Navigation */}
      <div className="mt-8 flex items-center justify-between border-t border-slate-800/80 pt-6 text-xs text-slate-400">
        <div>DeepSearch — Notion &amp; Box 横断検索システム</div>
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
          >
            <span>検索画面を開く</span>
            <ArrowRight className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  )
}
