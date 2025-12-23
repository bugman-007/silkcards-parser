#target illustrator

(function () {
  if (typeof __PARSER_ARGS__ === "undefined") {
    throw new Error("Missing __PARSER_ARGS__");
  }

  var outDir = __PARSER_ARGS__.outDir;
  var DPI = (__PARSER_ARGS__.dpi != null) ? __PARSER_ARGS__.dpi : 600;
  var MAX_PX = (__PARSER_ARGS__.maxPx != null) ? __PARSER_ARGS__.maxPx : 8192;

  var doc = app.activeDocument;

  // =========================
  // JSON stringify (ExtendScript-safe)
  // =========================
  function _isArray(v) { return v && typeof v === "object" && v.constructor === Array; }
  function _esc(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
  }
  function _stringify(v, pretty, level) {
    if (v === null) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return '"' + _esc(v) + '"';
    if (t === "object") {
      var indent = pretty ? "  " : "";
      var pad = "", padN = "";
      if (pretty) {
        for (var i = 0; i < level; i++) pad += indent;
        for (var j = 0; j < level + 1; j++) padN += indent;
      }
      if (_isArray(v)) {
        if (v.length === 0) return "[]";
        var a = [];
        for (var k = 0; k < v.length; k++) {
          a.push((pretty ? padN : "") + _stringify(v[k], pretty, level + 1));
        }
        return pretty ? ("[\n" + a.join(",\n") + "\n" + pad + "]") : ("[" + a.join(",") + "]");
      }
      var keys = [];
      for (var kk in v) if (v.hasOwnProperty(kk)) keys.push(kk);
      if (keys.length === 0) return "{}";
      var o = [];
      for (var m = 0; m < keys.length; m++) {
        var key = keys[m];
        var val = _stringify(v[key], pretty, level + 1);
        o.push((pretty ? padN : "") + '"' + _esc(key) + '":' + (pretty ? " " : "") + val);
      }
      return pretty ? ("{\n" + o.join(",\n") + "\n" + pad + "}") : ("{" + o.join(",") + "}");
    }
    return "null";
  }
  function stringify(obj, pretty) {
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.stringify) {
        return JSON.stringify(obj, null, pretty ? 2 : 0);
      }
    } catch (e) {}
    return _stringify(obj, !!pretty, 0);
  }

  // =========================
  // FS helpers
  // =========================
  function ensureFolder(p) {
    var f = new Folder(p);
    if (!f.exists) f.create();
    return f;
  }
  ensureFolder(outDir);

  // =========================
  // Visibility helpers
  // =========================
  function hideLayerRecursive(layer) {
    try { layer.visible = false; } catch (e) {}
    try {
      for (var i = 0; i < layer.layers.length; i++) hideLayerRecursive(layer.layers[i]);
    } catch (e2) {}
  }

  function unlockAndShowLayer(layer) {
    try { layer.locked = false; } catch (e) {}
    try { layer.template = false; } catch (e2) {}
    try { layer.printable = true; } catch (e3) {}
    try { layer.visible = true; } catch (e4) {}
  }

  function ensureLayerChainVisible(layer) {
    var cur = layer;
    while (cur && cur.typename === "Layer") {
      unlockAndShowLayer(cur);
      cur = cur.parent;
    }
  }

  function forceLayerVisible(layer) {
    ensureLayerChainVisible(layer);
    unlockAndShowLayer(layer);
    try {
      for (var i = 0; i < layer.layers.length; i++) forceLayerVisible(layer.layers[i]);
    } catch (e) {}
  }

  function soloLayer(layer) {
    for (var i = 0; i < doc.layers.length; i++) hideLayerRecursive(doc.layers[i]);
    forceLayerVisible(layer);
    try { app.redraw(); } catch (e0) {}
  }

  // Hide everything initially
  for (var i0 = 0; i0 < doc.layers.length; i0++) hideLayerRecursive(doc.layers[i0]);

  // =========================
  // Bounds utilities (points)
  // =========================
  function isValidBounds(b) {
    return b && b.length === 4 &&
      isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3]);
  }
  function rectW(b) { return Math.abs(b[2] - b[0]); }
  function rectH(b) { return Math.abs(b[1] - b[3]); }
  function rectArea(b) { return rectW(b) * rectH(b); }

  function unionBounds(a, b) {
    if (!a) return b;
    if (!b) return a;
    return [ Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.min(a[3], b[3]) ];
  }

  function intersectBounds(a, b) {
    var L = Math.max(a[0], b[0]);
    var T = Math.min(a[1], b[1]);
    var R = Math.min(a[2], b[2]);
    var B = Math.max(a[3], b[3]);
    if (R <= L || T <= B) return null;
    return [L, T, R, B];
  }

  function getBounds(obj) {
    var b = null;
    try { b = obj.geometricBounds; } catch (e) {}
    if (!isValidBounds(b) || rectW(b) < 0.01 || rectH(b) < 0.01) {
      try { b = obj.visibleBounds; } catch (e2) {}
    }
    if (!isValidBounds(b) || rectW(b) < 0.01 || rectH(b) < 0.01) return null;
    return b;
  }

  function walkPageItems(container, cb) {
    if (!container || !container.pageItems) return;
    for (var i = 0; i < container.pageItems.length; i++) {
      var it = container.pageItems[i];
      try { cb(it); } catch (e) {}
      try {
        if (it.typename === "GroupItem") walkPageItems(it, cb);
      } catch (e2) {}
    }
  }

  function collectLayerBounds(layer) {
    var bounds = null;
    walkPageItems(layer, function (it) {
      try { if (it.hidden) return; } catch (e0) {}
      var b = getBounds(it);
      if (!b) return;
      bounds = unionBounds(bounds, b);
    });
    try {
      for (var j = 0; j < layer.layers.length; j++) bounds = unionBounds(bounds, collectLayerBounds(layer.layers[j]));
    } catch (e3) {}
    return bounds;
  }

  function approx(a, b, relTol) {
    var d = Math.abs(a - b);
    var m = Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)));
    return (d / m) <= relTol;
  }

  // Heuristic: skip “card frame” rectangle items (stroked, no fill, same size as card)
  function isLikelyFrameItem(it, b, cardW, cardH) {
    if (!it || !b) return false;
    if (!approx(rectW(b), cardW, 0.02) || !approx(rectH(b), cardH, 0.02)) return false;
    try {
      if (it.typename === "PathItem") {
        if (it.stroked && !it.filled) return true;
        if (it.filled && it.fillColor && it.fillColor.typename === "NoColor") return true;
      }
    } catch (e) {}
    return false;
  }

  function collectLayerContentBounds(layer, cardW, cardH) {
    var bounds = null;
    walkPageItems(layer, function (it) {
      try { if (it.hidden) return; } catch (e0) {}
      var b = getBounds(it);
      if (!b) return;
      if (isLikelyFrameItem(it, b, cardW, cardH)) return;
      bounds = unionBounds(bounds, b);
    });
    return bounds;
  }

  // =========================
  // Units
  // =========================
  function ptsToPx(pt, dpi) { return (pt * dpi) / 72.0; }

  function rectToCardPx(cardRectPt, rectPt, dpi) {
    var cardL = cardRectPt[0];
    var cardT = cardRectPt[1];

    var L = rectPt[0], T = rectPt[1], R = rectPt[2], B = rectPt[3];

    var x0 = ptsToPx(L - cardL, dpi);
    var x1 = ptsToPx(R - cardL, dpi);
    var y0 = ptsToPx(cardT - T, dpi);
    var y1 = ptsToPx(cardT - B, dpi);

    return { x0: x0, y0: y0, x1: x1, y1: y1, w: (x1 - x0), h: (y1 - y0) };
  }

  // =========================
  // Temp artboard (reused)
  // =========================
  var __tempAB = null;
  var __restoreAB = null;
  var __restoreDPI = null;

  function initTempArtboard() {
    if (__tempAB !== null) return;
    __restoreAB = doc.artboards.getActiveArtboardIndex();
    __restoreDPI = doc.rasterEffectSettings.resolution;
    __tempAB = doc.artboards.length;
    doc.artboards.add([0, 0, 10, -10]);
  }

  function cleanupTempArtboard() {
    try {
      if (__restoreDPI !== null) doc.rasterEffectSettings.resolution = __restoreDPI;
      if (__restoreAB !== null) doc.artboards.setActiveArtboardIndex(__restoreAB);
    } catch (e) {}
    try {
      if (__tempAB !== null) doc.artboards.remove(__tempAB);
    } catch (e2) {}
    __tempAB = null; __restoreAB = null; __restoreDPI = null;
  }

  // Export PNG clipped to rect. Returns { dpiUsed, wPx, hPx }
  function exportPNGClipped(name, clipRectPt) {
    initTempArtboard();

    var file = new File(outDir + "/" + name + ".png");

    var wPt = rectW(clipRectPt);
    var hPt = rectH(clipRectPt);

    var wPxWant = ptsToPx(wPt, DPI);
    var hPxWant = ptsToPx(hPt, DPI);

    var dpiUsed = DPI;
    if (wPxWant > MAX_PX || hPxWant > MAX_PX) {
      var scaleDown = Math.max(wPxWant / MAX_PX, hPxWant / MAX_PX);
      dpiUsed = Math.floor(DPI / scaleDown);
      if (dpiUsed < 150) dpiUsed = 150;
    }

    var scalePct = (dpiUsed / 72.0) * 100.0;

    var opts = new ExportOptionsPNG24();
    opts.antiAliasing = true;
    opts.transparency = true;
    opts.artBoardClipping = true;
    opts.horizontalScale = scalePct;
    opts.verticalScale = scalePct;

    try {
      doc.rasterEffectSettings.resolution = dpiUsed;
      doc.artboards[__tempAB].artboardRect = clipRectPt;
      doc.artboards.setActiveArtboardIndex(__tempAB);
      doc.exportFile(file, ExportType.PNG24, opts);
    } finally {
      try { doc.rasterEffectSettings.resolution = __restoreDPI; } catch (e0) {}
      try { doc.artboards.setActiveArtboardIndex(__restoreAB); } catch (e1) {}
    }

    return {
      dpiUsed: dpiUsed,
      wPx: Math.round(ptsToPx(wPt, dpiUsed)),
      hPx: Math.round(ptsToPx(hPt, dpiUsed))
    };
  }

  function exportSVG(name) {
    var file = new File(outDir + "/" + name + ".svg");
    var opts = new ExportOptionsSVG();
    opts.embedRasterImages = true;
    opts.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
    opts.coordinatePrecision = 3;
    doc.exportFile(file, ExportType.SVG, opts);
  }

  // =========================
  // Layer naming / grouping
  // =========================
  function parsePrefix(name) {
    var n = String(name).replace(/^\s+|\s+$/g, "");
    var m = n.match(/^(front|back)_layer_(\d+)_/i);
    if (!m) return null;
    var side = m[1].toLowerCase();
    return { side: side, idx: parseInt(m[2], 10), prefix: side + "_layer_" + m[2] };
  }

  function classifyType(name) {
    var n = String(name).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (/_laser_cut$|_die_cut$/.test(n)) return "DIECUT";
    if (/_spot_uv$/.test(n)) return "UV";
    if (/_emboss$|_deboss$/.test(n)) return "EMBOSS";
    if (/_foil_/.test(n)) return "FOIL";
    if (/_print$|_back_print$/.test(n)) return "PRINT";
    return null;
  }

  var groups = {};
  for (var li = 0; li < doc.layers.length; li++) {
    var layer = doc.layers[li];
    var info = parsePrefix(layer.name);
    if (!info) continue;
    if (!groups[info.prefix]) groups[info.prefix] = { side: info.side, idx: info.idx, layers: [] };
    groups[info.prefix].layers.push(layer);
  }

  // Compute a “typical” card size for the group, without using union across tiles
  function computeGroupCardSize(group) {
    // Prefer DIECUT if present
    for (var i = 0; i < group.layers.length; i++) {
      if (/_laser_cut$|_die_cut$/i.test(group.layers[i].name)) {
        var b = collectLayerBounds(group.layers[i]);
        if (b) return { w: rectW(b), h: rectH(b) };
      }
    }

    // Otherwise, median area of per-layer bounds
    var arr = [];
    for (var j = 0; j < group.layers.length; j++) {
      var bb = collectLayerBounds(group.layers[j]);
      if (!bb) continue;
      arr.push({ b: bb, a: rectArea(bb) });
    }
    if (arr.length === 0) {
      var ab = doc.artboards[0].artboardRect;
      return { w: rectW(ab), h: rectH(ab) };
    }
    arr.sort(function (x, y) { return x.a - y.a; });
    var mid = arr[Math.floor(arr.length / 2)].b;
    return { w: rectW(mid), h: rectH(mid) };
  }

  // Find a cardRect inside a layer matching the group's card size (frame rectangle).
  // Fallback to the layer bounds (never null here if we call it after checking bounds).
  function findLayerCardRect(layer, cardW, cardH) {
    var best = null;
    var bestScore = 1e18;

    walkPageItems(layer, function (it) {
      var b = getBounds(it);
      if (!b) return;
      var w = rectW(b), h = rectH(b);
      if (!approx(w, cardW, 0.03) || !approx(h, cardH, 0.03)) return;
      var score = Math.abs(w - cardW) + Math.abs(h - cardH);
      if (score < bestScore) { bestScore = score; best = b; }
    });

    if (best) return best;

    var lb = collectLayerBounds(layer);
    return lb ? lb : doc.artboards[0].artboardRect;
  }

  // =========================
  // Meta
  // =========================
  var meta = { dpi: DPI, maxPx: MAX_PX, plates: [] };

  function pushMeta(group, type, outName, cardRectPt, exportRectPt, dpiUsed, pngW, pngH) {
    var r = rectToCardPx(cardRectPt, exportRectPt, dpiUsed);
    meta.plates.push({
      id: outName,
      side: group.side,
      layerIndex: group.idx,
      type: type,
      file: outName + ".png",
      dpiUsed: dpiUsed,
      rectPx: {
        x0: Math.round(r.x0),
        y0: Math.round(r.y0),
        x1: Math.round(r.x1),
        y1: Math.round(r.y1)
      },
      sizePx: { w: pngW, h: pngH }
    });
  }

  // =========================
  // MAIN EXPORT
  // =========================
  try {
    for (var prefix in groups) {
      if (!groups.hasOwnProperty(prefix)) continue;

      var g = groups[prefix];
      var cardSize = computeGroupCardSize(g);

      for (var k = 0; k < g.layers.length; k++) {
        var layer = g.layers[k];
        var type = classifyType(layer.name);
        if (!type) continue;

        soloLayer(layer);

        var layerBounds = collectLayerBounds(layer);
        if (!layerBounds) continue; // truly empty layer

        // Determine the cardRect for THIS plate (supports tiled layouts)
        var cardRectPt = findLayerCardRect(layer, cardSize.w, cardSize.h);

        // Decide export rect
        var exportRectPt = null;
        var outName = null;

        if (type === "PRINT") {
          // Always export the full card rect for print
          exportRectPt = cardRectPt;
          outName = layer.name;
        } else {
          // Effects: crop to actual content within the card
          var contentBounds = collectLayerContentBounds(layer, rectW(cardRectPt), rectH(cardRectPt));

          // Hard fallback: if content detection fails, export full card (never “empty”)
          if (!contentBounds) contentBounds = cardRectPt;

          // Prefer intersection with cardRect, but if it's a tiled plate and math fails, export content bounds
          var clipped = intersectBounds(contentBounds, cardRectPt);
          exportRectPt = clipped ? clipped : contentBounds;

          outName = layer.name + "_mask";
        }

        // Export
        var info = exportPNGClipped(outName, exportRectPt);

        // Meta
        pushMeta(g, type, outName, cardRectPt, exportRectPt, info.dpiUsed, info.wPx, info.hPx);

        // Diecut also exports SVG
        if (type === "DIECUT") {
          exportSVG(layer.name);
        }
      }
    }

    // Write meta.json
    var metaFile = new File(outDir + "/meta.json");
    metaFile.encoding = "UTF-8";
    metaFile.open("w");
    metaFile.write(stringify(meta, true));
    metaFile.close();

  } finally {
    cleanupTempArtboard();
  }

})();
