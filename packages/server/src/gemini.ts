import { GoogleGenAI } from "@google/genai"
import {
  extractSearchTokens,
  type AiCitation,
  type AiSummary,
  type SearchResultHit,
} from "@antigravity/shared"
import type { ScopedLogger } from "./logger.js"
import { getSecretFromKeychainOrEnv } from "./secrets.js"

export const EMBEDDING_MODEL = "gemini-embedding-001"
export const GENERATION_MODEL = "gemini-3.8-flash"
export const EMBEDDING_DIMENSION = 768

let cachedClient: GoogleGenAI | null = null

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getSecretFromKeychainOrEnv("GEMINI_API_KEY")
  const isApiKeyMissing = apiKey.length === 0
  if (isApiKeyMissing) {
    return null
  }

  const hasCachedClient = cachedClient !== null
  if (hasCachedClient) {
    return cachedClient
  }

  cachedClient = new GoogleGenAI({ apiKey })
  return cachedClient
}

/**
 * ベクトル長を 1.0 に正規化する（gemini-embedding-001 の 768 次元出力およびローカルハッシュベクトル共通）。
 */
export function normalizeVector(values: number[]): number[] {
  let squaredSum = 0
  for (const val of values) {
    squaredSum += val * val
  }

  const norm = Math.sqrt(squaredSum)
  const isZeroNorm = norm === 0
  if (isZeroNorm) {
    const fallback = Array.from({ length: values.length }, () => 0)
    const hasElements = fallback.length > 0
    if (hasElements) {
      fallback[0] = 1
    }
    return fallback
  }

  return values.map((val) => Number((val / norm).toFixed(6)))
}

/**
 * GEMINI_API_KEY 未設定のローカル検証環境でも Firestore Vector Search (`findNearest`) がそのまま動作するよう、
 * テキストの検索トークンと文字 N-gram から決定論的な 768 次元正規化ベクトルを生成する
 * （Why not: ランダムベクトルを返すと意味的・語彙的に近い文書同士のコサイン距離が機能しなくなるため、Feature Hashing 法を採用）。
 */
export function buildDeterministicFallbackEmbedding(
  text: string,
  dimension = EMBEDDING_DIMENSION,
): number[] {
  const vector = Array.from({ length: dimension }, () => 0)
  const normalized = text.toLowerCase().normalize("NFKC").trim()
  const isEmpty = normalized.length === 0
  if (isEmpty) {
    vector[0] = 1
    return vector
  }

  const tokens = extractSearchTokens(normalized, 300)
  const features = [...tokens]

  // 1文字単位のユニグラム特徴も混ぜて短い日本語クエリの再現率を高める
  for (let i = 0; i < Math.min(normalized.length, 200); i++) {
    const ch = normalized[i]
    const isWhitespace = !ch || /\s/.test(ch)
    if (!isWhitespace) {
      features.push(`u:${ch}`)
    }
  }

  for (const feature of features) {
    let hash1 = 2166136261
    let hash2 = 16777619
    for (let i = 0; i < feature.length; i++) {
      const code = feature.charCodeAt(i)
      hash1 ^= code
      hash1 = Math.imul(hash1, 16777619)
      hash2 ^= code
      hash2 = Math.imul(hash2, 1099511627)
    }

    const index = Math.abs(hash1) % dimension
    const sign = (hash2 & 1) === 0 ? 1 : -1
    const weight = feature.startsWith("u:") ? 0.4 : 1.5
    vector[index] = (vector[index] ?? 0) + sign * weight
  }

  return normalizeVector(vector)
}

/**
 * テキストを 768 次元ベクトルに変換する。
 * GEMINI_API_KEY 設定時は `gemini-embedding-001` を呼び出し、未設定または失敗時は決定論的 Feature Hashing にフォールバックする。
 */
export async function generateTextEmbedding(
  text: string,
  logger: ScopedLogger,
): Promise<number[]> {
  const client = getGeminiClient()
  const isOfflineMode = client === null
  if (isOfflineMode) {
    return buildDeterministicFallbackEmbedding(text, EMBEDDING_DIMENSION)
  }

  try {
    const response = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: {
        outputDimensionality: EMBEDDING_DIMENSION,
      },
    })

    const rawValues = response.embeddings?.[0]?.values
    const hasValidValues =
      Array.isArray(rawValues) && rawValues.length === EMBEDDING_DIMENSION
    if (!hasValidValues) {
      logger.warn(
        "gemini.embedding.invalid_shape",
        "Embedding response did not match expected 768 dimensions; using fallback vector",
      )
      return buildDeterministicFallbackEmbedding(text, EMBEDDING_DIMENSION)
    }

    return normalizeVector(rawValues)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(
      "gemini.embedding.fallback",
      `Failed to call ${EMBEDDING_MODEL}; falling back to deterministic vector`,
      { errorMessage },
    )
    return buildDeterministicFallbackEmbedding(text, EMBEDDING_DIMENSION)
  }
}

