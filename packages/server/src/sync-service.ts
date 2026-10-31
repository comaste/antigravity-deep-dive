import crypto from "node:crypto"
import {
  splitTextIntoChunks,
  type Provider,
  type SearchProviderFilter,
  type SyncJob,
  type SyncTarget,
} from "@antigravity/shared"
import {
  completeSyncJob,
  createSyncJob,
  createSyncTarget,
  getConnectorRecord,
  listSyncTargets,
  saveConnectorRecord,
  updateSyncTargetStatus,
  upsertDocumentWithChunks,
  type StoredChunkInput,
  type StoredDocumentRecord,
} from "./firestore.js"
import { generateTextEmbedding } from "./gemini.js"
import type { ScopedLogger } from "./logger.js"
import {
  fetchNotionTargetDocuments,
  getDemoNotionDocuments,
  type ExtractedSourceDocument,
} from "./connectors/notion.js"
import {
  fetchBoxTargetDocuments,
  getDemoBoxDocuments,
} from "./connectors/box.js"

function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
}

export interface SeedWorkspaceResult {
  documentsSeeded: number
  chunksSeeded: number
  job: SyncJob
}

/**
 * 1件の抽出済みドキュメントをチャンク分割し、各チャンクを 768 次元ベクトル化して Firestore に保存する。
 */
export async function indexExtractedDocument(
  provider: Provider,
  doc: ExtractedSourceDocument,
  logger: ScopedLogger,
): Promise<number> {
  const documentId = `${provider}-${doc.externalId}`
  const rawChunks = splitTextIntoChunks(doc.content, 600, 100)
  const hasNoChunks = rawChunks.length === 0
  if (hasNoChunks) {
    return 0
  }

  const chunkInputs: StoredChunkInput[] = []
  for (let i = 0; i < rawChunks.length; i++) {
    const chunkText = rawChunks[i] ?? ""
    const embeddingInput = `${doc.title}\n${chunkText}`
    const embedding = await generateTextEmbedding(embeddingInput, logger)

    chunkInputs.push({
      id: `${documentId}-chunk-${i}`,
      documentId,
      provider,
      chunkIndex: i,
      title: doc.title,
      url: doc.url,
      path: doc.path,
      author: doc.author,
      mimeType: doc.mimeType,
      content: chunkText,
      externalUpdatedAt: doc.externalUpdatedAt,
      embedding,
    })
  }

  const documentRecord: StoredDocumentRecord = {
    id: documentId,
    provider,
    externalId: doc.externalId,
    title: doc.title,
    url: doc.url,
    path: doc.path,
    author: doc.author,
    mimeType: doc.mimeType,
    contentHash: computeContentHash(doc.content),
    externalUpdatedAt: doc.externalUpdatedAt,
    syncedAt: new Date().toISOString(),
  }

  await upsertDocumentWithChunks(documentRecord, chunkInputs, logger)
  return chunkInputs.length
}

/**
 * 同期対象（SyncTarget）が1件も登録されていない初期状態でもすぐに同期・検索を試せるよう、
 * デフォルトの Notion ワークスペースと Box フォルダの SyncTarget を自動作成する。
 */
export async function ensureDefaultSyncTargets(): Promise<SyncTarget[]> {
  const existing = await listSyncTargets()
  const hasExistingTargets = existing.length > 0
  if (hasExistingTargets) {
    return existing
  }

  const defaultNotion = await createSyncTarget(
    {
      provider: "notion",
      externalId: "notion-root-engineering-wiki",
      name: "Engineering & Corporate Wiki (Notion)",
    },
    "notion-target-default",
  )

  const defaultBox = await createSyncTarget(
    {
      provider: "box",
      externalId: "box-folder-0-enterprise-docs",
      name: "全社共有ドキュメント・契約・設計書フォルダ (Box)",
    },
    "box-target-default",
  )

  return [defaultNotion, defaultBox]
}

/**
 * 手動トリガーまたは Cloud Scheduler からの定期同期ジョブを実行する。
 */
