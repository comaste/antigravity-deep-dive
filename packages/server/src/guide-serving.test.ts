import { describe, expect, it } from "vitest"
import { app, resolveGuideHtmlPath, resolveWebDistPath } from "./index.js"

describe("guide documentation serving & fallback", () => {
  it("実体 guide.html のパスが正常に解決できることを保証する", () => {
    const path = resolveGuideHtmlPath()
    expect(path).not.toBeNull()
    expect(path).toMatch(/guide\.html$|index\.html$/)
  })

  it("GET /guide へのアクセス時に /guide.html へ 302 リダイレクトされることを保証する", async () => {
    const res = await app.request("/guide")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/guide.html")
  })

  it("GET /guide.html へのアクセス時にステータス 200 かつ text/html でガイド HTML が返却されることを保証する", async () => {
    const res = await app.request("/guide.html")
    expect(res.status).toBe(200)
    const contentType = res.headers.get("content-type")
    expect(contentType).toContain("text/html")

    const body = await res.text()
    expect(body).toContain("DeepSearch")
    expect(body).toContain("Notion")
    expect(body).toContain("Box")
  })

  it("フロントエンド Web SPA の出力パスが存在する場合に /admin へのアクセスで index.html が返却されることを保証する", async () => {
    const webDist = resolveWebDistPath()
    const isWebBuilt = webDist !== null
    if (!isWebBuilt) {
      // ビルド成果物が未生成の環境ではスキップ
      return
    }

    const res = await app.request("/admin")
    expect(res.status).toBe(200)
    const contentType = res.headers.get("content-type")
    expect(contentType).toContain("text/html")
  })
})
