import fs from "node:fs";
import path from "node:path";
import { nextQueuedJob, markDone, markFailed, markRunning } from "./jobs.js";
import { ILLUSTRATOR_TIMEOUT_SEC, MOCK_ILLUSTRATOR } from "./config.js";
import { runIllustratorExport } from "./illustrator.js";
import { verifyOutputsAndBuildMeta } from "./verify.js";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function runLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = nextQueuedJob();
    if (!job) { await sleep(1000); continue; }

    markRunning(job.jobId);

    try {
      if (MOCK_ILLUSTRATOR) {
        // Create placeholder meta only (for wiring frontend)
        fs.mkdirSync(job.outDir, { recursive: true });
      } else {
        await runIllustratorExport({
          jobId: job.jobId,
          sourcePath: job.sourcePath,
          outDir: job.outDir,
          timeoutSec: ILLUSTRATOR_TIMEOUT_SEC
        });
      }

      const metaPath = await verifyOutputsAndBuildMeta(job.jobId, job.outDir);
      markDone(job.jobId, metaPath);
    } catch (e: any) {
      markFailed(job.jobId, e?.message || String(e));
    }
  }
}

runLoop().catch(err => {
  console.error("Worker fatal:", err);
  process.exit(1);
});
