import crypto from "node:crypto"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { z } from "zod"
import {
  CreateSyncTargetSchema,
  ProviderSchema,
  SearchProviderFilterSchema,
  SearchRequestSchema,
} from "@antigravity/shared"
import {
  createSyncTarget,
  deleteSyncTarget,
  GCP_PROJECT_ID,
  listConnectorStatuses,
  listSyncJobs,
  saveConnectorRecord,
} from "./firestore.js"
import {
  createLogger,
  getContextLogger,
  traceLoggerMiddleware,
  type AppEnv,
} from "./logger.js"
import { executeHybridSearch } from "./search-service.js"
import {
  ensureDefaultSyncTargets,
  seedDemoWorkspaceData,
  triggerSyncWorkflow,
} from "./sync-service.js"
import {
  buildNotionAuthorizeUrl,
  exchangeNotionCodeForToken,
} from "./connectors/notion.js"
import {
  buildBoxAuthorizeUrl,
  exchangeBoxCodeForToken,
} from "./connectors/box.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 静的ガイド HTML (guide.html / docs/index.html) の実体ファイルパスを探索する。
 */
export function resolveGuideHtmlPath(): string | null {
  const candidatePaths = [
    path.resolve(process.cwd(), "packages/web/public/guide.html"),
    path.resolve(process.cwd(), "docs/index.html"),
    path.resolve(process.cwd(), "public/guide.html"),
    path.resolve(__dirname, "../../web/public/guide.html"),
    path.resolve(__dirname, "../../../docs/index.html"),
  ]

  for (const candidate of candidatePaths) {
    const isExisting = existsSync(candidate)
    if (isExisting) {
      return candidate
    }
  }

  return null
}

/**
 * フロントエンド Web SPA (packages/web/dist) のビルド出力ディレクトリパスを探索する。
 */
export function resolveWebDistPath(): string | null {
  const candidatePaths = [
    path.resolve(process.cwd(), "packages/web/dist"),
    path.resolve(__dirname, "../../web/dist"),
    path.resolve(process.cwd(), "web/dist"),
    path.resolve(process.cwd(), "dist"),
  ]

  for (const candidate of candidatePaths) {
    const isExisting = existsSync(candidate)
    if (isExisting) {
      return candidate
    }
  }

  return null
}

export const app = new Hono<AppEnv>()

app.use("*", cors())
app.use("*", traceLoggerMiddleware())

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "@antigravity/server",
    projectId: GCP_PROJECT_ID,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST ?? null,
    traceId: c.get("traceId"),
  })
})

/**
 * GET /guide
 * バックエンド直接アクセス時に /guide.html へリダイレクトする。
 */
app.get("/guide", (c) => {
  return c.redirect("/guide.html", 302)
})

/**
 * GET /guide.html
 * システム利用ガイド（静的 HTML）を直接配信する。
 */
app.get("/guide.html", async (c) => {
  const guidePath = resolveGuideHtmlPath()
  const isFileNotFound = guidePath === null
  if (isFileNotFound) {
    return c.text("Guide documentation not found", 404)
  }

  // Why not: なぜ @hono/node-server/serve-static などのサードパーティミドルウェアを採用しなかったか: 本サービスは軽量な API サーバーであり、配信対象が単一の静的ガイドファイル（guide.html）に限定されるため、余計な依存を追加せず Node.js 組み込みの fs モジュールで探索・配信する方が依存関係の肥大化を防ぎサプライチェーンリスクを低減できるため。
  // Why not: なぜストリーム配信（createReadStream）を採用しなかったか: guide.html は約 44KB の静的ドキュメントであり、メモリへの負荷が極めて小さいため、一括読み込みによる文字列返却の方が I/O ハンドリングが単純でオーバーヘッドが少ないため。
  const htmlContent = await fs.readFile(guidePath, "utf-8")
  return c.html(htmlContent)
})

/**
 * POST /api/search
 * Firestore Vector Search + Keyword Search + RRF ハイブリッド検索を実行する。
 */
app.post("/api/search", zValidator("json", SearchRequestSchema), async (c) => {
  const logger = getContextLogger(c)
  const searchRequest = c.req.valid("json")
  const response = await executeHybridSearch(searchRequest, logger)
  return c.json(response)
})

/**
 * GET /api/admin/connectors
 * Notion / Box の OAuth 連携ステータスを取得する。
 */
