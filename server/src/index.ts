import express from "express";
import helmet from "helmet";
import fs from "node:fs";
import { PORT, JOBS_ROOT } from "./config.js";
import { router } from "./routes.js";

fs.mkdirSync(JOBS_ROOT, { recursive: true });

const app = express();

// CORS middleware (before helmet to allow cross-origin requests)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json({ limit: "5mb" }));
app.use(router);

app.listen(PORT, () => {
  console.log(`Parser API listening on :${PORT}`);
});
