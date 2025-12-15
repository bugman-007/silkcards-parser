import dotenv from "dotenv";
dotenv.config();

export const PORT = Number(process.env.PORT || 8080);
export const JOBS_ROOT = process.env.JOBS_ROOT || "D:\\silkcards-parser\\jobs";
export const API_KEY = process.env.API_KEY || "";
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
export const ILLUSTRATOR_TIMEOUT_SEC = Number(process.env.ILLUSTRATOR_TIMEOUT_SEC || 300);
export const SCRIPTS_DIR = process.env.SCRIPTS_DIR || "D:\\silkcards-parser\\scripts";
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const MOCK_ILLUSTRATOR = process.env.MOCK_ILLUSTRATOR === "1";
