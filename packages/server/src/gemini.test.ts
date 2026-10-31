import { describe, expect, it } from "vitest"
import {
  buildDeterministicFallbackEmbedding,
  EMBEDDING_DIMENSION,
  normalizeVector,
} from "./gemini.js"
import { getDemoNotionDocuments } from "./connectors/notion.js"
import { getDemoBoxDocuments } from "./connectors/box.js"

describe("gemini deterministic fallback embedding & demo connectors", () => {
  it("768次元の正規化済みベクトルを決定論的に生成し、類似テキスト間のコサイン類似度が高くなることを保証する", () => {
    const vecA = buildDeterministicFallbackEmbedding(
      "情報セキュリティ インシデント CSIRT 初動対応",
    )
    const vecB = buildDeterministicFallbackEmbedding(
      "セキュリティ インシデント発生時の CSIRT 連絡ルール",
    )
    const vecUnrelated = buildDeterministicFallbackEmbedding(
      "リモートワーク在宅勤務手当とエルゴノミクスチェア購入精算",
    )

    expect(vecA).toHaveLength(EMBEDDING_DIMENSION)
    expect(vecB).toHaveLength(EMBEDDING_DIMENSION)

    const normA = Math.sqrt(vecA.reduce((acc, v) => acc + v * v, 0))
    expect(normA).toBeCloseTo(1, 3)

    const dotRelated = vecA.reduce((acc, v, i) => acc + v * (vecB[i] ?? 0), 0)
    const dotUnrelated = vecA.reduce(
      (acc, v, i) => acc + v * (vecUnrelated[i] ?? 0),
      0,
    )

    expect(dotRelated).toBeGreaterThan(dotUnrelated)
  })

  it("ゼロベクトルを正規化しても NaN にならず単位ベクトルへフォールバックすることを保証する", () => {
    const normalized = normalizeVector([0, 0, 0, 0])
    expect(normalized).toEqual([1, 0, 0, 0])
  })

  it("Notion 4件・Box 4件のサンプルドキュメントが定義されていることを保証する", () => {
    const notionDocs = getDemoNotionDocuments()
    const boxDocs = getDemoBoxDocuments()

    expect(notionDocs).toHaveLength(4)
    expect(boxDocs).toHaveLength(4)
  })
})
