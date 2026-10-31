import { createLogger } from "./logger.js"
import { seedDemoWorkspaceData } from "./sync-service.js"

async function runSeedCli(): Promise<void> {
  const logger = createLogger("cli-seed")
  logger.info(
    "cli.seed.start",
    "Starting Firestore demo seed for Notion + Box hybrid search",
  )

  const result = await seedDemoWorkspaceData(logger)
  logger.info("cli.seed.success", "Completed Firestore demo seed", {
    documentsSeeded: result.documentsSeeded,
    chunksSeeded: result.chunksSeeded,
    jobId: result.job.id,
  })
}

const isDirectExecution =
  process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")
if (isDirectExecution) {
  runSeedCli().catch((error) => {
    const logger = createLogger("cli-seed-error")
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error("cli.seed.failed", errorMessage)
    process.exit(1)
  })
}
