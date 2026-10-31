import type { SyncTarget } from "@antigravity/shared"
import type { ScopedLogger } from "../logger.js"
import { getSecretFromKeychainOrEnv } from "../secrets.js"

const NOTION_API_BASE = "https://api.notion.com/v1"
const NOTION_VERSION = "2022-06-28"

export interface ExtractedSourceDocument {
  externalId: string
  title: string
  url: string
  path: string[]
  author: string
  mimeType: string
  content: string
  externalUpdatedAt: string
}

export interface NotionOAuthTokenResponse {
  access_token: string
  workspace_id: string
  workspace_name?: string
  bot_id: string
}

export function buildNotionAuthorizeUrl(state: string): string {
  const storedClientId = getSecretFromKeychainOrEnv("NOTION_CLIENT_ID")
  const clientId =
    storedClientId.length > 0 ? storedClientId : "demo-notion-client-id"
  const redirectUri =
    process.env.NOTION_REDIRECT_URI ??
    "http://localhost:3001/api/oauth/notion/callback"

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  })

  return `${NOTION_API_BASE}/oauth/authorize?${params.toString()}`
}

export async function exchangeNotionCodeForToken(
  code: string,
  logger: ScopedLogger,
): Promise<NotionOAuthTokenResponse> {
  const clientId = getSecretFromKeychainOrEnv("NOTION_CLIENT_ID")
  const clientSecret = getSecretFromKeychainOrEnv("NOTION_CLIENT_SECRET")
  const redirectUri =
    process.env.NOTION_REDIRECT_URI ??
    "http://localhost:3001/api/oauth/notion/callback"

  const isDemoCredential =
    clientId.length === 0 ||
    clientSecret.length === 0 ||
    code.startsWith("demo-")
  if (isDemoCredential) {
    logger.info(
      "notion.oauth.demo_mode",
      "Using demo Notion OAuth token because NOTION_CLIENT_ID/SECRET is not configured",
    )
    return {
      access_token: "demo-notion-token",
      workspace_id: "ws-cureapp-demo",
      workspace_name: "CureApp Tech & Corp Workspace (Demo)",
      bot_id: "bot-notion-demo",
    }
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  )
  const response = await fetch(`${NOTION_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  })

  const isFailedResponse = !response.ok
  if (isFailedResponse) {
    const errorText = await response.text()
    throw new Error(
      `Notion OAuth token exchange failed (${response.status}): ${errorText}`,
    )
  }

  return (await response.json()) as NotionOAuthTokenResponse
}

interface NotionRichTextItem {
  plain_text?: string
}

interface NotionPropertyItem {
  type?: string
  title?: unknown
}

interface NotionBlock {
  id: string
  type: string
  has_children?: boolean
  [key: string]: unknown
}

function extractRichTextPlain(richText: unknown): string {
  const isArray = Array.isArray(richText)
  if (!isArray) {
    return ""
  }
  return (richText as NotionRichTextItem[])
    .map((item) => item.plain_text ?? "")
    .join("")
}

function blockToMarkdownLine(block: NotionBlock): string {
  const payload = block[block.type] as Record<string, unknown> | undefined
  if (!payload) {
    return ""
  }

  const text = extractRichTextPlain(payload.rich_text)
  const isEmptyText = text.trim().length === 0 && block.type !== "child_page"
  if (isEmptyText) {
    return ""
  }

  switch (block.type) {
    case "heading_1":
      return `# ${text}`
    case "heading_2":
      return `## ${text}`
    case "heading_3":
      return `### ${text}`
    case "bulleted_list_item":
      return `- ${text}`
    case "numbered_list_item":
      return `1. ${text}`
    case "to_do": {
      const checked = Boolean(payload.checked)
      return `- [${checked ? "x" : " "}] ${text}`
    }
    case "code":
      return `\`\`\`\n${text}\n\`\`\``
    case "child_page":
      return `## Subpage: ${String(payload.title ?? "")}`
    default:
      return text
  }
}