app.get("/api/admin/connectors", async (c) => {
  const connectors = await listConnectorStatuses()
  return c.json({
    connectors,
    traceId: c.get("traceId"),
  })
})

/**
 * GET /api/oauth/:provider/authorize
 * Notion または Box の OAuth 2.0 認可 URL を生成して返す（redirect=1 の場合は 302 リダイレクト）。
 */
app.get("/api/oauth/:provider/authorize", (c) => {
  const rawProvider = c.req.param("provider")
  const parsedProvider = ProviderSchema.safeParse(rawProvider)
  const isInvalidProvider = !parsedProvider.success
  if (isInvalidProvider) {
    return c.json({ error: "Invalid provider" }, 400)
  }

  const provider = parsedProvider.data
  const state = crypto.randomUUID()
  const isNotion = provider === "notion"
  const authorizeUrl = isNotion
    ? buildNotionAuthorizeUrl(state)
    : buildBoxAuthorizeUrl(state)

  const shouldRedirect = c.req.query("redirect") === "1"
  if (shouldRedirect) {
    return c.redirect(authorizeUrl, 302)
  }

  return c.json({
    provider,
    authorizeUrl,
    state,
    traceId: c.get("traceId"),
  })
})

/**
 * GET /api/oauth/:provider/callback
 * OAuth 2.0 認可コードを受け取り、アクセストークンへ交換して Firestore に保存する。
 */
app.get("/api/oauth/:provider/callback", async (c) => {
  const logger = getContextLogger(c)
  const rawProvider = c.req.param("provider")
  const parsedProvider = ProviderSchema.safeParse(rawProvider)
  const isInvalidProvider = !parsedProvider.success
  if (isInvalidProvider) {
    return c.json({ error: "Invalid provider" }, 400)
  }

  const provider = parsedProvider.data
  const code = c.req.query("code") ?? "demo-code"

  if (provider === "notion") {
    const tokenRes = await exchangeNotionCodeForToken(code, logger)
    const status = await saveConnectorRecord(
      {
        provider: "notion",
        connected: true,
        workspaceName: tokenRes.workspace_name ?? "Notion Connected Workspace",
        accessToken: tokenRes.access_token,
        refreshToken: null,
        expiresAt: null,
        updatedAt: new Date().toISOString(),
      },
      logger,
    )
    return c.json({ ok: true, connector: status, traceId: c.get("traceId") })
  }

  const boxToken = await exchangeBoxCodeForToken(code, logger)
  const expiresAt = new Date(
    Date.now() + boxToken.expires_in * 1000,
  ).toISOString()
  const status = await saveConnectorRecord(
    {
      provider: "box",
      connected: true,
      workspaceName: "Box Enterprise Workspace",
      accessToken: boxToken.access_token,
      refreshToken: boxToken.refresh_token,
      expiresAt,
      updatedAt: new Date().toISOString(),
    },
    logger,
  )
  return c.json({ ok: true, connector: status, traceId: c.get("traceId") })
})

/**
 * POST /api/admin/connectors/:provider/demo-connect
 * ローカル検証用にワンクリックで Notion / Box をデモ連携状態にし、デフォルト同期ターゲットも用意する。
 */
