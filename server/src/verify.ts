// server/src/verify.ts
//
// Purpose:
// - Validate Illustrator export outputs in <job>/out
// - Build the meta.json that the API returns
//
// Key fix:
// - If Illustrator (export_plates.jsx) produced placement fields (startPx/endPx/rectPx/cardPx/etc),
//   merge them into the final v1 meta.json instead of overwriting/losing them.
// - Never treat meta.json (or any .json) as a "plate" output.

import fs from "node:fs";
import path from "node:path";

type Side = "front" | "back";

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile());
}

function parseDepthIndexFromLayerName(name: string): number {
  // Supports: front_layer_0_print, back_layer_12_foil_gold_mask, etc.
  const m = name.match(/^(front|back)_layer_(\d+)_/i);
  if (!m) return 0;
  const n = Number(m[2]);
  return Number.isFinite(n) ? n : 0;
}

function inferSideFromLayerName(name: string): Side {
  return /^back_/i.test(name) ? "back" : "front";
}

function inferTypeFromLayerName(name: string): string {
  const n = name.toLowerCase();

  // die cut
  if (n.includes("_die_cut")) return "DIECUT";

  // emboss / deboss (if you add later)
  if (n.includes("_emboss")) return "EMBOSS";
  if (n.includes("_deboss")) return "DEBOSS";

  // uv (your files use spot_uv)
  if (n.includes("_spot_uv") || n.includes("_uv")) return "UV";

  // foil
  if (n.includes("_foil_") || n.includes("_foil")) return "FOIL";

  // print (back_print counts as print)
  if (n.endsWith("_print") || n.includes("_back_print")) return "PRINT";

  return "UNKNOWN";
}

function assetPath(jobId: string, filename: string): string {
  // Served by router.use("/assets", express.static(JOBS_ROOT))
  // Files live under: <JOBS_ROOT>/<jobId>/out/<filename>
  return `/assets/${jobId}/out/${filename}`.replace(/\\/g, "/");
}

function readJsonIfExists(p: string): any | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function isPlacementValue(v: any): boolean {
  return (
    v &&
    typeof v === "object" &&
    (v.startPx || v.endPx || v.rectPx || v.cardPx || v.dpiUsed || v.sizePx)
  );
}

function extractPlacementMap(aiMeta: any): Record<string, any> {
  // Preferred: meta.placementById (what your script writes)
  if (aiMeta && aiMeta.placementById && typeof aiMeta.placementById === "object") {
    return aiMeta.placementById as Record<string, any>;
  }

  // Fallback: build map from meta.plates[] if it contains placement fields
  const map: Record<string, any> = {};
  if (aiMeta && Array.isArray(aiMeta.plates)) {
    for (const p of aiMeta.plates) {
      if (!p) continue;
      const id = typeof p.id === "string" ? p.id : null;
      if (!id) continue;
      if (isPlacementValue(p)) {
        map[id] = {
          dpiUsed: p.dpiUsed,
          cardPx: p.cardPx,
          startPx: p.startPx,
          endPx: p.endPx,
          rectPx: p.rectPx,
          sizePx: p.sizePx,
        };
      }
    }
  }
  return map;
}

