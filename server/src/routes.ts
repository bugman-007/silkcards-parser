import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { API_KEY, JOBS_ROOT, MAX_UPLOAD_MB, BASE_URL } from "./config.js";
import { createJob, getJob } from "./jobs.js";

export const router = express.Router();

// Health check endpoint (no auth required)
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "silkcards-parser",
    version: "1.0.0"
  });
});

router.use((req, res, next) => {
  if (req.path.startsWith("/assets/") || req.path === "/health") return next();
  // If API_KEY is not configured, allow all requests (development mode)
  if (!API_KEY || API_KEY === "" || API_KEY === "REPLACE_WITH_STRONG_KEY") {
    return next();
  }
  // If API_KEY is configured, require it in header
  const key = req.header("x-api-key");
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
  }
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const jobId = (req as any).jobId;
      const inputDir = path.join(JOBS_ROOT, jobId, "input");
      fs.mkdirSync(inputDir, { recursive: true });
      cb(null, inputDir);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".ai", ".pdf"].includes(ext)) return cb(new Error("Only .ai or .pdf allowed"));
    cb(null, true);
  }
});

router.post("/parse", (req, res, next) => {
  (req as any).jobId = `job_${Date.now()}_${nanoid(8)}`;
  next();
}, upload.single("file"), (req, res) => {
  const jobId = (req as any).jobId as string;
  const file = (req as any).file as Express.Multer.File;
  const outDir = path.join(JOBS_ROOT, jobId, "out");
  fs.mkdirSync(outDir, { recursive: true });

  createJob({
    jobId,
    sourceFilename: file.originalname,
    sourcePath: file.path,
    outDir
  });

  res.json({ jobId, status: "queued" });
});

router.get("/parse/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Not found" });

  // If done, also return meta.json content (if exists)
  if (job.status === "done" && job.metaPath && fs.existsSync(job.metaPath)) {
    const meta = JSON.parse(fs.readFileSync(job.metaPath, "utf-8"));
    return res.json({ ...job, payload: meta });
  }
  res.json(job);
});

// Static serving: /assets/<jobId>/...
router.use("/assets", express.static(JOBS_ROOT, {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
}));

export function assetUrl(jobId: string, relativeOutPath: string) {
  // relativeOutPath like "out/front_layer_0_print.png"
  return `${BASE_URL}/assets/${jobId}/${relativeOutPath.replace(/\\/g, "/")}`;
}
