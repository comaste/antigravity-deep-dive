import type { SyncTarget } from "@antigravity/shared"
import { extractTextFromDocumentBuffer } from "../gemini.js"
import type { ScopedLogger } from "../logger.js"
import { getSecretFromKeychainOrEnv } from "../secrets.js"
import type { ExtractedSourceDocument } from "./notion.js"

const BOX_AUTH_URL = "https://account.box.com/api/oauth2/authorize"
const BOX_TOKEN_URL = "https://api.box.com/oauth2/token"
const BOX_API_BASE = "https://api.box.com/2.0"

export interface BoxOAuthTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export function buildBoxAuthorizeUrl(state: string): string {
  const storedClientId = getSecretFromKeychainOrEnv("BOX_CLIENT_ID")
  const clientId =
    storedClientId.length > 0 ? storedClientId : "demo-box-client-id"
  const redirectUri =
    process.env.BOX_REDIRECT_URI ??
    "http://localhost:3001/api/oauth/box/callback"

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  })

  return `${BOX_AUTH_URL}?${params.toString()}`
}

export async function exchangeBoxCodeForToken(
  code: string,
  logger: ScopedLogger,
): Promise<BoxOAuthTokenResponse> {
  const clientId = getSecretFromKeychainOrEnv("BOX_CLIENT_ID")
  const clientSecret = getSecretFromKeychainOrEnv("BOX_CLIENT_SECRET")
  const redirectUri =
    process.env.BOX_REDIRECT_URI ??
    "http://localhost:3001/api/oauth/box/callback"

  const isDemoCredential =
    clientId.length === 0 ||
    clientSecret.length === 0 ||
    code.startsWith("demo-")
  if (isDemoCredential) {
    logger.info(
      "box.oauth.demo_mode",
      "Using demo Box OAuth token because BOX_CLIENT_ID/SECRET is not configured",
    )
    return {
      access_token: "demo-box-access-token",
      refresh_token: "demo-box-refresh-token",
      expires_in: 3600,
      token_type: "bearer",
    }
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  })

  const response = await fetch(BOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  })

  const isFailedResponse = !response.ok
  if (isFailedResponse) {
    const errorText = await response.text()
    throw new Error(
      `Box OAuth token exchange failed (${response.status}): ${errorText}`,
    )
  }

  return (await response.json()) as BoxOAuthTokenResponse
}

export async function refreshBoxAccessToken(
  refreshToken: string,
  logger: ScopedLogger,
): Promise<BoxOAuthTokenResponse> {
  const clientId = getSecretFromKeychainOrEnv("BOX_CLIENT_ID")
  const clientSecret = getSecretFromKeychainOrEnv("BOX_CLIENT_SECRET")

  const isDemoCredential =
    clientId.length === 0 ||
    clientSecret.length === 0 ||
    refreshToken.startsWith("demo-")
  if (isDemoCredential) {
    logger.info("box.oauth.demo_refresh", "Refreshing demo Box token")
    return {
      access_token: "demo-box-access-token",
      refresh_token: "demo-box-refresh-token",
      expires_in: 3600,
      token_type: "bearer",
    }
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const response = await fetch(BOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  })

  const isFailed = !response.ok
  if (isFailed) {
    const errorText = await response.text()
    throw new Error(
      `Box OAuth token refresh failed (${response.status}): ${errorText}`,
    )
  }

  return (await response.json()) as BoxOAuthTokenResponse
}

interface BoxRepresentationEntry {
  representation?: string
  status?: { state?: string }
  content?: { url_template?: string }
}

interface BoxFileItem {
  id: string
  type: "file" | "folder"
  name: string
  modified_at?: string
  created_by?: { name?: string }
  path_collection?: { entries?: { name?: string }[] }
  representations?: { entries?: BoxRepresentationEntry[] }
}

function guessMimeTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }
  return "application/octet-stream"
}

/**
 * Box Text Representation API (`x-rep-hints: [extracted_text]`) から抽出済みテキストを取得する。
 * スキャン PDF 等でテキスト表現が空だった場合はファイルをダウンロードして `gemini-3.8-flash` で OCR 抽出する
 * （Why not: 全ファイルを毎回バイナリダウンロードして LLM に投げると帯域・レイテンシ・トークンコストが増大するため、Box 標準のテキスト表現を第一優先にする）。
 */
