import crypto from "node:crypto"
import { Firestore, FieldValue } from "@google-cloud/firestore"
import {
  extractSearchTokens,
  type ConnectorStatus,
  type CreateSyncTargetInput,
  type Provider,
  type SyncJob,
  type SyncTarget,
} from "@antigravity/shared"
import { createLogger, type ScopedLogger } from "./logger.js"
import { getSecretFromKeychainOrEnv } from "./secrets.js"

const bootLogger = createLogger("firestore-init")

const isProductionEnv = process.env.NODE_ENV === "production"
const hasEmulatorEnv = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

/**
 * ローカル開発時に FIRESTORE_EMULATOR_HOST が未設定の場合でも、誤って本番 Google Cloud 認証を探しに行って
 * クラッシュしないよう 127.0.0.1:8080 を既定セットする
 * （Why not: ADC 未設定のローカル環境で起動直後に認証エラーになるのを防ぐため）。
 */
if (!isProductionEnv && !hasEmulatorEnv) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
  bootLogger.info(
    "firestore.emulator.default_fallback",
    "FIRESTORE_EMULATOR_HOST was not set; defaulting to 127.0.0.1:8080 for local development",
    { emulatorHost: process.env.FIRESTORE_EMULATOR_HOST },
  )
} else if (hasEmulatorEnv) {
  bootLogger.info(
    "firestore.emulator.configured",
    "Connected to Firestore Emulator",
    { emulatorHost: process.env.FIRESTORE_EMULATOR_HOST },
  )
}

export const GCP_PROJECT_ID =
  process.env.GCP_PROJECT_ID ?? "demo-notion-box-search"

export const db = new Firestore({
  projectId: GCP_PROJECT_ID,
})

export { FieldValue }

export const COLLECTIONS = {
  connectors: "connectors",
  syncTargets: "syncTargets",
  documents: "documents",
  chunks: "chunks",
  syncJobs: "syncJobs",
} as const

export interface StoredConnectorRecord {
  provider: Provider
  connected: boolean
  workspaceName: string | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: string | null
  updatedAt: string | null
}

export interface StoredDocumentRecord {
  id: string
  provider: Provider
  externalId: string
  title: string
  url: string
  path: string[]
  author?: string
  mimeType?: string
  contentHash: string
  externalUpdatedAt: string
  syncedAt: string
}

export interface StoredChunkInput {
  id: string
  documentId: string
  provider: Provider
  chunkIndex: number
  title: string
  url: string
  path: string[]
  author?: string
  mimeType?: string
  content: string
  externalUpdatedAt: string
  embedding: number[]
}

export interface StoredChunkDocument {
  id: string
  documentId: string
  provider: Provider
  chunkIndex: number
  title: string
  url: string
  path: string[]
  author?: string
  mimeType?: string
  content: string
  searchTokens: string[]
  externalUpdatedAt: string
  updatedAt: string
}

export async function getConnectorRecord(
  provider: Provider,
): Promise<StoredConnectorRecord> {
  const snapshot = await db
    .collection(COLLECTIONS.connectors)
    .doc(provider)
    .get()
  const exists = snapshot.exists

  if (!exists) {
    const isNotion = provider === "notion"
    const keychainToken = isNotion
      ? getSecretFromKeychainOrEnv("NOTION_API_KEY")
      : getSecretFromKeychainOrEnv("BOX_DEVELOPER_TOKEN")
    const hasKeychainToken = keychainToken.length > 0

    if (hasKeychainToken) {
      return {
        provider,
        connected: true,
        workspaceName: isNotion
          ? "Notion Workspace (Keychain Token)"
          : "Box Storage (Keychain Developer Token)",
        accessToken: keychainToken,
        refreshToken: null,
        expiresAt: null,
        updatedAt: new Date().toISOString(),
      }
    }

    return {
      provider,
      connected: false,
      workspaceName: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      updatedAt: null,
    }
  }

  const data = snapshot.data() as Partial<StoredConnectorRecord>
  return {
    provider,
    connected: Boolean(data.connected),
    workspaceName: data.workspaceName ?? null,
    accessToken: data.accessToken ?? null,
    refreshToken: data.refreshToken ?? null,
    expiresAt: data.expiresAt ?? null,
    updatedAt: data.updatedAt ?? null,
  }
}

export async function listConnectorStatuses(): Promise<ConnectorStatus[]> {
  const providers: Provider[] = ["notion", "box"]
  const statuses: ConnectorStatus[] = []

  for (const provider of providers) {
    const record = await getConnectorRecord(provider)
    statuses.push({
      provider: record.provider,
      connected: record.connected,
      workspaceName: record.workspaceName,
      updatedAt: record.updatedAt,
    })
  }

  return statuses
}

export async function saveConnectorRecord(
  record: StoredConnectorRecord,
  logger: ScopedLogger,
): Promise<ConnectorStatus> {
  const now = new Date().toISOString()
  const updated: StoredConnectorRecord = {
    ...record,
    updatedAt: now,
  }

  await db
    .collection(COLLECTIONS.connectors)
    .doc(record.provider)
    .set(updated, { merge: true })
  logger.info(
    "firestore.connector.saved",
    `Saved connector status for ${record.provider}`,
    {
      provider: record.provider,
      connected: record.connected,
      workspaceName: record.workspaceName,
    },
  )

  return {
    provider: updated.provider,
    connected: updated.connected,
    workspaceName: updated.workspaceName,
    updatedAt: updated.updatedAt,
  }
}

