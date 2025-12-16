import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

// Get project root (one level up from server/src)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export const PORT = Number(process.env.PORT || 8080);
export const JOBS_ROOT = process.env.JOBS_ROOT || path.join(PROJECT_ROOT, "jobs");
export const API_KEY = process.env.API_KEY || "";
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
export const ILLUSTRATOR_TIMEOUT_SEC = Number(process.env.ILLUSTRATOR_TIMEOUT_SEC || 300);
export const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(PROJECT_ROOT, "scripts");
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const MOCK_ILLUSTRATOR = process.env.MOCK_ILLUSTRATOR === "1";
