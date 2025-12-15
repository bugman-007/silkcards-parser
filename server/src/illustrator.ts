import { spawn } from "node:child_process";
import path from "node:path";
import { SCRIPTS_DIR } from "./config.js";

export async function runIllustratorExport(args: {
  jobId: string;
  sourcePath: string;
  outDir: string;
  timeoutSec: number;
}) {
  const ps1 = path.join(SCRIPTS_DIR, "run_ai_export.ps1");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", ps1,
      "-JobId", args.jobId,
      "-InputPath", args.sourcePath,
      "-OutDir", args.outDir
    ], { stdio: "inherit" });

    const to = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Illustrator export timed out after ${args.timeoutSec}s`));
    }, args.timeoutSec * 1000);

    child.on("exit", (code) => {
      clearTimeout(to);
      if (code === 0) resolve();
      else reject(new Error(`Illustrator export failed (exit code ${code})`));
    });
  });
}
