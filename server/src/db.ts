import Database from "better-sqlite3";
import { JOBS_ROOT } from "./config.js";
import fs from "node:fs";
import path from "node:path";

const dbPath = path.join(JOBS_ROOT, "..", "server", "parser.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  jobId TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  sourceFilename TEXT NOT NULL,
  sourcePath TEXT NOT NULL,
  outDir TEXT NOT NULL,
  metaPath TEXT,
  error TEXT
);
`);
