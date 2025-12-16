import fs from "node:fs";
import path from "node:path";
import { BASE_URL } from "./config.js";

function listFiles(dir: string) {
  return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
}

export async function verifyOutputsAndBuildMeta(jobId: string, outDir: string) {
  const files = listFiles(outDir);

  if (files.length === 0) {
    throw new Error("No outputs generated. Likely Illustrator export failed or naming mismatch.");
  }

  // Minimal meta for frontend draft:
  // You will extend this to full schema later.
  const payload = {
    schemaVersion: "1.0.0",
    jobId,
    card: { plyCount: 1, thicknessPt: 16, size: { widthMm: 88.9, heightMm: 50.8, bleedMm: 3, safeMm: 3 }, dpi: 600 },
    plates: files.map((f) => {
      const base = f.replace(/\.(png|svg)$/i, "");
      const url = `${BASE_URL}/assets/${jobId}/out/${f}`.replace(/\\/g, "/");
      
      // Crude type inference
      let type: any = "UNKNOWN";
      if (base.endsWith("_mask")) {
        if (base.includes("_spot_uv_")) type = "SPOT_UV_MASK";
        else if (base.includes("_emboss_") || base.endsWith("_emboss_mask")) type = "EMBOSS";
        else if (base.includes("_foil_")) type = "FOIL_MASK";
        else if (base.includes("_laser_cut") || base.includes("_die_cut")) type = "DIECUT";
      } else {
        type = "PRINT";
      }
      
      // Infer side from filename (front/back)
      let side: "front" | "back" = "front";
      const lowerBase = base.toLowerCase();
      if (lowerBase.includes("_back_") || lowerBase.startsWith("back_")) {
        side = "back";
      } else if (lowerBase.includes("_front_") || lowerBase.startsWith("front_")) {
        side = "front";
      }
      
      // Build assets object
      const isSvg = f.toLowerCase().endsWith(".svg");
      const assets: any = {};
      if (isSvg) {
        assets.svg = url;
      } else {
        // For masks, use maskPng; for emboss height, use heightPng; otherwise png
        if (type === "EMBOSS" && base.includes("height")) {
          assets.heightPng = url;
        } else if (type !== "PRINT") {
          assets.maskPng = url;
        } else {
          assets.png = url;
        }
      }
      
      return {
        id: base,
        aiLayerName: base, // Use base filename as layer name
        side,
        depthIndex: 0, // Default to 0, should be extracted from Illustrator export
        physicalPlyIndex: 0, // Default to 0, should be extracted from Illustrator export
        face: side, // Same as side
        type,
        assets
      };
    }),
    validation: { passed: true, warnings: [], errors: [] }
  };

  const metaPath = path.join(outDir, "meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), "utf-8");
  return metaPath;
}
