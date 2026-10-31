import { describe, expect, it } from "vitest"
import {
  computeRrfScores,
  extractQueryTokens,
  extractSearchTokens,
  splitTextIntoChunks,
} from "./search-utils.js"

describe("extractSearchTokens", () => {
  it("日本語のBi-gramと英数字単語の両方を抽出して検索トークン化できることを保証する", () => {
    const tokens = extractSearchTokens("NotionとBoxのAPI仕様書2026")
    expect(tokens).toContain("notion")
    expect(tokens).toContain("box")
    expect(tokens).toContain("api")
    expect(tokens).toContain("仕様")
    expect(tokens).toContain("様書")
  })

  it("クエリトークン抽出時はFirestoreのarray-contains-any上限(30個)を超えないことを保証する", () => {
    const longQuery =
      "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
    const queryTokens = extractQueryTokens(longQuery)
    expect(queryTokens.length).toBeLessThanOrEqual(30)
  })
})

describe("computeRrfScores", () => {
  it("意味検索とキーワード検索の両方にヒットしたチャンクが最上位にランク付けされることを保証する", () => {
    const semantic = [
      { id: "chunk-1", documentId: "doc-1" },
      { id: "chunk-2", documentId: "doc-2" },
    ]
    const keyword = [
      { id: "chunk-2", documentId: "doc-2" },
      { id: "chunk-3", documentId: "doc-3" },
    ]

    const results = computeRrfScores(semantic, keyword, 60)
    expect(results[0]?.id).toBe("chunk-2")
    expect(results[0]?.semanticRank).toBe(2)
    expect(results[0]?.keywordRank).toBe(1)
    expect(results.length).toBe(3)
  })
})

describe("splitTextIntoChunks", () => {
  it("指定文字数とオーバーラップで長文を複数のチャンクに分割できることを保証する", () => {
    const text = "A".repeat(500) + "B".repeat(500)
    const chunks = splitTextIntoChunks(text, 600, 100)
    expect(chunks.length).toBe(2)
    expect(chunks[0]?.length).toBe(600)
    expect(chunks[1]?.length).toBe(500)
  })
})
