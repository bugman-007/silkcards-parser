import fs from "node:fs";
import path from "node:path";

function listFiles(dir: string) {
  return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
}

function parseDepthIndexFromLayerName(name: string): number {
  // Supports: front_layer_0_print, back_layer_12_foil_gold_mask, etc.
  const m = name.match(/^(front|back)_layer_(\d+)_/i);
  if (!m) return 0;
  const n = Number(m[2]);
  return Number.isFinite(n) ? n : 0;
}

function inferSideFromLayerName(name: string): "front" | "back" {
  const lower = name.toLowerCase();
  if (lower.startsWith("back_") || lower.includes("_back_")) return "back";
  return "front";
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
      const url = `/assets/${jobId}/out/${f}`.replace(/\\/g, "/");
      
      const isSvg = f.toLowerCase().endsWith(".svg");
      const isMask = base.toLowerCase().endsWith("_mask");

      // Deterministic type inference based on layer naming contract
      // NOTE: meta.json is allowed to contain multiple plates per logical layer.
      // The frontend will deterministically stack/merge by side+type+depthIndex.
      let type: any = "UNKNOWN";
      const lowerBase = base.toLowerCase();

      if (isSvg) {
        // SVGs are currently only produced for die-cut layers
        if (lowerBase.endsWith("_laser_cut") || lowerBase.endsWith("_die_cut")) {
          type = "DIECUT_SVG";
        }
      } else if (isMask) {
        if (lowerBase.includes("_spot_uv_") || lowerBase.endsWith("_spot_uv_mask")) type = "SPOT_UV_MASK";
        else if (lowerBase.includes("_emboss_") || lowerBase.includes("_deboss_") || lowerBase.endsWith("_emboss_mask") || lowerBase.endsWith("_deboss_mask")) type = "EMBOSS";
        else if (lowerBase.includes("_foil_")) type = "FOIL_MASK";
        else if (lowerBase.includes("_laser_cut") || lowerBase.includes("_die_cut")) type = "DIECUT_MASK";
      } else {
        // Non-mask PNG exports should only be print layers
        if (lowerBase.endsWith("_print") || lowerBase.endsWith("_back_print")) {
          type = "PRINT";
        }
      }
      
      // Infer side + depthIndex from layer name
      const side = inferSideFromLayerName(base);
      const depthIndex = parseDepthIndexFromLayerName(base);
      
      // Build assets object
      const assets: any = {};
      if (isSvg) {
        assets.svg = url;
      } else {
        // For masks, use maskPng; for emboss height, use heightPng; otherwise png
        if (type === "EMBOSS" && lowerBase.includes("height")) {
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
        depthIndex,
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
