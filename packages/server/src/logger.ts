import crypto from "node:crypto"
import type { Context, MiddlewareHandler } from "hono"

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  timestamp: string
  level: LogLevel
  traceId: string
  event: string
  message: string
  [key: string]: unknown
}

/**
 * 1イベント1行の JSON 形式で stdout / stderr に出力する構造化ロガー。
 * AI エージェントや Cloud Logging が grep / jq で自動調査しやすいようフィールド名を統一する
 * （Why not: console.log の自由形式文字列では複数行に割れたり traceId による横断検索が困難になるため）。
 */
export function writeStructuredLog(
  level: LogLevel,
  traceId: string,
  event: string,
  message: string,
  meta: Record<string, unknown> = {},
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    traceId,
    event,
    message,
    ...meta,
  }

  const serialized = `${JSON.stringify(entry)}\n`
  const isErrorLevel = level === "error"
  if (isErrorLevel) {
    process.stderr.write(serialized)
    return
  }

  process.stdout.write(serialized)
}

export interface ScopedLogger {
  traceId: string
  debug: (
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => void
  info: (event: string, message: string, meta?: Record<string, unknown>) => void
  warn: (event: string, message: string, meta?: Record<string, unknown>) => void
  error: (
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => void
}

export function createLogger(
  traceId: string = crypto.randomUUID(),
): ScopedLogger {
  return {
    traceId,
    debug: (event, message, meta) =>
      writeStructuredLog("debug", traceId, event, message, meta),
    info: (event, message, meta) =>
      writeStructuredLog("info", traceId, event, message, meta),
    warn: (event, message, meta) =>
      writeStructuredLog("warn", traceId, event, message, meta),
    error: (event, message, meta) =>
      writeStructuredLog("error", traceId, event, message, meta),
  }
}

export type AppEnv = {
  Variables: {
    traceId: string
    logger: ScopedLogger
  }
}

/**
 * Hono リクエストごとに x-trace-id または Google Cloud Trace ヘッダを引き継ぎ、
 * 未指定なら UUID を採番してレスポンスヘッダとコンテキストへ伝播させるミドルウェア。
 */
export function traceLoggerMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incomingTraceHeader =
      c.req.header("x-trace-id") ??
      c.req.header("x-cloud-trace-context")?.split("/")[0] ??
      ""
    const hasIncomingTrace = incomingTraceHeader.trim().length > 0
    const traceId = hasIncomingTrace
      ? incomingTraceHeader.trim()
      : crypto.randomUUID()
    const logger = createLogger(traceId)

    c.set("traceId", traceId)
    c.set("logger", logger)
    c.header("x-trace-id", traceId)

    const startedAt = Date.now()
    logger.info("http.request.start", `${c.req.method} ${c.req.path}`, {
      method: c.req.method,
      path: c.req.path,
    })

    try {
      await next()
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logger.error("http.request.unhandled_error", errorMessage, {
        method: c.req.method,
        path: c.req.path,
      })
      throw error
    } finally {
      const durationMs = Date.now() - startedAt
      logger.info(
        "http.request.end",
        `${c.req.method} ${c.req.path} -> ${c.res.status}`,
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs,
        },
      )
    }
  }
}

export function getContextLogger(c: Context<AppEnv>): ScopedLogger {
  const existing = c.get("logger")
  const hasLogger = Boolean(existing)
  if (hasLogger) {
    return existing
  }
  return createLogger()
}