app.post("/api/admin/connectors/:provider/demo-connect", async (c) => {
  const logger = getContextLogger(c)
  const rawProvider = c.req.param("provider")
  const parsedProvider = ProviderSchema.safeParse(rawProvider)
  const isInvalidProvider = !parsedProvider.success
  if (isInvalidProvider) {
    return c.json({ error: "Invalid provider" }, 400)
  }

  const provider = parsedProvider.data
  const isNotion = provider === "notion"
  const status = await saveConnectorRecord(
    {
      provider,
      connected: true,
      workspaceName: isNotion
        ? "CureApp Tech & Corp Workspace (Demo)"
        : "CureApp Box Enterprise Storage (Demo)",
      accessToken: isNotion ? "demo-notion-token" : "demo-box-access-token",
      refreshToken: isNotion ? null : "demo-box-refresh-token",
      expiresAt: isNotion
        ? null
        : new Date(Date.now() + 3600 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    logger,
  )

  await ensureDefaultSyncTargets()

  return c.json({
    ok: true,
    connector: status,
    traceId: c.get("traceId"),
  })
})

/**
 * GET /api/admin/targets
 * 同期対象ページ・フォルダ一覧を取得する。
 */
app.get("/api/admin/targets", async (c) => {
  const targets = await ensureDefaultSyncTargets()
  return c.json({
    targets,
    traceId: c.get("traceId"),
  })
})

/**
 * POST /api/admin/targets
 * 新規の同期対象（Notion ページ/DB ID または Box フォルダ ID）を登録する。
 */
app.post(
  "/api/admin/targets",
  zValidator("json", CreateSyncTargetSchema),
  async (c) => {
    const logger = getContextLogger(c)
    const input = c.req.valid("json")
    const target = await createSyncTarget(input)

    logger.info("admin.target.created", `Created sync target ${target.id}`, {
      targetId: target.id,
      provider: target.provider,
      externalId: target.externalId,
    })

    return c.json(
      {
        target,
        traceId: c.get("traceId"),
      },
      201,
    )
  },
)

/**
 * DELETE /api/admin/targets/:id
 * 指定した同期対象を削除する。
 */
app.delete("/api/admin/targets/:id", async (c) => {
  const logger = getContextLogger(c)
  const id = c.req.param("id")
  const deleted = await deleteSyncTarget(id)
  const isNotFound = !deleted
  if (isNotFound) {
    return c.json(
      { error: "Sync target not found", traceId: c.get("traceId") },
      404,
    )
  }

  logger.info("admin.target.deleted", `Deleted sync target ${id}`, {
    targetId: id,
  })
  return c.json({ ok: true, id, traceId: c.get("traceId") })
})

const TriggerSyncRequestSchema = z.object({
  provider: SearchProviderFilterSchema.default("all"),
})

/**
 * POST /api/sync/trigger
 * 手動同期または Cloud Scheduler からの定期同期ジョブを起動する。
 */
app.post("/api/sync/trigger", async (c) => {
  const logger = getContextLogger(c)
  let rawBody: unknown = {}
  try {
    rawBody = await c.req.json()
  } catch {
    rawBody = {}
  }

  const parsed = TriggerSyncRequestSchema.safeParse(rawBody)
  const provider = parsed.success ? parsed.data.provider : "all"
  const job = await triggerSyncWorkflow(provider, logger)

  return c.json({
    job,
    traceId: c.get("traceId"),
  })
})

/**
 * GET /api/admin/jobs
 * 同期ジョブ履歴一覧を取得する。
 */
app.get("/api/admin/jobs", async (c) => {
  const jobs = await listSyncJobs(25)
  return c.json({
    jobs,
    traceId: c.get("traceId"),
  })
})

/**
 * POST /api/admin/seed
 * サンプルデータ（Notion ページ 4 件 + Box ファイル 4 件）を Firestore に即時投入する。
 */
app.post("/api/admin/seed", async (c) => {
  const logger = getContextLogger(c)
  const result = await seedDemoWorkspaceData(logger)
  return c.json({
    ok: true,
    ...result,
    traceId: c.get("traceId"),
  })
})

const webDistPath = resolveWebDistPath()
const hasWebDist = webDistPath !== null

if (hasWebDist) {
  // Why not: なぜ API ルートより後に静的ファイル配信を登録するか: /api/* ルートへのアクセスが静的ファイル探索に横取りされず、API ハンドラへ直行させることでレスポンスレイテンシを最小化するため。
  const relativeDistPath = path.relative(process.cwd(), webDistPath)
  app.use("/*", serveStatic({ root: relativeDistPath }))

  // SPA フォールバック: /api/* 以外の未知のパスに対して index.html を返却し TanStack Router によるクライアントルーティングを可能にする
  app.get("*", async (c, next) => {
    const isApiRoute = c.req.path.startsWith("/api/")
    if (isApiRoute) {
      return next()
    }

    const indexPath = path.join(webDistPath, "index.html")
    const isIndexPresent = existsSync(indexPath)
    if (isIndexPresent) {
      const htmlContent = await fs.readFile(indexPath, "utf-8")
      return c.html(htmlContent)
    }

    return next()
  })
}

const isDirectServerRun =
  process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")

if (isDirectServerRun) {
  const port = Number(process.env.PORT ?? 3001)
  const serverLogger = createLogger("server-boot")

  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      serverLogger.info(
        "server.listening",
        `Antigravity Hybrid Search API listening on http://localhost:${info.port}`,
        {
          port: info.port,
          projectId: GCP_PROJECT_ID,
          firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST ?? null,
        },
      )
    },
  )
}