export async function triggerSyncWorkflow(
  providerFilter: SearchProviderFilter,
  logger: ScopedLogger,
): Promise<SyncJob> {
  const job = await createSyncJob(providerFilter)
  logger.info(
    "sync.job.started",
    `Started sync job ${job.id} for provider=${providerFilter}`,
    {
      jobId: job.id,
      provider: providerFilter,
    },
  )

  try {
    const allTargets = await ensureDefaultSyncTargets()
    const isSpecificProvider = providerFilter !== "all"
    const activeTargets = allTargets.filter((target) => {
      const matchesProvider =
        !isSpecificProvider || target.provider === providerFilter
      return target.enabled && matchesProvider
    })

    let processedDocumentCount = 0
    const syncedProviders = new Set<Provider>()

    for (const target of activeTargets) {
      await updateSyncTargetStatus(target.id, "syncing")

      const connector = await getConnectorRecord(target.provider)
      const isNotion = target.provider === "notion"
      const sourceDocs = isNotion
        ? await fetchNotionTargetDocuments(
            target,
            connector.accessToken,
            logger,
          )
        : await fetchBoxTargetDocuments(target, connector.accessToken, logger)

      // 同一プロバイダのデモ文書が複数ターゲットで重複インデックスされないよう調整
      const alreadySyncedDemo =
        syncedProviders.has(target.provider) &&
        (!connector.accessToken || connector.accessToken.startsWith("demo-"))
      if (!alreadySyncedDemo) {
        for (const doc of sourceDocs) {
          await indexExtractedDocument(target.provider, doc, logger)
          processedDocumentCount += 1
        }
        syncedProviders.add(target.provider)
      }

      await updateSyncTargetStatus(
        target.id,
        "completed",
        new Date().toISOString(),
      )
    }

    const completedJob = await completeSyncJob(
      job.id,
      "completed",
      processedDocumentCount,
      null,
    )

    logger.info("sync.job.completed", `Completed sync job ${job.id}`, {
      jobId: job.id,
      processedCount: processedDocumentCount,
    })

    return completedJob
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(
      "sync.job.failed",
      `Sync job ${job.id} failed: ${errorMessage}`,
      {
        jobId: job.id,
      },
    )
    return completeSyncJob(job.id, "failed", 0, errorMessage)
  }
}

/**
 * サンプルデータ（Notion 4件 + Box 4件 + コネクタ接続状態 + 同期ターゲット）を一括投入する。
 */
export async function seedDemoWorkspaceData(
  logger: ScopedLogger,
): Promise<SeedWorkspaceResult> {
  await saveConnectorRecord(
    {
      provider: "notion",
      connected: true,
      workspaceName: "CureApp Tech & Corp Workspace (Demo)",
      accessToken: "demo-notion-token",
      refreshToken: null,
      expiresAt: null,
      updatedAt: new Date().toISOString(),
    },
    logger,
  )

  await saveConnectorRecord(
    {
      provider: "box",
      connected: true,
      workspaceName: "CureApp Box Enterprise Storage (Demo)",
      accessToken: "demo-box-access-token",
      refreshToken: "demo-box-refresh-token",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    logger,
  )

  const targets = await ensureDefaultSyncTargets()
  const job = await createSyncJob("all")

  let documentsSeeded = 0
  let chunksSeeded = 0

  const notionDocs = getDemoNotionDocuments()
  for (const doc of notionDocs) {
    chunksSeeded += await indexExtractedDocument("notion", doc, logger)
    documentsSeeded += 1
  }

  const boxDocs = getDemoBoxDocuments()
  for (const doc of boxDocs) {
    chunksSeeded += await indexExtractedDocument("box", doc, logger)
    documentsSeeded += 1
  }

  const now = new Date().toISOString()
  for (const target of targets) {
    await updateSyncTargetStatus(target.id, "completed", now)
  }

  const completedJob = await completeSyncJob(
    job.id,
    "completed",
    documentsSeeded,
    null,
  )

  logger.info(
    "seed.demo.completed",
    "Seeded demo Notion and Box documents into Firestore",
    {
      documentsSeeded,
      chunksSeeded,
    },
  )

  return {
    documentsSeeded,
    chunksSeeded,
    job: completedJob,
  }
}