function buildLocalFallbackSummary(
  query: string,
  topHits: SearchResultHit[],
): AiSummary {
  const citations: AiCitation[] = topHits.slice(0, 5).map((hit, idx) => ({
    index: idx + 1,
    documentId: hit.documentId,
    provider: hit.provider,
    title: hit.title,
    url: hit.url,
  }))

  const bulletLines = topHits.slice(0, 4).map((hit, idx) => {
    const providerLabel = hit.provider === "notion" ? "Notion" : "Box"
    const compactSnippet = hit.snippet.replace(/\s+/g, " ").slice(0, 140)
    return `- **[${idx + 1}] ${hit.title} (${providerLabel})**: ${compactSnippet}`
  })

  const answerMarkdown = [
    `「**${query}**」に関連する社内ドキュメント（Notion / Box）から以下の要点を抽出しました：`,
    "",
    ...bulletLines,
    "",
    "詳細は各引用リンク `[1]`〜から元ドキュメントを参照してください。",
  ].join("\n")

  return {
    answerMarkdown,
    citations,
    model: `${GENERATION_MODEL} (local-rag-synthesizer)`,
  }
}

/**
 * 検索上位チャンク（最大5件）をコンテキストとして、引用番号 `[1]`, `[2]` 付きの AI 要約回答を生成する。
 * `gemini-3.8-flash` (`client.interactions.create`) を使用する。
 */
export async function generateSearchAiSummary(
  query: string,
  hits: SearchResultHit[],
  logger: ScopedLogger,
): Promise<AiSummary | null> {
  const hasNoHits = hits.length === 0
  if (hasNoHits) {
    return null
  }

  const topHits = hits.slice(0, 5)
  const citations: AiCitation[] = topHits.map((hit, index) => ({
    index: index + 1,
    documentId: hit.documentId,
    provider: hit.provider,
    title: hit.title,
    url: hit.url,
  }))

  const client = getGeminiClient()
  const isOfflineMode = client === null
  if (isOfflineMode) {
    return buildLocalFallbackSummary(query, topHits)
  }

  const contextBlocks = topHits
    .map(
      (hit, index) =>
        `[${index + 1}] タイトル: ${hit.title} (提供元: ${hit.provider.toUpperCase()}, パス: ${hit.path.join(" / ")})\n内容: ${hit.snippet}`,
    )
    .join("\n\n")

  const prompt = [
    "あなたは社内横断検索アシスタントです。以下の検索結果コンテキストのみに基づいて、ユーザーの質問に対する簡潔で正確な日本語の回答を Markdown 形式で作成してください。",
    "回答文中で参照した情報には必ず `[1]`, `[2]` のように対応する引用番号を付与してください。",
    "",
    `ユーザーの検索クエリ: ${query}`,
    "",
    "検索結果コンテキスト:",
    contextBlocks,
  ].join("\n")

  try {
    const interaction = await client.interactions.create({
      model: GENERATION_MODEL,
      input: prompt,
    })

    const outputText = interaction.output_text?.trim() ?? ""
    const isEmptyOutput = outputText.length === 0
    if (isEmptyOutput) {
      return buildLocalFallbackSummary(query, topHits)
    }

    return {
      answerMarkdown: outputText,
      citations,
      model: GENERATION_MODEL,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(
      "gemini.summary.fallback",
      `Failed to generate summary with ${GENERATION_MODEL}; using local fallback summary`,
      { errorMessage },
    )
    return buildLocalFallbackSummary(query, topHits)
  }
}

/**
 * Box 等のスキャン PDF や画像ファイルでテキスト表現が空だった場合、`gemini-3.8-flash` のマルチモーダル入力でテキストを抽出する。
 */
export async function extractTextFromDocumentBuffer(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  logger: ScopedLogger,
): Promise<string> {
  const client = getGeminiClient()
  const isOfflineMode = client === null
  if (isOfflineMode) {
    logger.info(
      "gemini.ocr.offline_fallback",
      `GEMINI_API_KEY is not set; returning metadata placeholder for ${fileName}`,
    )
    return `${fileName} (${mimeType}) のスキャン文書コンテンツ`
  }

  try {
    const base64Data = fileBuffer.toString("base64")
    const isPdf = mimeType === "application/pdf"
    const contentType = isPdf ? "document" : "image"

    const interaction = await client.interactions.create({
      model: GENERATION_MODEL,
      input: [
        {
          type: contentType,
          data: base64Data,
          mime_type: mimeType,
        },
        {
          type: "text",
          text: `このドキュメント（ファイル名: ${fileName}）に含まれるすべてのテキスト・見出し・表の数値を検索インデックス向けに正確にプレーンテキストへ書き起こしてください。`,
        },
      ],
    })

    return interaction.output_text?.trim() ?? ""
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(
      "gemini.ocr.failed",
      `Failed to extract text from binary document ${fileName}`,
      { errorMessage, mimeType },
    )
    return ""
  }
}