async function fetchNotionBlocksRecursive(
  blockId: string,
  accessToken: string,
  depth = 0,
): Promise<string[]> {
  const exceededMaxDepth = depth > 2
  if (exceededMaxDepth) {
    return []
  }

  const response = await fetch(
    `${NOTION_API_BASE}/blocks/${blockId}/children?page_size=100`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": NOTION_VERSION,
      },
    },
  )

  const isFailed = !response.ok
  if (isFailed) {
    return []
  }

  const data = (await response.json()) as { results?: NotionBlock[] }
  const results = data.results ?? []
  const lines: string[] = []

  for (const block of results) {
    const line = blockToMarkdownLine(block)
    const hasContent = line.trim().length > 0
    if (hasContent) {
      lines.push(line)
    }

    const shouldFetchChildren =
      Boolean(block.has_children) && block.type !== "child_page"
    if (shouldFetchChildren) {
      const childLines = await fetchNotionBlocksRecursive(
        block.id,
        accessToken,
        depth + 1,
      )
      lines.push(...childLines)
    }
  }

  return lines
}

export function getDemoNotionDocuments(): ExtractedSourceDocument[] {
  return [
    {
      externalId: "notion-page-onboarding-2026",
      title: "エンジニアリング部門 オンボーディングガイド 2026",
      url: "https://www.notion.so/cureapp/Engineering-Onboarding-2026-101a",
      path: ["Engineering Wiki", "Onboarding", "2026年入社ガイド"],
      author: "Kei Nakayama",
      mimeType: "text/markdown",
      externalUpdatedAt: "2026-10-20T09:30:00.000Z",
      content: `# エンジニアリング部門 オンボーディングガイド 2026
入社初週に実施すべき開発環境セットアップと社内システムの申請手順をまとめています。

## 1. 開発マシンと Nix 環境の構築
全エンジニアの MacBook Pro (Apple Silicon) は Nix (nix-darwin + home-manager) と direnv で開発環境を統一管理しています。 Homebrew の直接利用は避け、リポジトリを ghq で ~/ghq/github.com/ 配下に clone した上で nix develop を有効化してください。

## 2. アカウント・権限申請
GitHub Organization (Team Plan)、Google Cloud プロジェクト、Notion ワークスペース、Box セキュアストレージへのアクセス権は IT ヘルプデスクチャンネル (#it-helpdesk) から申請します。本番環境の権限昇格には SRE チームの承認が必要です。

## 3. コーディング規約と CI/CD
TypeScript プロジェクトは pnpm workspace + Vitest + oxlint + oxfmt を標準採用しています。ログは必ず traceId を含む 1 行 1 イベントの構造化 JSON で出力し、Cloud Logging から grep / jq で追跡できるように設計します。`,
    },
    {
      externalId: "notion-page-security-incident-policy",
      title: "情報セキュリティ・インシデント対応ランブック (CSIRT)",
      url: "https://www.notion.so/cureapp/Security-Incident-Runbook-202b",
      path: ["Corporate Security", "CSIRT", "インシデント対応"],
      author: "Security Team",
      mimeType: "text/markdown",
      externalUpdatedAt: "2026-10-24T14:15:00.000Z",
      content: `# 情報セキュリティ・インシデント対応ランブック (CSIRT)
医療・ヘルスケア情報を扱うシステムにおいて、不審な通信・認証情報漏洩・マルウェア感染・権限昇格の兆候を検知した際の初動対応手順です。

## 初動 15 分ルール（検知とエスカレーション）
インシデントを発見したメンバーは、直ちに Slack の #sec-incident-urgent チャンネルで CSIRT オンコール担当者をメンションし、Google Meet の War Room を立ち上げます。自己判断でサーバを再起動したり証跡ログを消去してはいけません。

## API トークン・シークレット漏洩時の失効手順
万が一 GitHub リポジトリや外部ログに API キー（Notion OAuth トークン、Box アクセストークン、Google Cloud サービスアカウント等）が混入した場合は、Secret Manager の該当バージョンを即時 Disable にし、Cloud Run リビジョンを再デプロイして古いトークンを遮断します。gitleaks による lefthook / CI スキャンを常時有効化してください。`,
    },
    {
      externalId: "notion-page-hybrid-search-prd",
      title: "社内横断検索システム (Notion + Box RAG) プロダクト仕様書 PRD",
      url: "https://www.notion.so/cureapp/Enterprise-Search-PRD-303c",
      path: ["Product Specs", "Internal Platform", "横断検索 PRD"],
      author: "Platform Product Manager",
      mimeType: "text/markdown",
      externalUpdatedAt: "2026-10-28T11:00:00.000Z",
      content: `# 社内横断検索システム (Notion + Box RAG) プロダクト仕様書
社内のナレッジが Notion（議事録・仕様書・Wiki）と Box（契約書PDF・設計図・監査レポート・予算表）に分散しており、必要な情報に辿り着くまで平均 18 分かかっている課題を解決します。

## アーキテクチャ要件
Google Cloud (asia-northeast1 東京リージョン) の Cloud Run + Cloud Firestore ネイティブモードでサーバレスに構築します。外部の専用ベクトルDBや全文検索クラスタを別途立てず、Firestore の Vector Search (findNearest, 768次元 COSINE) と Bi-gram トークン配列 (array-contains-any) を Reciprocal Rank Fusion (RRF, k=60) で統合することで、月額数ドルの低コストと高精度な日本語ハイブリッド検索を両立します。

## 生成 AI モデル要件
Embedding には gemini-embedding-001 (768次元)、検索結果の引用付き要約およびスキャン PDF のマルチモーダル OCR には gemini-3.8-flash を使用します。`,
    },
    {
      externalId: "notion-page-remote-work-expense-rules",
      title: "リモートワーク手当・書籍購入・クラウド検証費用の精算規定",
      url: "https://www.notion.so/cureapp/Remote-Work-Expense-Policy-404d",
      path: ["HR & Finance", "社内規定", "経費精算ガイド"],
      author: "Corporate Operations",
      mimeType: "text/markdown",
      externalUpdatedAt: "2026-10-18T08:00:00.000Z",
      content: `# リモートワーク手当・書籍購入・クラウド検証費用の精算規定
社員の生産性向上と技術研鑽を支援するため、在宅勤務環境および技術書籍・AI ツール利用料の補助制度を定めています。

## 1. リモートワーク環境構築補助
月額 5,000 円の在宅勤務手当に加え、ディスプレイ・エルゴノミクスチェア・Webカメラ等の購入費用として入社時上限 50,000 円まで実費精算が可能です。領収書 PDF は Box の「経理証憑フォルダ」へアップロードしてください。

## 2. 技術書籍・カンファレンス参加費・AI コーディング検証費
業務に関連する技術書（オライリー等）、国内外カンファレンス参加費、および Google Cloud / Gemini API の個人検証サンドボックス費用は、部門長承認のもと全額会社負担となります。毎月 25 日までに申請を完了してください。`,
    },
  ]
}