export async function listSyncTargets(
  providerFilter?: Provider,
): Promise<SyncTarget[]> {
  const baseRef = db.collection(COLLECTIONS.syncTargets)
  const hasProviderFilter = Boolean(providerFilter)
  const queryRef = hasProviderFilter
    ? baseRef.where("provider", "==", providerFilter)
    : baseRef
  const snapshot = await queryRef.get()

  const targets: SyncTarget[] = snapshot.docs.map((doc) => {
    const data = doc.data() as Partial<SyncTarget>
    return {
      id: doc.id,
      provider: data.provider as Provider ?? "notion",
      externalId: data.externalId ?? "",
      name: data.name ?? "",
      enabled: data.enabled ?? true,
      lastSyncedAt: data.lastSyncedAt ?? null,
      status: data.status ?? "idle",
    }
  })

  return targets.sort((a, b) => a.name.localeCompare(b.name, "ja"))
}

export async function createSyncTarget(
  input: CreateSyncTargetInput,
  customId?: string,
): Promise<SyncTarget> {
  const id =
    customId ?? `${input.provider}-target-${crypto.randomUUID().slice(0, 8)}`
  const target: SyncTarget = {
    id,
    provider: input.provider,
    externalId: input.externalId,
    name: input.name,
    enabled: true,
    lastSyncedAt: null,
    status: "idle",
  }

  await db.collection(COLLECTIONS.syncTargets).doc(id).set(target)
  return target
}

export async function updateSyncTargetStatus(
  id: string,
  status: SyncTarget["status"],
  lastSyncedAt?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  const shouldUpdateTimestamp = lastSyncedAt !== undefined
  if (shouldUpdateTimestamp) {
    patch.lastSyncedAt = lastSyncedAt
  }
  await db
    .collection(COLLECTIONS.syncTargets)
    .doc(id)
    .set(patch, { merge: true })
}

export async function deleteSyncTarget(id: string): Promise<boolean> {
  const docRef = db.collection(COLLECTIONS.syncTargets).doc(id)
  const snapshot = await docRef.get()
  const exists = snapshot.exists
  if (!exists) {
    return false
  }
  await docRef.delete()
  return true
}

export async function upsertDocumentWithChunks(
  documentRecord: StoredDocumentRecord,
  chunks: StoredChunkInput[],
  logger: ScopedLogger,
): Promise<void> {
  const docRef = db.collection(COLLECTIONS.documents).doc(documentRecord.id)

  // 既存の古いチャンクが残らないよう、同じ documentId のチャンクを先に削除してからバッチ書き込みする
  // （Why not: チャンク数が減った更新時に孤立チャンクが検索結果に混입するのを防ぐため）
  const existingChunksSnapshot = await db
    .collection(COLLECTIONS.chunks)
    .where("documentId", "==", documentRecord.id)
    .get()

  const batch = db.batch()
  batch.set(docRef, documentRecord, { merge: true })

  for (const oldDoc of existingChunksSnapshot.docs) {
    batch.delete(oldDoc.ref)
  }

  const now = new Date().toISOString()
  for (const chunk of chunks) {
    const chunkRef = db.collection(COLLECTIONS.chunks).doc(chunk.id)
    const searchTokens = extractSearchTokens(`${chunk.title} ${chunk.content}`)

    batch.set(chunkRef, {
      id: chunk.id,
      documentId: chunk.documentId,
      provider: chunk.provider,
      chunkIndex: chunk.chunkIndex,
      title: chunk.title,
      url: chunk.url,
      path: chunk.path,
      author: chunk.author ?? "Unknown",
      mimeType: chunk.mimeType ?? "text/plain",
      content: chunk.content,
      searchTokens,
      embedding: FieldValue.vector(chunk.embedding),
      externalUpdatedAt: chunk.externalUpdatedAt,
      updatedAt: now,
    })
  }

  await batch.commit()
  logger.info(
    "firestore.document.upserted",
    `Upserted document ${documentRecord.id} with ${chunks.length} chunks`,
    {
      documentId: documentRecord.id,
      provider: documentRecord.provider,
      chunkCount: chunks.length,
    },
  )
}

export async function createSyncJob(
  provider: SyncJob["provider"],
): Promise<SyncJob> {
  const id = `job-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`
  const job: SyncJob = {
    id,
    provider,
    status: "running",
    processedCount: 0,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }

  await db.collection(COLLECTIONS.syncJobs).doc(id).set(job)
  return job
}

export async function completeSyncJob(
  id: string,
  status: "completed" | "failed",
  processedCount: number,
  errorMessage: string | null = null,
): Promise<SyncJob> {
  const finishedAt = new Date().toISOString()
  const patch = {
    status,
    processedCount,
    errorMessage,
    finishedAt,
  }
  await db.collection(COLLECTIONS.syncJobs).doc(id).set(patch, { merge: true })
  const snapshot = await db.collection(COLLECTIONS.syncJobs).doc(id).get()
  return snapshot.data() as SyncJob
}

export async function listSyncJobs(limit = 20): Promise<SyncJob[]> {
  const snapshot = await db.collection(COLLECTIONS.syncJobs).get()
  const jobs = snapshot.docs.map((doc) => doc.data() as SyncJob)
  return jobs
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
}
