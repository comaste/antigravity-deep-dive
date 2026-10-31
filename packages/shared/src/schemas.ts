import { z } from "zod"

export const ProviderSchema = z.enum(["notion", "box"])
export type Provider = z.infer<typeof ProviderSchema>

export const SearchProviderFilterSchema = z.enum(["all", "notion", "box"])
export type SearchProviderFilter = z.infer<typeof SearchProviderFilterSchema>

export const SearchRequestSchema = z.object({
  query: z.string().min(1, "検索クエリを入力してください").max(500),
  provider: SearchProviderFilterSchema.default("all"),
  limit: z.number().int().min(1).max(50).default(15),
  includeAiSummary: z.boolean().default(true),
})
export type SearchRequest = z.infer<typeof SearchRequestSchema>

export const SearchResultHitSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  provider: ProviderSchema,
  title: z.string(),
  url: z.string(),
  path: z.array(z.string()),
  snippet: z.string(),
  author: z.string().optional(),
  mimeType: z.string().optional(),
  externalUpdatedAt: z.string(),
  rrfScore: z.number(),
  semanticRank: z.number().nullable(),
  keywordRank: z.number().nullable(),
  matchedTokens: z.array(z.string()),
})
export type SearchResultHit = z.infer<typeof SearchResultHitSchema>

export const AiCitationSchema = z.object({
  index: z.number(),
  documentId: z.string(),
  provider: ProviderSchema,
  title: z.string(),
  url: z.string(),
})
export type AiCitation = z.infer<typeof AiCitationSchema>

export const AiSummarySchema = z.object({
  answerMarkdown: z.string(),
  citations: z.array(AiCitationSchema),
  model: z.string(),
})
export type AiSummary = z.infer<typeof AiSummarySchema>

export const SearchResponseSchema = z.object({
  query: z.string(),
  provider: SearchProviderFilterSchema,
  totalHits: z.number(),
  hits: z.array(SearchResultHitSchema),
  aiSummary: AiSummarySchema.nullable(),
  traceId: z.string(),
  tookMs: z.number(),
})
export type SearchResponse = z.infer<typeof SearchResponseSchema>

export const ConnectorStatusSchema = z.object({
  provider: ProviderSchema,
  connected: z.boolean(),
  workspaceName: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>

export const SyncTargetSchema = z.object({
  id: z.string(),
  provider: ProviderSchema,
  externalId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  status: z.enum(["idle", "syncing", "completed", "failed"]),
})
export type SyncTarget = z.infer<typeof SyncTargetSchema>

export const CreateSyncTargetSchema = z.object({
  provider: ProviderSchema,
  externalId: z.string().min(1),
  name: z.string().min(1),
})
export type CreateSyncTargetInput = z.infer<typeof CreateSyncTargetSchema>

export const SyncJobSchema = z.object({
  id: z.string(),
  provider: z.enum(["all", "notion", "box"]),
  status: z.enum(["running", "completed", "failed"]),
  processedCount: z.number(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type SyncJob = z.infer<typeof SyncJobSchema>