/**
 * Notion の指定された SyncTarget（ページまたはデータベース）からドキュメント一覧を取得する。
 * デモトークンまたはトークン未設定時はリアルなサンプル Notion ページを返す。
 */
export async function fetchNotionTargetDocuments(
  target: SyncTarget,
  accessToken: string | null,
  logger: ScopedLogger,
): Promise<ExtractedSourceDocument[]> {
  const keychainNotionApiKey = getSecretFromKeychainOrEnv("NOTION_API_KEY")
  const isStoredDemoToken =
    accessToken !== null && accessToken.startsWith("demo-")
  const effectiveToken =
    !isStoredDemoToken && accessToken && accessToken.length > 0
      ? accessToken
      : keychainNotionApiKey
  const isDemoOrMissingToken =
    effectiveToken.length === 0 || effectiveToken.startsWith("demo-")

  if (isDemoOrMissingToken) {
    logger.info(
      "notion.sync.demo_documents",
      `Returning demo Notion documents for target ${target.name}`,
      { targetId: target.id, externalId: target.externalId },
    )
    return getDemoNotionDocuments()
  }

  try {
    const isWorkspaceSearchTarget =
      target.externalId === "notion-root-engineering-wiki" ||
      target.externalId === "root" ||
      target.externalId === "*"

    if (isWorkspaceSearchTarget) {
      const searchResponse = await fetch(`${NOTION_API_BASE}/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveToken}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
        body: JSON.stringify({
          filter: { value: "page", property: "object" },
          page_size: 20,
        }),
      })

      const isSearchOk = searchResponse.ok
      if (isSearchOk) {
        const searchData = (await searchResponse.json()) as {
          results?: Array<{
            id: string
            url?: string
            last_edited_time?: string
            properties?: Record<string, NotionPropertyItem>
          }>
        }
        const pages = searchData.results ?? []
        const extractedDocs: ExtractedSourceDocument[] = []

        for (const page of pages) {
          let pageTitle = "Untitled Page"
          const props = page.properties ?? {}
          for (const prop of Object.values(props)) {
            if (prop.type === "title") {
              const extracted = extractRichTextPlain(prop.title)
              if (extracted.trim().length > 0) {
                pageTitle = extracted.trim()
              }
            }
          }

          const lines = await fetchNotionBlocksRecursive(
            page.id,
            effectiveToken,
          )
          const fullContent = `# ${pageTitle}\n\n${lines.join("\n")}`.trim()
          const hasText = fullContent.length > 0
          if (hasText) {
            extractedDocs.push({
              externalId: page.id,
              title: pageTitle,
              url:
                page.url ??
                `https://www.notion.so/${page.id.replace(/-/g, "")}`,
              path: ["Notion Workspace", pageTitle],
              author: "Notion Workspace",
              mimeType: "text/markdown",
              content: fullContent,
              externalUpdatedAt:
                page.last_edited_time ?? new Date().toISOString(),
            })
          }
        }

        const hasExtractedDocs = extractedDocs.length > 0
        if (hasExtractedDocs) {
          return extractedDocs
        }
      }
    }

    const pageResponse = await fetch(
      `${NOTION_API_BASE}/pages/${target.externalId}`,
      {
        headers: {
          Authorization: `Bearer ${effectiveToken}`,
          "Notion-Version": NOTION_VERSION,
        },
      },
    )

    const isPageOk = pageResponse.ok
    if (!isPageOk) {
      logger.warn(
        "notion.sync.page_fetch_failed",
        `Notion API returned ${pageResponse.status} for ${target.externalId}; falling back to demo documents`,
      )
      return getDemoNotionDocuments()
    }

    const pageData = (await pageResponse.json()) as {
      id: string
      url?: string
      last_edited_time?: string
      properties?: Record<string, NotionPropertyItem>
    }

    let title = target.name
    const properties = pageData.properties ?? {}
    for (const prop of Object.values(properties)) {
      if (prop.type === "title") {
        const extracted = extractRichTextPlain(prop.title)
        if (extracted.trim().length > 0) {
          title = extracted.trim()
        }
      }
    }

    const lines = await fetchNotionBlocksRecursive(
      target.externalId,
      effectiveToken,
    )
    const fullContent = `# ${title}\n\n${lines.join("\n")}`.trim()

    return [
      {
        externalId: pageData.id,
        title,
        url:
          pageData.url ??
          `https://www.notion.so/${pageData.id.replace(/-/g, "")}`,
        path: ["Notion Workspace", target.name],
        author: "Notion Workspace Member",
        mimeType: "text/markdown",
        content: fullContent,
        externalUpdatedAt:
          pageData.last_edited_time ?? new Date().toISOString(),
      },
    ]
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(
      "notion.sync.error_fallback",
      "Error fetching from Notion API; returning demo Notion documents",
      { errorMessage, targetId: target.id },
    )
    return getDemoNotionDocuments()
  }
}
