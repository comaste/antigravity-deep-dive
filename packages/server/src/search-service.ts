import {
  computeRrfScores,
  extractQueryTokens,
  type RankedCandidate,
  type SearchRequest,
  type SearchResponse,
  type SearchResultHit,
} from "@antigravity/shared"
import {
  COLLECTIONS,
  db,
  FieldValue,
  type StoredChunkDocument,
} from "./firestore.js"
import { generateSearchAiSummary, generateTextEmbedding } from "./gemini.js"
import type { ScopedLogger } from "./logger.js"

const CANDIDATE_LIMIT = 25

interface ScoredChunkCandidate {
  id: string
  documentId: string
  dot: number
}

function toChunkDocument(
  id: string,
  raw: Record<string, unknown>,
): StoredChunkDocument {
  return {
    id,
    documentId: String(raw.documentId ?? id),
    provider: raw.provider === "box" ? "box" : "notion",
    chunkIndex: Number(raw.chunkIndex ?? 0),
    title: String(raw.title ?? "Untitled"),
    url: String(raw.url ?? "#"),
    path: Array.isArray(raw.path) ? raw.path.map(String) : [],
    author: raw.author ? String(raw.author) : undefined,
    mimeType: raw.mimeType ? String(raw.mimeType) : undefined,
    content: String(raw.content ?? ""),
    searchTokens: Array.isArray(raw.searchTokens)
      ? raw.searchTokens.map(String)
      : [],
    externalUpdatedAt: String(
      raw.externalUpdatedAt ?? new Date().toISOString(),
    ),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  }
}

/**
 * Firestore Vector Search (`findNearest`) によるセマンティック検索を実行する。
 * エミュレータやインデックス未作成環境で `findNearest` が失敗した場合でも検索全体が止まらないよう、
 * 全チャンク取得＋インメモリコサイン類似度計算への安全なフォールバックを備える
 * （Why not: Vector Index ビルド中や古いエミュレータ環境で 500 エラーを返すと UX が損なわれるため）。
 */
async function runSemanticVectorSearch(
  queryVector: number[],
  provider: SearchRequest["provider"],
  chunkCache: Map<string, StoredChunkDocument>,
  logger: ScopedLogger,
): Promise<RankedCandidate[]> {
  const baseCollection = db.collection(COLLECTIONS.chunks)
  const isSpecificProvider = provider !== "all"
  const filteredQuery = isSpecificProvider
    ? baseCollection.where("provider", "==", provider)
    : baseCollection

  try {
    const vectorQuery = filteredQuery.findNearest({
      vectorField: "embedding",
      queryVector: FieldValue.vector(queryVector),
      limit: CANDIDATE_LIMIT,
      distanceMeasure: "COSINE",
    })

    const snapshot = await vectorQuery.get()
    const candidates: RankedCandidate[] = []

    for (const doc of snapshot.docs) {
      const chunk = toChunkDocument(doc.id, doc.data())
      chunkCache.set(chunk.id, chunk)
      candidates.push({
        id: chunk.id,
        documentId: chunk.documentId,
      })
    }

    return candidates
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(
      "search.semantic.find_nearest_fallback",
      "findNearest failed; falling back to in-memory cosine similarity scan",
      { errorMessage, provider },
    )

    const fallbackSnapshot = await filteredQuery.limit(200).get()
    const scored: ScoredChunkCandidate[] = []

    for (const doc of fallbackSnapshot.docs) {
      const raw = doc.data()
      const chunk = toChunkDocument(doc.id, raw)
      chunkCache.set(chunk.id, chunk)

      const embeddingObj = raw.embedding as {
        toArray?: () => number[]
        _values?: number[]
      } | undefined
      const vec =
        typeof embeddingObj?.toArray === "function"
          ? embeddingObj.toArray()
          : Array.isArray(embeddingObj?._values)
            ? embeddingObj._values
            : []

      let dot = 0
      const len = Math.min(vec.length, queryVector.length)
      for (let i = 0; i < len; i++) {
        dot += (vec[i] ?? 0) * (queryVector[i] ?? 0)
      }

      scored.push({
        id: chunk.id,
        documentId: chunk.documentId,
        dot,
      })
    }

    return scored
      .sort((a, b) => b.dot - a.dot)
      .slice(0, CANDIDATE_LIMIT)
      .map((item) => ({ id: item.id, documentId: item.documentId }))
  }
}

/**
 * Firestore の `array-contains-any` を使ったキーワード検索を実行する。
 * マッチしたトークン数が多いチャンクほど上位になるよう二次ソートを行う。
 */
