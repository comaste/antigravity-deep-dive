import { describe, expect, it } from "vitest"
import { app, resolveGuideHtmlPath } from "./index.js"

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
})