async function extractBoxFileContent(
  fileId: string,
  fileName: string,
  accessToken: string,
  logger: ScopedLogger,
): Promise<string> {
  const repResponse = await fetch(
    `${BOX_API_BASE}/files/${fileId}?fields=name,representations`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-rep-hints": "[extracted_text]",
      },
    },
  )

  if (repResponse.ok) {
    const fileData = (await repResponse.json()) as BoxFileItem
    const entries = fileData.representations?.entries ?? []
    const textRep = entries.find((e) => e.representation === "extracted_text")
    const urlTemplate = textRep?.content?.url_template

    const hasUrlTemplate = Boolean(urlTemplate)
    if (hasUrlTemplate && urlTemplate) {
      const downloadUrl = urlTemplate.replace("{+asset_path}", "")
      const textResp = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (textResp.ok) {
        const extractedText = (await textResp.text()).trim()
        const isNonEmptyText = extractedText.length > 0
        if (isNonEmptyText) {
          return extractedText
        }
      }
    }
  }

  logger.info(
    "box.file.ocr_fallback",
    `Box extracted_text representation was empty for ${fileName}; falling back to gemini-3.8-flash multimodal extraction`,
    { fileId, fileName },
  )

  const downloadResponse = await fetch(
    `${BOX_API_BASE}/files/${fileId}/content`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  const isDownloadFailed = !downloadResponse.ok
  if (isDownloadFailed) {
    return ""
  }

  const arrayBuffer = await downloadResponse.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = guessMimeTypeFromFileName(fileName)

  return extractTextFromDocumentBuffer(buffer, mimeType, fileName, logger)
}

export function getDemoBoxDocuments(): ExtractedSourceDocument[] {
  return [
    {
      externalId: "box-file-cloud-security-architecture-pdf",
      title: "2026年度_クラウド医療情報セキュリティ設計書_v3.2.pdf",
      url: "https://app.box.com/file/9901002001",
      path: ["Box Root", "01_Architecture_Specs", "Security"],
      author: "Cloud Infrastructure Lead",
      mimeType: "application/pdf",
      externalUpdatedAt: "2026-10-25T16:40:00.000Z",
      content: `2026年度 クラウド医療情報セキュリティ設計書 (v3.2)
対象システム: 社内横断ナレッジ検索基盤・医療データ連携ゲートウェイ

1. リージョンおよびデータレジデンシー方針
すべてのデータベース（Cloud Firestore）、オブジェクトストレージ（Cloud Storage）、コンテナ実行基盤（Cloud Run）、および暗号鍵（Cloud KMS / Secret Manager）は Google Cloud 東京リージョン (asia-northeast1) に限定して配置する。国外リージョンへのデータ複製は禁止する。

2. 認証・認可と通信保護
・管理コンソールおよび検索 API へのアクセスは Google Workspace OIDC / IAP で保護する。
・Notion API および Box API の OAuth 2.0 クライアントシークレット・リフレッシュトークンは Google Cloud Secret Manager に格納し、Cloud Run サービスアカウントに最小権限 (secretmanager.secretAccessor) で注入する。

3. 監査ログの保全
すべての検索クエリと AI 要約リクエストには一意の traceId を付与し、構造化 JSON ログとして Cloud Logging に 365 日間保持する。`,
    },
    {
      externalId: "box-file-vendor-nda-contract-pdf",
      title:
        "業務委託基本契約書_および_秘密保持契約書(NDA)_標準ひな形_2026.pdf",
      url: "https://app.box.com/file/9901002002",
      path: ["Box Root", "02_Legal_Contracts", "Templates_2026"],
      author: "Legal & Compliance Division",
      mimeType: "application/pdf",
      externalUpdatedAt: "2026-10-19T10:20:00.000Z",
      content: `業務委託基本契約書および秘密保持契約書 (NDA) 標準ひな形 2026年改訂版
第1条（目的）
本契約は、委託者（以下「甲」という）が受託者（以下「乙」という）に対してシステム開発・AIモデル検証またはコンサルティング業務を委託するにあたり、秘密情報の取扱および知的財産権の帰属を定めるものである。

第5条（生成AIおよび外部クラウドサービスの利用制限）
乙は、甲から開示された秘密情報または個人関連情報を、学習データとして二次利用される外部生成AIサービスに入力してはならない。ただし、Google Cloud Vertex AI / Gemini API 等のオプトアウト（学習非利用保証）が契約上担保されたエンタープライズ環境を利用する場合で、甲の事前書面承諾を得たときはこの限りではない。

第12条（契約有効期間と秘密保持義務の存続）
本契約の有効期間は締結日から 1 年間とし、期間満了の 30 日前までに書面による解約申し出がない限り同一条件で 1 年間自動更新される。秘密保持義務は本契約終了後も 5 年間存続する。`,
    },
    {
      externalId: "box-file-fy2026-cloud-ai-budget-xlsx",
      title: "FY2026_下期_クラウドインフラ・生成AI予算計画表.xlsx",
      url: "https://app.box.com/file/9901002003",
      path: ["Box Root", "03_Finance_Budget", "FY2026_H2"],
      author: "FP&A / Engineering Manager",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      externalUpdatedAt: "2026-10-27T07:50:00.000Z",
      content: `[シート1: FY2026下期 クラウド・AI予算サマリ]
プロジェクト名: 社内横断検索システム (Notion & Box Hybrid RAG)
想定月間アクティブユーザー数: 250 名
想定ドキュメント総数: Notion 12,000 ページ / Box 8,500 ファイル（約 80,000 チャンク）

月額ランニングコスト試算（東京リージョン asia-northeast1）:
1. Cloud Run (API / Sync Worker, CPU Always Allocated なし・リクエスト課金): 月額 $1.80
2. Cloud Firestore Native Mode (80,000 チャンク保存 + Vector Index + 1日 1,500 回検索): 月額 $3.40
3. Gemini API (gemini-embedding-001 差分ベクトル化 + gemini-3.8-flash 検索要約): 月額 $4.20
4. Cloud Scheduler / Secret Manager / Artifact Registry: 月額 $0.50
合計想定月額コスト: 約 $9.90 / 月（約 1,500 円 / 月）

備考: 従来のマネージド検索クラスタ構成（月額 $750）と比較して約 98.6% のインフラコスト削減を達成。`,
    },
    {
      externalId: "box-file-soc2-isms-audit-report-pdf",
      title: "ISMS_ISO27001_内部監査チェックリストおよび是正報告書_2026Q3.pdf",
      url: "https://app.box.com/file/9901002004",
      path: ["Box Root", "04_Audit_ISO27001", "2026_Q3"],
      author: "Internal Audit Office",
      mimeType: "application/pdf",
      externalUpdatedAt: "2026-10-22T13:05:00.000Z",
      content: `ISMS (ISO/IEC 27001) 内部監査チェックリストおよび是正報告書 (2026年 Q3)
監査対象: コーポレートIT・クラウド開発基盤・Box / Notion 文書管理運用

監査指摘事項と完了済み是正措置:
1. GitHub Actions ワークフローのサプライチェーン対策
・指摘: サードパーティ Action が可変タグ (@v4 等) で参照されていた。
・是正: pinact を導入し、全リポジトリのワークフローをフルコミット SHA で pin 留め（lefthook と CI で pinact run --check を強制）。

2. npm / pnpm パッケージの公開直後インストール防止
・指摘: 悪意ある新規バージョン公開直後のサプライチェーン攻撃リスク。
・是正: pnpm-workspace.yaml に minimumReleaseAge: 1440 (公開から1日以上経過したパッケージのみ許可) と strictDepBuilds: true を設定。`,
    },
  ]
}

