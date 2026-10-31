import React, { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  BookOpen,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  Search,
  Settings,
  Sparkles,
} from "lucide-react"
import { seedSampleData } from "../api.js"

/**
 * 共通ヘッダーコンポーネント。
 * 検索画面と管理画面の切り替えに加え、ワンクリックでローカル Firestore Emulator にサンプルデータを投入できるボタンを配置する
 * （Why not: CLI コマンドでのみ Seed する設計にすると、ブラウザ上で動作確認したい開発者・レビュアーの手間が増えるため）。
 */
export function Header(): React.ReactElement {
  const queryClient = useQueryClient()
  const routerState = useRouterState()
  const currentPathname = routerState.location.pathname
  const [seedFeedback, setSeedFeedback] = useState<string | null>(null)

  const seedMutation = useMutation({
    mutationFn: seedSampleData,
    onSuccess: (data) => {
      void queryClient.invalidateQueries()
      const customMessage = data.message
      const hasCustomMessage =
        typeof customMessage === "string" && customMessage.length > 0
      if (hasCustomMessage) {
        setSeedFeedback(customMessage)
        setTimeout(() => setSeedFeedback(null), 4000)
        return
      }
      setSeedFeedback("サンプルデータを投入しました")
      setTimeout(() => setSeedFeedback(null), 4000)
    },
  })

  const isSearchActive = currentPathname === "/"
  const isAdminActive = currentPathname.startsWith("/admin")
  const isGuideActive = currentPathname.startsWith("/guide")

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 shadow-lg shadow-indigo-500/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-white">
                DeepSearch — Notion &amp; Box 横断検索
              </span>
              <span className="hidden rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-300 sm:inline-block">
                Hybrid RRF + Gemini 3.8 Flash
              </span>
            </div>
            <p className="text-xs text-slate-400">
              社内 Notion ページと Box
              ドキュメントを単一インデックスで意味・キーワード統合検索
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <nav className="flex items-center rounded-xl border border-slate-800 bg-slate-900/80 p-1">
            <Link
              to="/"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                isSearchActive
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span>🔍 横断検索</span>
            </Link>
            <Link
              to="/admin"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                isAdminActive
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>⚙️ データソース・同期管理</span>
            </Link>
            <Link
              to="/guide"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                isGuideActive
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>📖 使い方ガイド</span>
            </Link>
          </nav>

          <a
            href="/guide.html"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:border-slate-700 hover:bg-slate-800/60 hover:text-indigo-300 md:inline-flex"
            title="単一静的 HTML ファイルとしてオフライン閲覧可能なマニュアルを新規タブで開きます"
          >
            <span>HTML版</span>
            <ExternalLink className="h-3 w-3" />
          </a>

          <button
            type="button"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/50 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            title="ローカル Firestore Emulator に Notion / Box のサンプルドキュメントを投入します"
          >
            {seedMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : seedFeedback !== null ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            <span>
              {seedFeedback !== null
                ? seedFeedback
                : "サンプルデータ投入 (Seed)"}
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}
