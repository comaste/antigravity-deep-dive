import type {
  ConnectorStatus,
  CreateSyncTargetInput,
  Provider,
  SearchRequest,
  SearchResponse,
  SyncJob,
  SyncTarget,
} from "@antigravity/shared"

/**
 * 共通の JSON API リクエストヘルパー。
 * fetch 標準 API を薄いラッパーで包み、HTTP エラーステータス時にサーバーからのエラーメッセージを抽出する
 * （Why not: axios 等の外部 HTTP クライアントライブラリを追加するとバンドルサイズが増え、標準 fetch で十分な機能しか使わないため）。
 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })

  const isResponseOk = response.ok
  if (!isResponseOk) {
    const errorBody = await response.json().catch(() => null)
    const hasErrorMessage =
      errorBody !== null &&
      typeof errorBody === "object" &&
      "error" in errorBody &&
      typeof (errorBody as { error?: unknown }).error === "string"

    if (hasErrorMessage) {
      throw new Error((errorBody as { error: string }).error)
    }

    throw new Error(`API Error: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export async function searchDocuments(
  payload: SearchRequest,
): Promise<SearchResponse> {
  return requestJson<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function fetchConnectors(): Promise<{
  connectors: ConnectorStatus[]
}> {
  return requestJson<{ connectors: ConnectorStatus[] }>("/api/admin/connectors")
}

export interface DemoConnectResponse {
  connector?: ConnectorStatus
  ok?: boolean
}

export async function demoConnectProvider(
  provider: Provider,
): Promise<DemoConnectResponse> {
  return requestJson<DemoConnectResponse>(
    `/api/admin/connectors/${provider}/demo-connect`,
    {
      method: "POST",
    },
  )
}

export async function fetchSyncTargets(): Promise<{ targets: SyncTarget[] }> {
  return requestJson<{ targets: SyncTarget[] }>("/api/admin/targets")
}

export async function createSyncTarget(
  input: CreateSyncTargetInput,
): Promise<{ target: SyncTarget }> {
  return requestJson<{ target: SyncTarget }>("/api/admin/targets", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function deleteSyncTarget(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(
    `/api/admin/targets/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  )
}

export async function triggerSyncJob(
  provider: "all" | "notion" | "box" = "all",
): Promise<{ job: SyncJob }> {
  return requestJson<{ job: SyncJob }>("/api/sync/trigger", {
    method: "POST",
    body: JSON.stringify({ provider }),
  })
}

export async function fetchSyncJobs(): Promise<{ jobs: SyncJob[] }> {
  return requestJson<{ jobs: SyncJob[] }>("/api/admin/jobs")
}

export async function seedSampleData(): Promise<{
  ok?: boolean
  seededDocuments?: number
  seededChunks?: number
  message?: string
}> {
  return requestJson<{
    ok?: boolean
    seededDocuments?: number
    seededChunks?: number
    message?: string
  }>("/api/admin/seed", {
    method: "POST",
  })
}
