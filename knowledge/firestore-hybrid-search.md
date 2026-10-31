---
okf_version: "0.2"
id: firestore-hybrid-search
title: Firestore における Vector Search と Bi-gram を統合したハイブリッド検索設計
tags:
  - firestore
  - vector-search
  - hybrid-search
  - japanese-nlp
status: verified
updated_at: "2026-10-31"
trust_signals:
  verification_method: "Firestore Vector Search 仕様・array-contains-any 制限（最大30要素）の検証と RRF スコア統合の単体テスト検証"
  verified_by: "agent"
  evidence:
    - "infra/terraform/firestore.tf"
    - "firestore.indexes.json"
---

# Firestore における Vector Search と Bi-gram を統合したハイブリッド検索設計

## 背景と課題

社内ドキュメント（Notion ページおよび Box ファイル）の横断検索では、以下の2つの検索要求を同時に満たす必要がある。

1. **意味的類似性（Semantic Search）**: 言い回しが異なっても文脈・概念が近いチャンクを発見したい。
2. **厳密な語彙一致（Lexical Search）**: 型番、プロジェクトコード、固有名詞、専門用語などを漏れなくヒットさせたい。

専用検索エンジン（Elasticsearch や Vertex AI Search 等）を別途構築すると固定費と運用負荷が増大するため、アプリケーションのメイン DB である **Cloud Firestore (Native Mode)** 単体でハイブリッド検索を実現するアーキテクチャを採用した。

## アーキテクチャと設計詳細

### 1. Vector Search (`findNearest`)

- **モデル**: Gemini `gemini-embedding-001` (`outputDimensionality: 768`)
- **格納形式**: `chunks` コレクションの `embedding` フィールドに `FieldValue.vector(number[])` として保存。
- **インデックス構成**:
  - プロバイダ絞り込み無し用: `embedding` (`vector_config { dimension = 768, flat {} }`)
  - プロバイダ絞り込み有り用: `provider` (`ASCENDING`) + `embedding` (`vector_config { dimension = 768, flat {} }`)
- **Why not ANN (HNSW)?**: 数万〜数十万チャンク規模の社内ドキュメントでは、`flat` インデックスによる厳密近傍探索（KNN）で十分なレイテンシ（数十ms）が出せ、インデックス再構築コストや再現率（Recall）低下の懸念がないため。

### 2. 日本語 Bi-gram トークナイズと `array-contains-any`

Firestore には全文検索用の転置インデックス機能が標準搭載されていないが、配列フィールドに対する `array-contains-any` クエリを転置インデックス相当として利用できる。

- **正規化とトークン生成**:
  1. NFKC 正規化 + 小文字化
  2. 英数字の連続（2文字以上）は単語トークンとして抽出
  3. 日本語（漢字・ひらがな・カタカナ）や記号を跨がない連続文字列から文字 **Bi-gram（2文字組）** を生成
  4. ドキュメント保存時はチャンク本文 + タイトルから抽出したユニークトークン配列（上限 500 個）を `searchTokens` フィールドに格納する。
- **クエリ時の制約回避**:
  - Firestore の `array-contains-any` は **最大 30 要素** までの制限がある。
  - そのため、検索クエリから生成したトークン配列は情報量の高い先頭 30 トークンにスライスしてクエリを発行し、取得した候補に対してアプリケーション層で全クエリトークンの一致率（カバレッジ）を再計算してランキング精度を高める。

### 3. Reciprocal Rank Fusion (RRF) による統合

ベクトル検索の距離スコア（Cosine 距離等）とキーワード検索の一致率スコアはスケールも分布も異なるため、線形結合の重み調整が難しい。そこで順位ベースの **RRF (Reciprocal Rank Fusion)** を採用した。

$$\text{RRF\_Score}(d) = \frac{w_{\text{vec}}}{k + \text{rank}_{\text{vec}}(d)} + \frac{w_{\text{kw}}}{k + \text{rank}_{\text{kw}}(d)}$$

- 定数 $k = 60$ を基準とし、両方の検索手法で上位に入ったチャンクを大きくブーストしつつ、片方の検索でしかヒットしなかったチャンク（固有名詞の完全一致や、語彙が重ならない概念検索）も適切に上位へ残すことができる。

## 検証結果 (Trust Signals)

- `infra/terraform/firestore.tf` および `firestore.indexes.json` にて、単一ベクトルインデックス・複合ベクトルインデックス（`provider` + `embedding`）・複合配列インデックス（`provider` + `searchTokens`）の3種を定義し、ローカル Firestore Emulator と本番 GCP 環境の双方でクエリが実行可能であることを確認。
