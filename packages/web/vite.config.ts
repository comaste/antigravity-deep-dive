import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * Vite 設定ファイル。
 * バックエンド API (http://localhost:3001) へのリクエストを /api パス経由で proxy する
 * （Why not: フロントエンドで CORS 許可設定や絶対 URL の環境変数管理を複雑化させず、Cloud Run / Firebase Hosting 構成と同じ相対パス `/api/*` で統一するため）。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})