export async function verifyOutputsAndBuildMeta(jobId: string, outDir: string): Promise<string> {
  // Read Illustrator-generated meta.json BEFORE we overwrite anything.
  const aiMetaPath = path.join(outDir, "meta.json");
  const aiMeta = readJsonIfExists(aiMetaPath);
  const placementById = extractPlacementMap(aiMeta);

  // Extract layer information from AI meta if available
  const aiLayerCount = aiMeta?.globalLayerStats?.totalLayerCount;
  const aiMaxLayerIndex = aiMeta?.globalLayerStats?.maxLayerIndex;
  const aiCards = aiMeta?.cards || [];
  const aiBaseThicknessPt = aiMeta?.globalLayerStats?.baseThicknessPt || 16;
  const aiBaseThicknessMm = aiMeta?.globalLayerStats?.baseThicknessMm || 0.4064; // 16pt in mm

  // Only accept real output files as plates.
  // IMPORTANT: exclude meta.json (and any json) from scanning.
  const files = listFiles(outDir).filter((f) => {
    const lower = f.toLowerCase();
    if (lower.endsWith(".json")) return false;
    return lower.endsWith(".png") || lower.endsWith(".svg");
  });

  if (files.length === 0) {
    throw new Error("No output files found in outDir");
  }
  
  // Calculate layer count from files if not in AI meta
  const layerIndices = new Set<number>();
  files.forEach((f) => {
    const base = f.replace(/\.(png|svg)$/i, "");
    const depthIdx = parseDepthIndexFromLayerName(base);
    layerIndices.add(depthIdx);
  });
  const calculatedMaxLayerIndex = layerIndices.size > 0 ? Math.max(...Array.from(layerIndices)) : -1;
  const calculatedLayerCount = calculatedMaxLayerIndex + 1;
  
  // Use AI meta if available, otherwise calculate from files
  const totalLayerCount = aiLayerCount || calculatedLayerCount;
  const maxLayerIndex = aiMaxLayerIndex !== undefined ? aiMaxLayerIndex : calculatedMaxLayerIndex;

  const plates = files.map((f) => {
    const ext = path.extname(f).toLowerCase(); // .png | .svg
    const base = f.replace(/\.(png|svg)$/i, "");
    const side = inferSideFromLayerName(base);
    const depthIndex = parseDepthIndexFromLayerName(base);
    const type = inferTypeFromLayerName(base);

    const assets: Record<string, string> = {};
    if (ext === ".svg") {
      assets.svg = assetPath(jobId, f);
    } else {
      // PNG: decide whether it is a mask or a print-ish texture
      // Convention: exporter uses *_mask.png for non-print
      // (but if you keep some without suffix, still treat PRINT as png)
      const isMask =
        /_mask$/i.test(base) ||
        type === "FOIL" ||
        type === "UV" ||
        type === "EMBOSS" ||
        type === "DEBOSS" ||
        (type === "DIECUT" && /_mask$/i.test(base));

      if (isMask) assets.maskPng = assetPath(jobId, f);
      else assets.png = assetPath(jobId, f);
    }

    // Merge placement if we have it (from Illustrator meta)
    // Keyed by plate id == base name (your script uses outName as id).
    const placement = placementById[base];

    const plate: any = {
      id: base,
      side,
      depthIndex, // layerIndex: which physical layer (0, 1, 2, ...)
      physicalPlyIndex: 0, // For future use: physical ply in multi-ply construction
      cardLayerCount: totalLayerCount, // Total number of layers for this card
      face: side, // keep existing behavior
      type,
      assets,
    };

    if (placement) {
      // Put placement fields directly on the plate for frontend convenience
      if (placement.dpiUsed != null) plate.dpiUsed = placement.dpiUsed;
      if (placement.cardPx) plate.cardPx = placement.cardPx;
      if (placement.startPx) plate.startPx = placement.startPx;
      if (placement.endPx) plate.endPx = placement.endPx;
      if (placement.rectPx) plate.rectPx = placement.rectPx;
      if (placement.sizePx) plate.sizePx = placement.sizePx;
      // Include layer info from placement if available
      if (placement.cardLayerCount != null) plate.cardLayerCount = placement.cardLayerCount;
      if (placement.layerIndex != null) plate.depthIndex = placement.layerIndex;
    }

    return plate;
  });

  // Calculate total card thickness based on layer count
  // Industry standard: 16pt (0.4064mm) per layer
  const baseThicknessPt = aiBaseThicknessPt;
  const baseThicknessMm = aiBaseThicknessMm;
  const totalThicknessPt = baseThicknessPt * totalLayerCount;
  const totalThicknessMm = baseThicknessMm * totalLayerCount;

  // Validation warnings
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Validate layer count consistency
  if (totalLayerCount === 0) {
    errors.push("No layers detected in design file");
  } else if (totalLayerCount > 3) {
    warnings.push(`Unusually high layer count (${totalLayerCount}). Most cards have 1-3 layers.`);
  }
  
  // Check for missing layer indices (e.g., layer_0 and layer_2 but no layer_1)
  const sortedIndices = Array.from(layerIndices).sort((a, b) => a - b);
  for (let i = 0; i < sortedIndices.length - 1; i++) {
    if (sortedIndices[i + 1] - sortedIndices[i] > 1) {
      warnings.push(`Gap in layer indices detected: found layer_${sortedIndices[i]} and layer_${sortedIndices[i + 1]} but missing intermediate layers`);
    }
  }
  
  // Validate thickness calculation
  if (totalThicknessMm < 0.3 || totalThicknessMm > 3.0) {
    warnings.push(`Calculated card thickness (${totalThicknessMm.toFixed(2)}mm) seems unusual. Typical range: 0.5-2.0mm`);
  }

  // Build the service meta payload (v1 schema) but with merged placement fields.
  const payload: any = {
    schemaVersion: "1.0.0",
    jobId,
    generatedAt: new Date().toISOString(),
    plates,
    // Layer information
    layerInfo: {
      totalLayerCount,
      maxLayerIndex,
      baseThicknessPt,
      baseThicknessMm,
      totalThicknessPt,
      totalThicknessMm,
    },
    // Card-level information (if available from AI meta)
    cards: aiCards.length > 0 ? aiCards : undefined,
    validation: { 
      passed: errors.length === 0, 
      warnings, 
      errors 
    },
  };

  // Overwrite meta.json with the merged payload (single meta.json output)
  const metaPath = path.join(outDir, "meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), "utf-8");
  return metaPath;
}