async function runKeywordTokenSearch(
  queryTokens: string[],
  provider: SearchRequest["provider"],
  chunkCache: Map<string, StoredChunkDocument>,
  logger: ScopedLogger,
): Promise<RankedCandidate[]> {
  const hasNoQueryTokens = queryTokens.length === 0
  if (hasNoQueryTokens) {
    return []
  }

  const baseCollection = db.collection(COLLECTIONS.chunks)
  const isSpecificProvider = provider !== "all"
  const providerQuery = isSpecificProvider
    ? baseCollection.where("provider", "==", provider)
    : baseCollection

  try {
    const snapshot = await providerQuery
      .where("searchTokens", "array-contains-any", queryTokens.slice(0, 30))
      .limit(CANDIDATE_LIMIT)
      .get()

    const queryTokenSet = new Set(queryTokens)
    const scoredCandidates: {
      id: string
      documentId: string
      matchCount: number
    }[] = []

    for (const doc of snapshot.docs) {
      const chunk = toChunkDocument(doc.id, doc.data())
      chunkCache.set(chunk.id, chunk)

      let matchCount = 0
      for (const token of chunk.searchTokens) {
        if (queryTokenSet.has(token)) {
          matchCount += 1
        }
      }

      scoredCandidates.push({
        id: chunk.id,
        documentId: chunk.documentId,
        matchCount,
      })
    }

    return scoredCandidates
      .sort((a, b) => b.matchCount - a.matchCount)
      .map((item) => ({ id: item.id, documentId: item.documentId }))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(
      "search.keyword.failed",
      "Keyword search query failed; returning empty keyword candidates",
      { errorMessage },
    )
    return []
  }
}

/**
 * Firestore Vector Search + Keyword Search + RRF (Reciprocal Rank Fusion) ハイブリッド検索を実行する。
 */
export async function executeHybridSearch(
  request: SearchRequest,
  logger: ScopedLogger,
): Promise<SearchResponse> {
  const startedAt = Date.now()
  const queryTokens = extractQueryTokens(request.query, 30)
  const queryVector = await generateTextEmbedding(request.query, logger)

  const chunkCache = new Map<string, StoredChunkDocument>()

  const [semanticCandidates, keywordCandidates] = await Promise.all([
    runSemanticVectorSearch(queryVector, request.provider, chunkCache, logger),
    runKeywordTokenSearch(queryTokens, request.provider, chunkCache, logger),
  ])

  const rrfScored = computeRrfScores(semanticCandidates, keywordCandidates, 60)

  // 同一 documentId の複数チャンクがヒットした場合は、最も RRF スコアが高い代表チャンク1件に集約する
  // （Why not: 同じ長文ドキュメントの別チャンクばかりが検索結果上位を埋め尽くすのを防ぐため）
  const seenDocumentIds = new Set<string>()
  const queryTokenSet = new Set(queryTokens)
  const deduplicatedHits: SearchResultHit[] = []

  for (const scoredItem of rrfScored) {
    const isAlreadyIncluded = seenDocumentIds.has(scoredItem.documentId)
    if (isAlreadyIncluded) {
      continue
    }

    const chunk = chunkCache.get(scoredItem.id)
    if (!chunk) {
      continue
    }

    seenDocumentIds.add(scoredItem.documentId)

    const matchedTokens = chunk.searchTokens.filter((token) =>
      queryTokenSet.has(token),
    )

    deduplicatedHits.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      provider: chunk.provider,
      title: chunk.title,
      url: chunk.url,
      path: chunk.path,
      snippet: chunk.content,
      author: chunk.author,
      mimeType: chunk.mimeType,
      externalUpdatedAt: chunk.externalUpdatedAt,
      rrfScore: Number(scoredItem.rrfScore.toFixed(6)),
      semanticRank: scoredItem.semanticRank,
      keywordRank: scoredItem.keywordRank,
      matchedTokens: matchedTokens.slice(0, 12),
    })

    const reachedRequestedLimit = deduplicatedHits.length >= request.limit
    if (reachedRequestedLimit) {
      break
    }
  }

  const shouldGenerateSummary =
    request.includeAiSummary && deduplicatedHits.length > 0
  const aiSummary = shouldGenerateSummary
    ? await generateSearchAiSummary(request.query, deduplicatedHits, logger)
    : null

  const tookMs = Date.now() - startedAt

  logger.info(
    "search.hybrid.completed",
    `Hybrid search completed for "${request.query}"`,
    {
      query: request.query,
      provider: request.provider,
      semanticCount: semanticCandidates.length,
      keywordCount: keywordCandidates.length,
      returnedHits: deduplicatedHits.length,
      tookMs,
    },
  )

  return {
    query: request.query,
    provider: request.provider,
    totalHits: deduplicatedHits.length,
    hits: deduplicatedHits,
    aiSummary,
    traceId: logger.traceId,
    tookMs,
  }
}
