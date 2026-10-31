import React, { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ConnectorStatus,
  Provider,
  SyncJob,
  SyncTarget,
} from "@antigravity/shared"
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  ExternalLink,
  FolderArchive,
  FolderPlus,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react"
import {
  createSyncTarget,
  deleteSyncTarget,
  demoConnectProvider,
  fetchConnectors,
  fetchSyncJobs,
  fetchSyncTargets,
  triggerSyncJob,
} from "../api.js"

function formatDateTime(isoString: string | null): string {
  const isMissing = isoString === null || isoString.trim().length === 0
  if (isMissing) {
    return "未実行"
  }

  const parsedDate = new Date(isoString)
  const isInvalid = Number.isNaN(parsedDate.getTime())
  if (isInvalid) {
    return isoString
  }

  return parsedDate.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function ConnectorCard({
  provider,
  status,
  onDemoConnect,
  isDemoConnecting,
}: {
  provider: Provider
  status: ConnectorStatus | undefined
  onDemoConnect: (provider: Provider) => void
  isDemoConnecting: boolean
}): React.ReactElement {
  const isNotion = provider === "notion"
  const isConnected = status?.connected === true
  const title = isNotion ? "Notion Workspace" : "Box Enterprise"
  const description = isNotion
    ? "Notion Search / Block Children API を通じてページ階層と本文ブロックを同期します"
    : "Box Folders / Text Representation API を通じてフォルダ配下の PDF・Office 文書を同期します"

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                isNotion
                  ? "border-slate-700 bg-slate-800 text-slate-100"
                  : "border-sky-500/40 bg-sky-500/15 text-sky-300"
              }`}
            >
              {isNotion ? (
                <BookOpen className="h-5 w-5" />
              ) : (
                <FolderArchive className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-400">
                {status?.workspaceName ?? "未接続"}
              </p>
            </div>
          </div>

          {isConnected ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              連携済み
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
              <AlertCircle className="h-3.5 w-3.5" />
              未連携
            </span>
          )}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-300">
          {description}
        </p>

        {status?.updatedAt && (
          <p className="mt-2 text-[11px] text-slate-500">
            最終更新: {formatDateTime(status.updatedAt)}
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-4">
        <a
          href={`/api/oauth/${provider}/authorize`}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>OAuth 2.0 で連携する</span>
          <ExternalLink className="h-3 w-3 opacity-80" />
        </a>

        <button
          type="button"
          onClick={() => onDemoConnect(provider)}
          disabled={isDemoConnecting}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDemoConnecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          )}
          <span>デモ連携（ローカル検証用）</span>
        </button>
      </div>
    </div>
  )
}

/**
 * データソース・同期管理画面 (`/admin`)。
 * OAuth コネクタ状態、同期対象 (SyncTarget)、同期ジョブ (SyncJob) を1画面に集約し、状態更新時に自動で関連クエリを再検証する
 * （Why not: 設定ごとに別々のサブルートに分割すると、コネクタ連携からターゲット登録・手動同期実行までの初期セットアップ導線で画面遷移が増えて煩雑になるため）。
 */
export function AdminPage(): React.ReactElement {
  const queryClient = useQueryClient()

  const [newProvider, setNewProvider] = useState<Provider>("notion")
  const [newExternalId, setNewExternalId] = useState<string>("")
  const [newTargetName, setNewTargetName] = useState<string>("")

  const connectorsQuery = useQuery({
    queryKey: ["admin", "connectors"],
    queryFn: fetchConnectors,
  })

  const targetsQuery = useQuery({
    queryKey: ["admin", "targets"],
    queryFn: fetchSyncTargets,
  })

  const jobsQuery = useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: fetchSyncJobs,
  })

  const demoConnectMutation = useMutation({
    mutationFn: demoConnectProvider,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "connectors"] })
    },
  })

  const createTargetMutation = useMutation({
    mutationFn: createSyncTarget,
    onSuccess: () => {
      setNewExternalId("")
      setNewTargetName("")
      void queryClient.invalidateQueries({ queryKey: ["admin", "targets"] })
    },
  })

  const deleteTargetMutation = useMutation({
    mutationFn: deleteSyncTarget,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "targets"] })
    },
  })

  const triggerSyncMutation = useMutation({
    mutationFn: triggerSyncJob,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] })
      void queryClient.invalidateQueries({ queryKey: ["admin", "targets"] })
    },
  })

  const handleAddTargetSubmit = (
    event: React.FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault()
    const trimmedExternalId = newExternalId.trim()
    const trimmedName = newTargetName.trim()
    const isInvalidInput =
      trimmedExternalId.length === 0 || trimmedName.length === 0
    if (isInvalidInput) {
      return
    }

    createTargetMutation.mutate({
      provider: newProvider,
      externalId: trimmedExternalId,
      name: trimmedName,
    })
  }

  const connectorsList = connectorsQuery.data?.connectors ?? []
  const notionStatus = connectorsList.find((c) => c.provider === "notion")
  const boxStatus = connectorsList.find((c) => c.provider === "box")

  const syncTargets: SyncTarget[] = targetsQuery.data?.targets ?? []
  const hasSyncTargets = syncTargets.length > 0

  const syncJobs: SyncJob[] = jobsQuery.data?.jobs ?? []
  const hasSyncJobs = syncJobs.length > 0

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      {/* 1. OAuth コネクタ連携セクション */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white">
            1. OAuth 2.0 コネクタ連携
          </h2>
          <p className="text-xs text-slate-400">
            Notion / Box の OAuth
            認可を行うか、ローカル検証用のデモ連携モードを有効化します。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ConnectorCard
            provider="notion"
            status={notionStatus}
            onDemoConnect={(p) => demoConnectMutation.mutate(p)}
            isDemoConnecting={demoConnectMutation.isPending}
          />
          <ConnectorCard
            provider="box"
            status={boxStatus}
            onDemoConnect={(p) => demoConnectMutation.mutate(p)}
            isDemoConnecting={demoConnectMutation.isPending}
          />
        </div>
      </section>

      {/* 2. 同期対象（Sync Targets）管理セクション */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white">
              2. 同期対象（Sync Targets）管理
            </h2>
            <p className="text-xs text-slate-400">
              クローラが巡回する Notion ルートページ ID または Box フォルダ ID
              を登録します。
            </p>
          </div>
        </div>

        {/* 追加フォーム */}
        <form
          onSubmit={handleAddTargetSubmit}
          className="mt-4 grid gap-3 rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4 sm:grid-cols-12"
        >
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-medium text-slate-400">
              プロバイダ
            </label>
            <select
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value as Provider)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="notion">Notion</option>
              <option value="box">Box</option>
            </select>
          </div>

          <div className="sm:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-400">
              {newProvider === "notion"
                ? "Notion ページ / DB ID"
                : "Box フォルダ ID"}
            </label>
            <input
              type="text"
              value={newExternalId}
              onChange={(e) => setNewExternalId(e.target.value)}
              placeholder={
                newProvider === "notion"
                  ? "例: notion-root-hr-2026"
                  : "例: box-folder-sec-001"
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-medium text-slate-400">
              表示名
            </label>
            <input
              type="text"
              value={newTargetName}
              onChange={(e) => setNewTargetName(e.target.value)}
              placeholder="例: 人事・労務規定ページ群"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-end sm:col-span-2">
            <button
              type="submit"
              disabled={
                createTargetMutation.isPending ||
                newExternalId.trim().length === 0 ||
                newTargetName.trim().length === 0
              }
              className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createTargetMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              <span>追加</span>
            </button>
          </div>
        </form>

        {/* 登録済みターゲット一覧 */}
        <div className="mt-5">
          {targetsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-xs text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              読み込み中...
            </div>
          ) : hasSyncTargets ? (
            <div className="divide-y divide-slate-800/80 overflow-hidden rounded-2xl border border-slate-800">
              {syncTargets.map((target) => {
                const isNotion = target.provider === "notion"
                return (
                  <div
                    key={target.id}
                    className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/40 px-4 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                          isNotion
                            ? "border-slate-700 bg-slate-800 text-slate-200"
                            : "border-sky-500/40 bg-sky-500/15 text-sky-300"
                        }`}
                      >
                        {isNotion ? "Notion" : "Box"}
                      </span>
                      <span className="font-semibold text-white">
                        {target.name}
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-400">
                        ID: {target.externalId}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span>
                        最終同期: {formatDateTime(target.lastSyncedAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteTargetMutation.mutate(target.id)}
                        disabled={deleteTargetMutation.isPending}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
                        title="同期対象から削除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>削除</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-800/70 bg-slate-950/40 py-6 text-center text-xs text-slate-400">
              登録されている同期対象はありません。上のフォームから追加するか、「サンプルデータ投入
              (Seed)」を実行してください。
            </p>
          )}
        </div>
      </section>

      {/* 3. 同期ジョブ管理セクション */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">
              3. インデックス同期ジョブ管理
            </h2>
            <p className="text-xs text-slate-400">
              手動同期の即時トリガーと、過去のクローラ同期ジョブ履歴を確認できます。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => triggerSyncMutation.mutate("all")}
              disabled={triggerSyncMutation.isPending}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {triggerSyncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span>今すぐ手動同期を実行 (All)</span>
            </button>

            <button
              type="button"
              onClick={() => void jobsQuery.refetch()}
              className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>更新</span>
            </button>
          </div>
        </div>

        <div className="mt-5">
          {jobsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-xs text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ジョブ履歴を読み込み中...
            </div>
          ) : hasSyncJobs ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold">ジョブ ID</th>
                    <th className="px-4 py-3 font-semibold">対象</th>
                    <th className="px-4 py-3 font-semibold">ステータス</th>
                    <th className="px-4 py-3 font-semibold">処理件数</th>
                    <th className="px-4 py-3 font-semibold">開始時刻</th>
                    <th className="px-4 py-3 font-semibold">完了時刻</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 bg-slate-900/30">
                  {syncJobs.map((job) => {
                    const isCompleted = job.status === "completed"
                    const isRunning = job.status === "running"
                    return (
                      <tr key={job.id} className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                          {job.id}
                        </td>
                        <td className="px-4 py-3 uppercase font-semibold">
                          {job.provider}
                        </td>
                        <td className="px-4 py-3">
                          {isCompleted ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" />
                              completed
                            </span>
                          ) : isRunning ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                              <Clock className="h-3 w-3 animate-spin" />
                              running
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                              <AlertCircle className="h-3 w-3" />
                              failed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold text-white">
                          {job.processedCount} 件
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {formatDateTime(job.startedAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {formatDateTime(job.finishedAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-800/70 bg-slate-950/40 py-6 text-center text-xs text-slate-400">
              同期ジョブの実行履歴はまだありません。
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
