import React, { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import type {
  Provider,
  SearchProviderFilter,
  SearchResultHit,
} from "@antigravity/shared"
import {
  BookOpen,
  Bot,
  Calendar,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  FolderArchive,
  Hash,
  Loader2,
  Search,
  Sparkles,
  User,
} from "lucide-react"
import { searchDocuments } from "../api.js"

const SUGGESTED_QUERIES: readonly string[] = [
  "リモートワーク手当や経費精算のルールは？",
  "システムアーキテクチャのSLAやセキュリティ基準について教えて",
  "2026年度の予算計画と契約更新フロー",
] as const

/**
 * スニペット文字列内のマッチした検索トークンを安全にハイライト表示する React ノード配列に変換する。
 * `dangerouslySetInnerHTML` を使わず正規表現分割で `<mark>` 要素を生成する
 * （Why not: HTML 文字列置換と `dangerouslySetInnerHTML` を使うと、外部ドキュメント由来のテキストによる XSS リスクが生じるため）。
 */
function renderHighlightedSnippet(
  snippet: string,
  matchedTokens: string[],
): React.ReactNode {
  const validTokens = matchedTokens
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)

  const hasNoValidTokens = validTokens.length === 0
  if (hasNoValidTokens) {
    return snippet
  }

  // 長いトークンから優先的にマッチさせるため文字数降順でソートし、正規表現メタ文字をエスケープする
  const escapedTokens = Array.from(new Set(validTokens))
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))

  const pattern = new RegExp(`(${escapedTokens.join("|")})`, "gi")
  const parts = snippet.split(pattern)

  const lowerTokenSet = new Set(validTokens.map((t) => t.toLowerCase()))

  return parts.map((part, index) => {
    const isMatchedPart = lowerTokenSet.has(part.toLowerCase())
    if (isMatchedPart) {
      return (
        <mark
          key={`${index}-${part}`}
          className="rounded bg-amber-400/25 px-1 py-0.5 font-medium text-amber-200 ring-1 ring-amber-400/40"
        >
          {part}
        </mark>
      )
    }
    return <React.Fragment key={index}>{part}</React.Fragment>
  })
}

function ProviderBadge({
  provider,
}: {
  provider: Provider
}): React.ReactElement {
  const isNotion = provider === "notion"
  if (isNotion) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/90 px-2.5 py-0.5 text-xs font-semibold text-slate-100">
        <BookOpen className="h-3.5 w-3.5 text-slate-300" />
        <span>Notion</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-300">
      <FolderArchive className="h-3.5 w-3.5 text-sky-400" />
      <span>Box</span>
    </span>
  )
}

