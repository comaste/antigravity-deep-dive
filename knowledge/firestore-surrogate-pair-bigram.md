---
okf_version: "0.2"
id: firestore-surrogate-pair-bigram
title: Firestore Native / gRPC における UTF-16 サロゲートペア（絵文字）分断による 3 INVALID_ARGUMENT エラーと対策
tags:
  - firestore
  - unicode
  - grpc
  - japanese-nlp
status: verified
updated_at: "2026-10-31"
trust_signals:
  verification_method: "Firestore SDK (gRPC) での書き込みバッチ実行時のエラー再現と、Unicode コードポイント単位処理および孤立サロゲート検査導入後の Vitest 単体テスト・データ投入確認"
  verified_by: "agent"
  evidence:
    - "packages/shared/src/search-utils.ts"
    - "packages/shared/src/search-utils.test.ts"
    - "packages/server/src/firestore.ts"
---

# Firestore Native / gRPC における UTF-16 サロゲートペア分断による 3 INVALID_ARGUMENT エラーと対策

## 概要と発生した問題

Notion ワークスペースおよび Box ストレージのドキュメントを同期し、Firestore Native の `chunks` コレクションへバッチ書き込み（`batch.commit()`）する際、以下のような gRPC エラーが発生して書き込みが失敗する問題に直面した。

```text
Error: 3 INVALID_ARGUMENT: Value for argument "document" is not a valid Document.
...
```

調査の結果、Notion ページのタイトルや本文に頻出する絵文字（例: 🚀, 📝, 🔥）を含むドキュメントで再現することが判明した。

## 原因の根本分析 (Root Cause)

### 1. JavaScript の UTF-16 表現とサロゲートペア

JavaScript の `string` 型は内部的に **UTF-16 コードユニット（16-bit）の列** として扱われる。
BMP（基本多言語面: U+0000〜U+FFFF）外の文字（絵文字や一部の特殊漢字・記号）は、**上位サロゲート（U+D800〜U+DBFF）** と **下位サロゲート（U+DC00〜U+DFFF）** の2つのコードユニットのペア（サロゲートペア）で表現される。

```javascript
const emoji = "🚀"
console.log(emoji.length) // 2 (コードポイント数は1だが UTF-16 コードユニット数は2)
console.log(emoji.charCodeAt(0).toString(16)) // d83d (上位サロゲート)
console.log(emoji.charCodeAt(1).toString(16)) // de80 (下位サロゲート)
```

### 2. ナイーブな文字スライスによる孤立サロゲート（Lone Surrogate）の発生

日本語の全文検索用転置インデックス（`searchTokens`）を生成するため、文字列から 2 文字ずつの組（Bi-gram）を機械的にスライスして抽出していた。

```typescript
// 従来のナイーブな実装
for (let i = 0; i < text.length - 1; i++) {
  const bigram = text.slice(i, i + 2)
  tokenSet.add(bigram)
}
```

この処理において、例えば `"あ🚀い"` という文字列（UTF-16 列: `[あ, \uD83D, \uDE80, い]`）をスライスすると以下のトークンが生成される：

- `i = 0`: `"あ\uD83D"`（漢字 + 上位サロゲートのみ）
- `i = 1`: `"\uD83D\uDE80"`（`"🚀"` 完全なサロゲートペア）
- `i = 2`: `"\uDE80い"`（下位サロゲートのみ + かな）

`i = 0` と `i = 2` で生成された文字列には、相方のない **孤立サロゲート（Lone Surrogate）** が含まれる。

### 3. gRPC / Protocol Buffers の UTF-8 バリデーション失敗

Google Cloud Firestore の Node.js クライアント（`@google-cloud/firestore`）は、バックエンドとの通信に **gRPC / Protocol Buffers** を使用している。
Protobuf の `string` 型は厳密に有効な UTF-8 バイト列でなければシリアライズできない。
Node.js の Buffer 変換や Protobuf シリアライザが孤立サロゲートを UTF-8 に変換しようとした際、規格上不正なバイト列（WTF-8 相当）となるか変換不能となり、Firestore API サーバーまたはクライアント層で `3 INVALID_ARGUMENT` エラーとして拒否される。

## 対策と実装詳細

この問題に対し、多層的な防御（Defense in Depth）を施した。

### 対策 1: 正規表現による絵文字およびサロゲート文字の事前除外

Bi-gram は日本語の単語や漢字・カナの語彙一致のためのものであり、検索トークンに絵文字そのものを登録する必要性は低い。
Unicode プロパティエスケープ（`\p{Extended_Pictographic}`）とサロゲート範囲（`\p{Surrogate}`）を正規表現でマッチさせ、トークン抽出対象テキストから安全に除去する。

```typescript
const cleanedForBigrams = normalized
  .replace(/[\p{Extended_Pictographic}\p{Surrogate}]/gu, "")
  .replace(
    /[\s!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~、「」。・（）【】『』「」〜：；！？]/g,
    "",
  )
```

### 対策 2: Unicode コードポイント単位でのイテレーション (`Array.from`)

仮に絵文字以外のサロゲートペア（異体字セレクタや追加漢字面など）が含まれていた場合でも、コードユニット単位でスライスしないよう、`Array.from(str)` または `[...str]` を使用して **Unicode コードポイント単位** に展開してから隣接文字を結合する。

```typescript
const codePoints = Array.from(cleanedForBigrams)
for (let i = 0; i < codePoints.length - 1; i++) {
  const charA = codePoints[i] ?? ""
  const charB = codePoints[i + 1] ?? ""
  const bigram = `${charA}${charB}`
  // ...
}
```

`Array.from` は文字列イテレータ（`Symbol.iterator`）を使用するため、サロゲートペアを 1 つの完全な文字要素として正しく分割する。

### 対策 3: 孤立サロゲートの最終防衛ガード

スライスや加工の不具合によって万一孤立サロゲートが残存した場合に備え、Firestore に渡す直前のトークン選別処理で正規表現検査を行う。

```typescript
const hasBrokenSurrogate = /[\uD800-\uDFFF]/.test(bigram)
if (!isPureAscii && !hasBrokenSurrogate) {
  tokenSet.add(bigram)
}
```

### 対策 4: ドキュメント ID およびパスのスラッシュ正規化

関連して、Firestore のドキュメント ID にファイルパスや URL 由来のスラッシュ（`/`）が含まれていると、パス階層（サブコレクション）と誤認されて `INVALID_ARGUMENT` の原因となるため、ID のサニタイズも併せて実施した。

```typescript
const safeDocId = documentRecord.id.replace(/\//g, "-")
const safeChunkId = chunk.id.replace(/\//g, "-")
```

## 検証結果 (Trust Signals)

1. **単体テストによる保証**:
   - `packages/shared/src/search-utils.test.ts` において、`"プロジェクト計画書🚀🔥と議事録📝2026"` などの絵文字混在テキストからトークンを抽出し、生成された全トークンに対して `[\uD800-\uDFFF]` の正規表現マッチを行って孤立サロゲートが一切含まれないことを検証。
2. **Firestore 投入検証**:
   - Notion API から取得した絵文字入りドキュメントの同期処理を実行し、`batch.commit()` が `3 INVALID_ARGUMENT` でクラッシュすることなく正常に保存されることを確認。

## 関連知見・ドキュメント

- [Firestore における Vector Search と Bi-gram を統合したハイブリッド検索設計](./firestore-hybrid-search.md)
