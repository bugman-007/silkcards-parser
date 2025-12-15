import express from "express";
import helmet from "helmet";
import fs from "node:fs";
import { PORT, JOBS_ROOT } from "./config.js";
import { router } from "./routes.js";

fs.mkdirSync(JOBS_ROOT, { recursive: true });

const app = express();
app.use(helmet());
app.use(express.json({ limit: "5mb" }));
app.use(router);

app.listen(PORT, () => {
  console.log(`Parser API listening on :${PORT}`);
});