function formatDateString(isoString: string): string {
  const parsedDate = new Date(isoString)
  const isInvalidDate = Number.isNaN(parsedDate.getTime())
  if (isInvalidDate) {
    return isoString
  }
  return parsedDate.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function SearchHitCard({
  hit,
  rankIndex,
}: {
  hit: SearchResultHit
  rankIndex: number
}): React.ReactElement {
  const hasPathSegments = hit.path.length > 0
  const hasAuthor = typeof hit.author === "string" && hit.author.length > 0
  const hasSemanticRank = hit.semanticRank !== null
  const hasKeywordRank = hit.keywordRank !== null

  return (
    <article className="group rounded-2xl border border-slate-800/90 bg-slate-900/60 p-5 transition hover:border-indigo-500/40 hover:bg-slate-900/90">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
            #{rankIndex + 1}
          </span>
          <ProviderBadge provider={hit.provider} />
          {hasPathSegments && (
            <nav
              aria-label="ドキュメント階層パス"
              className="flex flex-wrap items-center gap-1 text-xs text-slate-400"
            >
              {hit.path.map((segment, idx) => (
                <React.Fragment key={`${hit.chunkId}-path-${idx}`}>
                  {idx > 0 && (
                    <ChevronRight className="h-3 w-3 text-slate-600" />
                  )}
                  <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-slate-300">
                    {segment}
                  </span>
                </React.Fragment>
              ))}
            </nav>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 font-mono font-semibold text-indigo-300"
            title="Reciprocal Rank Fusion 統合スコア"
          >
            <Sparkles className="h-3 w-3" />
            RRF: {hit.rrfScore.toFixed(4)}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono ${
              hasSemanticRank
                ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                : "border-slate-800 bg-slate-900 text-slate-500"
            }`}
            title="ベクトル意味検索での順位"
          >
            Semantic: {hasSemanticRank ? `#${hit.semanticRank}` : "-"}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono ${
              hasKeywordRank
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-slate-800 bg-slate-900 text-slate-500"
            }`}
            title="キーワード Bi-gram 検索での順位"
          >
            Keyword: {hasKeywordRank ? `#${hit.keywordRank}` : "-"}
          </span>
        </div>
      </div>

      <h3 className="mt-3 text-base font-bold text-white sm:text-lg">
        <a
          href={hit.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-indigo-300 hover:underline"
        >
          <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
          <span>{hit.title}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60 transition group-hover:opacity-100" />
        </a>
      </h3>

      <p className="mt-2.5 text-sm leading-relaxed text-slate-300">
        {renderHighlightedSnippet(hit.snippet, hit.matchedTokens)}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-3 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-slate-500" />
            <span>最終更新: {formatDateString(hit.externalUpdatedAt)}</span>
          </span>
          {hasAuthor && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5 text-slate-500" />
              <span>{hit.author}</span>
            </span>
          )}
        </div>

        {hit.matchedTokens.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <Hash className="h-3 w-3 text-slate-500" />
            {hit.matchedTokens.slice(0, 6).map((token) => (
              <span
                key={`${hit.chunkId}-token-${token}`}
                className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
              >
                {token}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * 横断検索画面 (`/`)。
 * 検索リクエストはユーザー操作（フォーム送信またはサジェストチップクリック）を起点に実行するため useMutation で状態管理する
 * （Why not: 入力中の1文字ごとに useQuery を自動発火させると、Embedding 生成と Gemini 要約 API が過剰に呼ばれてレイテンシとコストが増大するため）。
 */
export function SearchPage(): React.ReactElement {
  const [queryText, setQueryText] = useState<string>(SUGGESTED_QUERIES[0] ?? "")
  const [providerFilter, setProviderFilter] =
    useState<SearchProviderFilter>("all")
  const [includeAiSummary, setIncludeAiSummary] = useState<boolean>(true)

  const searchMutation = useMutation({
    mutationFn: searchDocuments,
  })

  const executeSearch = (
    targetQuery: string,
    targetProvider: SearchProviderFilter = providerFilter,
    targetIncludeAi: boolean = includeAiSummary,
  ): void => {
    const trimmedQuery = targetQuery.trim()
    const isQueryEmpty = trimmedQuery.length === 0
    if (isQueryEmpty) {
      return
    }

    searchMutation.mutate({
      query: trimmedQuery,
      provider: targetProvider,
      limit: 15,
      includeAiSummary: targetIncludeAi,
    })
  }

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    executeSearch(queryText)
  }

  const handleSelectSuggestion = (suggestion: string): void => {
    setQueryText(suggestion)
    executeSearch(suggestion)
  }

  const handleProviderChange = (nextProvider: SearchProviderFilter): void => {
    setProviderFilter(nextProvider)
    const hasExistingQuery = queryText.trim().length > 0
    if (hasExistingQuery) {
      executeSearch(queryText, nextProvider, includeAiSummary)
    }
  }

  const searchResult = searchMutation.data
  const hasSearchResult = searchResult !== undefined
  const hasSearchHits = hasSearchResult && searchResult.hits.length > 0
  const hasAiSummary =
    hasSearchResult &&
    searchResult.aiSummary !== null &&
    searchResult.aiSummary.answerMarkdown.trim().length > 0

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* 検索フォームセクション */}
      <section className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-900/50 p-6 shadow-2xl shadow-indigo-950/20 sm:p-8">
        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-4 h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Notion ページや Box 内の PDF・仕様書を自然文またはキーワードで検索..."
              className="w-full rounded-2xl border border-slate-700/80 bg-slate-950/90 py-4 pr-32 pl-12 text-base text-white placeholder-slate-500 shadow-inner transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none"
            />
            <button
              type="submit"
              disabled={
                searchMutation.isPending || queryText.trim().length === 0
              }
              className="absolute right-2.5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>検索中...</span>
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  <span>検索</span>
                </>
              )}
            </button>
          </div>

          {/* サジェストチップ */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-medium text-slate-400">
              よく使われる質問:
            </span>
            {SUGGESTED_QUERIES.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSelectSuggestion(suggestion)}
                className="cursor-pointer rounded-full border border-slate-700/80 bg-slate-800/60 px-3 py-1 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:bg-indigo-500/15 hover:text-indigo-200"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* フィルタ & AI 要約トグル */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800/80 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                <Filter className="h-3.5 w-3.5" />
                <span>データソース:</span>
              </span>
              <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1">
                {([
                  { value: "all", label: "すべて (All)" },
                  { value: "notion", label: "Notion のみ" },
                  { value: "box", label: "Box のみ" },
                ] as const).map((option) => {
                  const isSelected = providerFilter === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleProviderChange(option.value)}
                      className={`cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition ${
                        isSelected
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2.5 text-xs font-medium text-slate-300 select-none">
              <input
                type="checkbox"
                checked={includeAiSummary}
                onChange={(e) => setIncludeAiSummary(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500/40"
              />
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                <span>AI 要約回答を生成する (Gemini)</span>
              </span>
            </label>
          </div>
        </form>
      </section>

      {/* エラー表示 */}
      {searchMutation.isError && (
        <div className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          検索中にエラーが発生しました:{" "}
          {searchMutation.error instanceof Error
            ? searchMutation.error.message
            : "不明なエラー"}
        </div>
      )}

      {/* AI Summary カード */}
      {hasAiSummary && searchResult.aiSummary !== null && (
        <section className="mt-8 rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 via-slate-900/90 to-violet-950/30 p-6 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 pb-3.5">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
                <Bot className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-bold text-indigo-200">
                AI Grounded Answer
              </h2>
            </div>
            <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 font-mono text-[11px] text-indigo-300">
              Model: {searchResult.aiSummary.model}
            </span>
          </div>

          <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
            {searchResult.aiSummary.answerMarkdown}
          </div>

          {searchResult.aiSummary.citations.length > 0 && (
            <div className="mt-5 border-t border-indigo-500/20 pt-4">
              <p className="mb-2.5 text-xs font-semibold text-indigo-300/90">
                引用元ドキュメント (Citations):
              </p>
              <div className="flex flex-wrap gap-2">
                {searchResult.aiSummary.citations.map((citation) => {
                  const providerLabel =
                    citation.provider === "notion" ? "Notion" : "Box"
                  return (
                    <a
                      key={`${citation.index}-${citation.documentId}`}
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:border-indigo-400 hover:bg-indigo-950/70"
                    >
                      <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 font-mono text-[11px] font-bold text-indigo-200">
                        [{citation.index}]
                      </span>
                      <span className="text-slate-400">{providerLabel}:</span>
                      <span className="max-w-xs truncate">
                        {citation.title}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 検索結果一覧セクション */}
      {hasSearchResult && (
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-slate-300">
              検索結果{" "}
              <span className="font-bold text-white">
                {searchResult.totalHits}
              </span>{" "}
              件（ハイブリッド RRF スコア順）
            </h2>
            <div className="flex items-center gap-3 font-mono text-xs text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {searchResult.tookMs} ms
              </span>
              <span>traceId: {searchResult.traceId}</span>
            </div>
          </div>

          {hasSearchHits ? (
            <div className="space-y-4">
              {searchResult.hits.map((hit, idx) => (
                <SearchHitCard key={hit.chunkId} hit={hit} rankIndex={idx} />
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/40 p-12 text-center">
              <p className="text-base font-medium text-slate-300">
                一致するドキュメントが見つかりませんでした
              </p>
              <p className="mt-2 text-xs text-slate-400">
                右上の「サンプルデータ投入
                (Seed)」ボタンを押して初期データを投入するか、別のキーワードでお試しください。
              </p>
            </div>
          )}
        </section>
      )}

      {/* 初期ガイド表示 */}
      {!hasSearchResult && !searchMutation.isPending && (
        <section className="mt-10 rounded-3xl border border-slate-800/60 bg-slate-900/30 p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-indigo-400" />
          <h2 className="mt-3 text-base font-semibold text-slate-200">
            Notion と Box を横断して知識を即座に発見
          </h2>
          <p className="mx-auto mt-1.5 max-w-xl text-xs leading-relaxed text-slate-400">
            上の検索ボックスに質問を入力するか、サジェストチップをクリックして検索を実行してください。ローカル環境でまだデータがない場合は、ヘッダー右上の「サンプルデータ投入
            (Seed)」を1回クリックするとすぐに試せます。
          </p>
        </section>
      )}
    </div>
  )
}
