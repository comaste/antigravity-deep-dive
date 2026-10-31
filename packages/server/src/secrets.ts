import { execFileSync } from "node:child_process"

export const KEYCHAIN_SERVICE_NAME = "dev.kexi.notion-box-search"

export type SecretName = "GEMINI_API_KEY" | "NOTION_API_KEY" | "NOTION_CLIENT_ID" | "NOTION_CLIENT_SECRET" | "BOX_CLIENT_ID" | "BOX_CLIENT_SECRET" | "BOX_DEVELOPER_TOKEN"

const secretCache = new Map<SecretName, string>()

/**
 * macOS Keychain (`security find-generic-password`) からシークレットを取得する。
 * Why not: `.env` ファイルに平文で API キーを置くと誤コミットや AI エージェントのファイル読み取りによる
 * トークン漏洩リスクがあるため、macOS Keychain をローカルの単一信頼源（SSOT）とし、
 * Cloud Run 本番環境では Secret Manager から注入される `process.env` にフォールバックする。
 */
export function getSecretFromKeychainOrEnv(name: SecretName): string {
  const cached = secretCache.get(name)
  const hasCachedValue = cached !== undefined
  if (hasCachedValue) {
    return cached
  }

  const envValue = process.env[name]?.trim() ?? ""
  const hasEnvValue = envValue.length > 0
  if (hasEnvValue) {
    secretCache.set(name, envValue)
    return envValue
  }

  const isMacOs = process.platform === "darwin"
  if (!isMacOs) {
    secretCache.set(name, "")
    return ""
  }

  try {
    const output = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE_NAME, "-a", name, "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim()

    secretCache.set(name, output)
    return output
  } catch {
    secretCache.set(name, "")
    return ""
  }
}

export function clearSecretCache(): void {
  secretCache.clear()
}
