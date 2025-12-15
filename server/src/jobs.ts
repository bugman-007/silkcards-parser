import { db } from "./db.js";

export type JobStatus = "queued" | "running" | "done" | "failed";

export function createJob(args: { jobId: string; sourceFilename: string; sourcePath: string; outDir: string; }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO jobs (jobId, status, createdAt, updatedAt, sourceFilename, sourcePath, outDir)
    VALUES (?, 'queued', ?, ?, ?, ?, ?)
  `).run(args.jobId, now, now, args.sourceFilename, args.sourcePath, args.outDir);
}

export function getJob(jobId: string) {
  return db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(jobId);
}

export function nextQueuedJob() {
  return db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1`).get();
}

export function markRunning(jobId: string) {
  db.prepare(`UPDATE jobs SET status='running', updatedAt=? WHERE jobId=?`).run(Date.now(), jobId);
}

export function markDone(jobId: string, metaPath: string) {
  db.prepare(`UPDATE jobs SET status='done', metaPath=?, updatedAt=? WHERE jobId=?`).run(metaPath, Date.now(), jobId);
}

export function markFailed(jobId: string, error: string) {
  db.prepare(`UPDATE jobs SET status='failed', error=?, updatedAt=? WHERE jobId=?`).run(error, Date.now(), jobId);
}
