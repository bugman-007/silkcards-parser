import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Get the directory where this file is located (server/src)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Database goes in server/ directory (parent of src/)
const dbPath = path.join(__dirname, "..", "parser.db");
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
