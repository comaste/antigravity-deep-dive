---
okf_version: "0.2"
id: knowledge-index
title: Knowledge Base Index
tags:
  - firestore
  - hybrid-search
  - gcp
status: verified
updated_at: "2026-10-31"
trust_signals:
  verification_method: "リポジトリ初期構築時のアーキテクチャ設計およびインデックス制約検証"
  verified_by: "agent"
---

# Knowledge Base Index

本ディレクトリでは、Notion & Box 横断検索システムの設計・実装・検証を通じて得られた知見を Open Knowledge Format (OKF v0.2) で管理する。

## ドキュメント一覧

- [Firestore における Vector Search と Bi-gram を統合したハイブリッド検索設計](./firestore-hybrid-search.md)
  - Tags: `firestore`, `vector-search`, `hybrid-search`, `japanese-nlp`
  - 概要: Firestore Native の `findNearest` (768次元ベクトル検索) と `array-contains-any` (日本語 Bi-gram トークン検索) を併用し、Reciprocal Rank Fusion (RRF) でスコア統合する設計とインデックス制約。
- [システム利用ガイド（HTML ドキュメント）のマルチチャネル配信アーキテクチャ](./system-usage-guide.md)
  - Tags: `documentation`, `static-hosting`, `gcp`
  - 概要: `packages/web/public/guide.html` を SSOT とし、GitHub Pages (`docs/index.html` 相対シンボリックリンク)、Cloud Run Web フロントエンド、および Hono API サーバー直接配信 (`/guide`, `/guide.html`) を統合した静的ドキュメント配信アーキテクチャ。

## 運用ルール

1. 作業を始める前にまず本 `index.md` を確認し、既知の制約や設計判断を踏まえて着手する。
2. 新しい tag を使用する場合は、先に `knowledge/tags.yml` に説明付きで追加する。
3. 各ドキュメントには必ず `trust_signals`（何をどう検証したか）を記録し、前提が変わった場合は速やかに更新・訂正する。
