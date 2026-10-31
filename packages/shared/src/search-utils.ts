/**
 * 日本語・英数字のハイブリッド検索向けに、テキストから検索用トークン配列（英単語 + 日本語Bi-gram）を生成する。
 * Firestore 単体では日本語形態素解析を持たないため、Bi-gram + 単語分割トークンを `searchTokens` 配列に格納し
 * `array-contains-any` クエリで高速なキーワード候補抽出を行う（Why not: 外部全文検索エンジンの追加コストと運用負荷を避けるため）。
 */
export function extractSearchTokens(text: string, maxTokens = 250): string[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .trim()

  const isEmptyText = normalized.length === 0
  if (isEmptyText) {
    return []
  }

  const tokenSet = new Set<string>()

  // 英数字の単語（2文字以上）を抽出
  const asciiWords = normalized.match(/[a-z0-9_-]{2,}/g) ?? []
  for (const word of asciiWords) {
    tokenSet.add(word)
    const reachedLimit = tokenSet.size >= maxTokens
    if (reachedLimit) {
      return Array.from(tokenSet)
    }
  }

  // 記号や空白を除去した文字列から日本語・漢字・カナの Bi-gram (2文字組) を抽出
  const cleanedForBigrams = normalized.replace(
    /[\s!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~、「」。・（）【】『』「」〜：；！？]/g,
    "",
  )

  for (let i = 0; i < cleanedForBigrams.length - 1; i++) {
    const bigram = cleanedForBigrams.slice(i, i + 2)
    const isPureAscii = /^[a-z0-9]{2}$/.test(bigram)
    if (!isPureAscii) {
      tokenSet.add(bigram)
    }
    const reachedLimit = tokenSet.size >= maxTokens
    if (reachedLimit) {
      break
    }
  }

  return Array.from(tokenSet)
}

/**
 * Firestore の `array-contains-any` の上限（最大30要素）に収まるようクエリトークンを抽出する。
 */
export function extractQueryTokens(query: string, limit = 30): string[] {
  return extractSearchTokens(query, limit)
}

export interface RankedCandidate {
  id: string
  documentId: string
}

export interface RrfScoredItem {
  id: string
  documentId: string
  rrfScore: number
  semanticRank: number | null
  keywordRank: number | null
}

/**
 * Reciprocal Rank Fusion (RRF) によりベクトル検索順位とキーワード検索順位を統合する。
 * RRF_Score(d) = 1 / (k + rank_semantic(d)) + 1 / (k + rank_keyword(d))
 */
export function computeRrfScores(
  semanticCandidates: RankedCandidate[],
  keywordCandidates: RankedCandidate[],
  k = 60,
): RrfScoredItem[] {
  const scoreMap = new Map<string, RrfScoredItem>()

  semanticCandidates.forEach((candidate, index) => {
    const rank = index + 1
    const score = 1 / (k + rank)
    scoreMap.set(candidate.id, {
      id: candidate.id,
      documentId: candidate.documentId,
      rrfScore: score,
      semanticRank: rank,
      keywordRank: null,
    })
  })

  keywordCandidates.forEach((candidate, index) => {
    const rank = index + 1
    const addedScore = 1 / (k + rank)
    const existing = scoreMap.get(candidate.id)

    if (existing) {
      existing.rrfScore += addedScore
      existing.keywordRank = rank
      return
    }

    scoreMap.set(candidate.id, {
      id: candidate.id,
      documentId: candidate.documentId,
      rrfScore: addedScore,
      semanticRank: null,
      keywordRank: rank,
    })
  })

  return Array.from(scoreMap.values()).sort((a, b) => b.rrfScore - a.rrfScore)
}

/**
 * 長文ドキュメントを検索・RAGに適したサイズ（既定 600 文字、オーバーラップ 100 文字）のチャンクに分割する。
 */
export function splitTextIntoChunks(
  text: string,
  chunkSize = 600,
  overlap = 100,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim()
  const isEmpty = normalized.length === 0
  if (isEmpty) {
    return []
  }

  const isShortEnough = normalized.length <= chunkSize
  if (isShortEnough) {
    return [normalized]
  }

  const chunks: string[] = []
  let start = 0
  const step = Math.max(1, chunkSize - overlap)

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length)
    chunks.push(normalized.slice(start, end).trim())
    const reachedEnd = end >= normalized.length
    if (reachedEnd) {
      break
    }
    start += step
  }

  return chunks.filter((chunk) => chunk.length > 0)
}
