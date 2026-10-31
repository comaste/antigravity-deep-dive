import React from "react"
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"
import { Header } from "./components/Header.js"
import { SearchPage } from "./pages/SearchPage.js"
import { AdminPage } from "./pages/AdminPage.js"
import { GuidePage } from "./pages/GuidePage.js"

/**
 * TanStack Router の Code-based ルーティング定義。
 * ルート数が3画面（`/`、`/admin`、`/guide`）と明確なため、自動ファイル生成プラグインに依存しない Code-based routing で型安全に構成する
 * （Why not: File-based routing のコード生成ステップを入れると、初回ビルド前に生成ファイルの有無で型チェック順序の依存が増えるため）。
 */
const rootRoute = createRootRoute({
  component: function RootLayout(): React.ReactElement {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Header />
        <main className="pb-16">
          <Outlet />
        </main>
      </div>
    )
  },
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SearchPage,
})

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminPage,
})

const guideRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guide",
  component: GuidePage,
})

const routeTree = rootRoute.addChildren([indexRoute, adminRoute, guideRoute])

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