/**
 * Box の指定された SyncTarget（フォルダ ID）配下のファイルを取得し、テキスト抽出を行う。
 * デモトークンまたはトークン未設定時はリアルなサンプル Box ファイルを返す。
 */
export async function fetchBoxTargetDocuments(
  target: SyncTarget,
  accessToken: string | null,
  logger: ScopedLogger,
): Promise<ExtractedSourceDocument[]> {
  const keychainDeveloperToken = getSecretFromKeychainOrEnv(
    "BOX_DEVELOPER_TOKEN",
  )
  const isStoredDemoToken =
    accessToken !== null && accessToken.startsWith("demo-")
  const effectiveToken =
    !isStoredDemoToken && accessToken && accessToken.length > 0
      ? accessToken
      : keychainDeveloperToken
  const isDemoOrMissingToken =
    effectiveToken.length === 0 || effectiveToken.startsWith("demo-")

  if (isDemoOrMissingToken) {
    logger.info(
      "box.sync.demo_documents",
      `Returning demo Box documents for target ${target.name}`,
      { targetId: target.id, externalId: target.externalId },
    )
    return getDemoBoxDocuments()
  }

  const normalizedFolderId =
    target.externalId === "box-folder-0-enterprise-docs" ||
    target.externalId === "root"
      ? "0"
      : target.externalId

  try {
    const itemsUrl = `${BOX_API_BASE}/folders/${normalizedFolderId}/items?fields=id,name,type,modified_at,created_by,path_collection&limit=100`
    const response = await fetch(itemsUrl, {
      headers: {
        Authorization: `Bearer ${effectiveToken}`,
      },
    })

    const isFailed = !response.ok
    if (isFailed) {
      logger.warn(
        "box.sync.folder_fetch_failed",
        `Box API returned ${response.status} for folder ${target.externalId}; falling back to demo documents`,
      )
      return getDemoBoxDocuments()
    }

    const data = (await response.json()) as { entries?: BoxFileItem[] }
    const entries = data.entries ?? []
    const files = entries.filter((entry) => entry.type === "file")

    const documents: ExtractedSourceDocument[] = []
    for (const file of files) {
      const content = await extractBoxFileContent(
        file.id,
        file.name,
        effectiveToken,
        logger,
      )
      const isEmptyContent = content.trim().length === 0
      if (isEmptyContent) {
        continue
      }

      const pathEntries = file.path_collection?.entries
        ?.map((e) => e.name ?? "")
        .filter((name) => name.length > 0) ?? ["Box Root", target.name]

      documents.push({
        externalId: `box-file-${file.id}`,
        title: file.name,
        url: `https://app.box.com/file/${file.id}`,
        path: pathEntries,
        author: file.created_by?.name ?? "Box User",
        mimeType: guessMimeTypeFromFileName(file.name),
        content,
        externalUpdatedAt: file.modified_at ?? new Date().toISOString(),
      })
    }

    return documents
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(
      "box.sync.error_fallback",
      "Error fetching from Box API; returning demo Box documents",
      { errorMessage, targetId: target.id },
    )
    return getDemoBoxDocuments()
  }
}
