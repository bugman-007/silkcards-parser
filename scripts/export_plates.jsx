#target illustrator

(function () {
  if (typeof __PARSER_ARGS__ === "undefined") {
    throw new Error("Missing __PARSER_ARGS__");
  }

  var outDir = __PARSER_ARGS__.outDir;
  var DPI = __PARSER_ARGS__.dpi != null ? __PARSER_ARGS__.dpi : 600;
  var MAX_PX = __PARSER_ARGS__.maxPx != null ? __PARSER_ARGS__.maxPx : 8192;

  var doc = app.activeDocument;

  // =========================
  // JSON stringify (ExtendScript-safe)
  // =========================
  function _isArray(v) {
    return v && typeof v === "object" && v.constructor === Array;
  }
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
      var pad = "",
        padN = "";
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
        return pretty
          ? "[\n" + a.join(",\n") + "\n" + pad + "]"
          : "[" + a.join(",") + "]";
      }
      var keys = [];
      for (var kk in v) if (v.hasOwnProperty(kk)) keys.push(kk);
      if (keys.length === 0) return "{}";
      var o = [];
      for (var m = 0; m < keys.length; m++) {
        var key = keys[m];
        var val = _stringify(v[key], pretty, level + 1);
        o.push(
          (pretty ? padN : "") +
            '"' +
            _esc(key) +
            '":' +
            (pretty ? " " : "") +
            val
        );
      }
      return pretty
        ? "{\n" + o.join(",\n") + "\n" + pad + "}"
        : "{" + o.join(",") + "}";
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
    try {
      layer.visible = false;
    } catch (e) {}
    try {
      for (var i = 0; i < layer.layers.length; i++)
        hideLayerRecursive(layer.layers[i]);
    } catch (e2) {}
  }

  function unlockAndShowLayer(layer) {
    try {
      layer.locked = false;
    } catch (e) {}
    try {
      layer.template = false;
    } catch (e2) {}
    try {
      layer.printable = true;
    } catch (e3) {}
    try {
      layer.visible = true;
    } catch (e4) {}
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
      for (var i = 0; i < layer.layers.length; i++)
        forceLayerVisible(layer.layers[i]);
    } catch (e) {}
  }

  function soloLayer(layer) {
    for (var i = 0; i < doc.layers.length; i++)
      hideLayerRecursive(doc.layers[i]);
    forceLayerVisible(layer);
    try {
      app.redraw();
    } catch (e0) {}
  }

  // Hide everything initially
  for (var i0 = 0; i0 < doc.layers.length; i0++)
    hideLayerRecursive(doc.layers[i0]);

  // =========================
  // Bounds utilities (points)
  // =========================
  function isValidBounds(b) {
    return (
      b &&
      b.length === 4 &&
      isFinite(b[0]) &&
      isFinite(b[1]) &&
      isFinite(b[2]) &&
      isFinite(b[3])
    );
  }
  function rectW(b) {
    return Math.abs(b[2] - b[0]);
  }
  function rectH(b) {
    return Math.abs(b[1] - b[3]);
  }
  function rectArea(b) {
    return rectW(b) * rectH(b);
  }

  function unionBounds(a, b) {
    if (!a) return b;
    if (!b) return a;
    return [
      Math.min(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.min(a[3], b[3]),
    ];
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
    try {
      b = obj.geometricBounds;
    } catch (e) {}
    if (!isValidBounds(b) || rectW(b) < 0.01 || rectH(b) < 0.01) {
      try {
        b = obj.visibleBounds;
      } catch (e2) {}
    }
    if (!isValidBounds(b) || rectW(b) < 0.01 || rectH(b) < 0.01) return null;
    return b;
  }

  function walkPageItems(container, cb) {
    if (!container || !container.pageItems) return;
    for (var i = 0; i < container.pageItems.length; i++) {
      var it = container.pageItems[i];
      try {
        cb(it);
      } catch (e) {}
      try {
        if (it.typename === "GroupItem") walkPageItems(it, cb);
      } catch (e2) {}
    }
  }

  function walkLayerItemsDeep(layer, cb) {
    walkPageItems(layer, cb);
    try {
      for (var i = 0; i < layer.layers.length; i++) {
        walkLayerItemsDeep(layer.layers[i], cb);
      }
    } catch (e) {}
  }

  function collectLayerBounds(layer) {
    var bounds = null;
    walkLayerItemsDeep(layer, function (it) {
      try {
        if (it.hidden) return;
      } catch (e0) {}
      var b = getBounds(it);
      if (!b) return;
      bounds = unionBounds(bounds, b);
    });
    return bounds;
  }

  function approx(a, b, relTol) {
    var d = Math.abs(a - b);
    var m = Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)));
    return d / m <= relTol;
  }

  // Heuristic: skip “card frame” rectangle items (stroked, no fill, same size as card)
  function isLikelyFrameItem(it, b, cardW, cardH) {
    if (!it || !b) return false;
    if (!approx(rectW(b), cardW, 0.02) || !approx(rectH(b), cardH, 0.02))
      return false;
    try {
      if (it.typename === "PathItem") {
        if (it.stroked && !it.filled) return true;
        if (it.filled && it.fillColor && it.fillColor.typename === "NoColor")
          return true;
      }
    } catch (e) {}
    return false;
  }

  function collectLayerContentBounds(layer, cardW, cardH) {
    var bounds = null;

    // Current layer items
    walkPageItems(layer, function (it) {
      try {
        if (it.hidden) return;
      } catch (e0) {}
      var b = getBounds(it);
      if (!b) return;
      if (isLikelyFrameItem(it, b, cardW, cardH)) return;
      bounds = unionBounds(bounds, b);
    });

    // IMPORTANT: include nested sublayers too (many AI files keep masks inside sublayers)
    try {
      for (var j = 0; j < layer.layers.length; j++) {
        var child = collectLayerContentBounds(layer.layers[j], cardW, cardH);
        if (child) bounds = unionBounds(bounds, child);
      }
    } catch (e1) {}

    return bounds;
  }

  // =========================
  // Units
  // =========================
  function ptsToPx(pt, dpi) {
    return (pt * dpi) / 72.0;
  }

  function rectToCardPx(cardRectPt, rectPt, dpi) {
    var cardL = cardRectPt[0];
    var cardT = cardRectPt[1];

    var L = rectPt[0],
      T = rectPt[1],
      R = rectPt[2],
      B = rectPt[3];

    var x0 = ptsToPx(L - cardL, dpi);
    var x1 = ptsToPx(R - cardL, dpi);
    var y0 = ptsToPx(cardT - T, dpi);
    var y1 = ptsToPx(cardT - B, dpi);

    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
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
      if (__restoreDPI !== null)
        doc.rasterEffectSettings.resolution = __restoreDPI;
      if (__restoreAB !== null)
        doc.artboards.setActiveArtboardIndex(__restoreAB);
    } catch (e) {}
    try {
      if (__tempAB !== null) doc.artboards.remove(__tempAB);
    } catch (e2) {}
    __tempAB = null;
    __restoreAB = null;
    __restoreDPI = null;
  }

  // Export PNG clipped to rect. Returns { dpiUsed, wPx, hPx }
  function exportPNGClipped(name, clipRectPt, forcedDpi) {
    initTempArtboard();

    var file = new File(outDir + "/" + name + ".png");

    var wPt = rectW(clipRectPt);
    var hPt = rectH(clipRectPt);

    var dpiUsed = forcedDpi != null ? forcedDpi : DPI;

    // If not forced, apply MAX_PX limiter as before
    if (forcedDpi == null) {
      var wPxWant = ptsToPx(wPt, DPI);
      var hPxWant = ptsToPx(hPt, DPI);

      if (wPxWant > MAX_PX || hPxWant > MAX_PX) {
        var scaleDown = Math.max(wPxWant / MAX_PX, hPxWant / MAX_PX);
        dpiUsed = Math.floor(DPI / scaleDown);
        if (dpiUsed < 150) dpiUsed = 150;
      }
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
      try {
        doc.rasterEffectSettings.resolution = __restoreDPI;
      } catch (e0) {}
      try {
        doc.artboards.setActiveArtboardIndex(__restoreAB);
      } catch (e1) {}
    }

    return {
      dpiUsed: dpiUsed,
      wPx: Math.round(ptsToPx(wPt, dpiUsed)),
      hPx: Math.round(ptsToPx(hPt, dpiUsed)),
    };
  }

  function exportSVG(name) {
    var file = new File(outDir + "/" + name + ".svg");
    var opts = new ExportOptionsSVG();
    opts.embedRasterImages = false; // Safe default: keep SVGs clean
    opts.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
    opts.coordinatePrecision = 3;
    doc.exportFile(file, ExportType.SVG, opts);
  }

  // =========================
  // DIECUT SVG (outline-only) export
  // - Creates a temp document sized to cardRectPt
  // - Duplicates only diecut shapes (filters out red guide rectangles)
  // - Unites shapes, expands, converts to stroke-only outline
  // - Exports a clean SVG
  // =========================

  function isRedStrokeColor(c) {
    if (!c) return false;
    try {
      if (c.typename === "RGBColor") {
        return c.red >= 200 && c.green <= 80 && c.blue <= 80;
      }
      if (c.typename === "CMYKColor") {
        // Red-ish in CMYK: high M/Y, low C/K (heuristic)
        return c.cyan <= 20 && c.magenta >= 60 && c.yellow >= 60 && c.black <= 30;
      }
      if (c.typename === "SpotColor") {
        // Spot colors can be used for guides; check spot name if possible
        var sn = "";
        try { sn = (c.spot && c.spot.name) ? String(c.spot.name).toLowerCase() : ""; } catch (e) {}
        if (sn.indexOf("red") >= 0 || sn.indexOf("guide") >= 0 || sn.indexOf("bleed") >= 0) return true;
      }
    } catch (e0) {}
    return false;
  }

  function nameLooksGuide(it) {
    var n = "";
    try { n = it.name ? String(it.name).toLowerCase() : ""; } catch (e) {}
    if (!n) return false;
    return (
      n.indexOf("guide") >= 0 ||
      n.indexOf("bleed") >= 0 ||
      n.indexOf("safe") >= 0 ||
      n.indexOf("margin") >= 0 ||
      n.indexOf("frame") >= 0
    );
  }

  function isLikelyGuideRect(it, b, cardRectPt) {
    if (!it || !b) return false;

    // Only consider stroked, no-fill PathItems
    try {
      if (it.typename !== "PathItem") return false;
      if (!it.stroked) return false;
      if (it.filled && it.fillColor && it.fillColor.typename !== "NoColor") return false;
    } catch (e0) { return false; }

    // If explicitly named as guide -> always ignore
    if (nameLooksGuide(it)) return true;

    // Otherwise require rectangle-ish + near-frame + red stroke
    var isRectish = false;
    try { isRectish = it.closed && it.pathPoints && it.pathPoints.length === 4; } catch (e1) {}

    if (!isRectish) return false;

    var tol = 3.0;
    var near =
      Math.abs(b[0] - cardRectPt[0]) <= tol ||
      Math.abs(b[2] - cardRectPt[2]) <= tol ||
      Math.abs(b[1] - cardRectPt[1]) <= tol ||
      Math.abs(b[3] - cardRectPt[3]) <= tol;

    if (!near) return false;

    // Only now use red-stroke as signal
    try { return isRedStrokeColor(it.strokeColor); } catch (e2) {}
    return false;
  }

  function exportDiecutOutlineSVGFromLayer(layer, svgBaseName, cardRectPt) {
    // Collect candidate items from the diecut layer (including sublayers)
    var candidates = [];
    walkLayerItemsDeep(layer, function (it) {
      try { if (it.hidden) return; } catch (e0) {}

      // Only vector shapes
      var tn = "";
      try { tn = it.typename; } catch (e1) {}
      if (tn !== "PathItem" && tn !== "CompoundPathItem") return;

      var b = getBounds(it);
      if (!b) return;

      // Skip clipping paths (common in AI masks)
      try { if (it.clipping) return; } catch (ecl2) {}
      // Also skip paths inside clipped groups
      try { if (it.parent && it.parent.typename === "GroupItem" && it.parent.clipped) return; } catch (ecl2) {}

      // Filter out guide rectangles (red borders, etc.)
      if (tn === "PathItem" && isLikelyGuideRect(it, b, cardRectPt)) return;

      // Drop stroke-only rectangles that are near card bounds on ALL sides (regardless of color)
      // This catches "mystery frame" rectangles that aren't red or named as guides
      if (tn === "PathItem") {
        try {
          var isRectish = it.closed && it.pathPoints && it.pathPoints.length === 4;
          if (isRectish && it.stroked && (!it.filled || (it.fillColor && it.fillColor.typename === "NoColor"))) {
            // if it's within a few points of card bounds on ALL sides, treat as a frame and drop
            var tol2 = 3.0;
            var nearAll =
              Math.abs(b[0] - cardRectPt[0]) <= tol2 &&
              Math.abs(b[2] - cardRectPt[2]) <= tol2 &&
              Math.abs(b[1] - cardRectPt[1]) <= tol2 &&
              Math.abs(b[3] - cardRectPt[3]) <= tol2;
            if (nearAll) return;
          }
        } catch (e) {}
      }

      // Also skip full-card frames using your existing heuristic when it's clearly a frame
      // (but ONLY if it's stroked/no-fill; avoid dropping real card-outline diecut)
      try {
        if (tn === "PathItem") {
          if (it.stroked && (!it.filled || (it.fillColor && it.fillColor.typename === "NoColor"))) {
            if (isLikelyFrameItem(it, b, rectW(cardRectPt), rectH(cardRectPt))) {
              // if it also looks like a guide (red stroke/name), drop it
              if (isRedStrokeColor(it.strokeColor) || nameLooksGuide(it)) return;
            }
          }
        }
      } catch (e2) {}

      candidates.push(it);
    });

    if (candidates.length === 0) return null;

    // Create temp document in points with artboard = cardRectPt size
    var wPt = rectW(cardRectPt);
    var hPt = rectH(cardRectPt);

    var tmp = app.documents.add(DocumentColorSpace.RGB, wPt, hPt);
    try {
      // Force single artboard rect to [0, h, w, 0]
      try {
        tmp.artboards[0].artboardRect = [0, hPt, wPt, 0];
        tmp.artboards.setActiveArtboardIndex(0);
      } catch (eab) {}

      // Duplicate candidates into tmp active layer (more predictable than document root)
      for (var i = 0; i < candidates.length; i++) {
        try {
          candidates[i].duplicate(tmp.activeLayer, ElementPlacement.PLACEATBEGINNING);
        } catch (ed) {}
      }

      // Translate everything so cardRectPt maps to tmp artboard origin
      // dx = -left, dy = -bottom
      var dx = -cardRectPt[0];
      var dy = -cardRectPt[3];
      for (var p = 0; p < tmp.pageItems.length; p++) {
        try { tmp.pageItems[p].translate(dx, dy); } catch (et) {}
      }

      // IMPORTANT: ensure tmp is active before menu commands
      tmp.activate();

      // Make selection deterministic: select all, ungroup several times
      try { app.executeMenuCommand("selectall"); } catch (e0) {}
      for (var u = 0; u < 6; u++) {
        try { app.executeMenuCommand("ungroup"); } catch (e1) {}
      }

      // Now select only path-like items (avoid selecting groups entirely)
      tmp.selection = null;
      for (var s2 = 0; s2 < tmp.pageItems.length; s2++) {
        try {
          var it2 = tmp.pageItems[s2];
          if (it2.typename === "PathItem" || it2.typename === "CompoundPathItem") {
            it2.selected = true;
          }
        } catch (e2) {}
      }

      // Pathfinder Unite + Expand only if it can actually do something
      var shouldUnite = false;
      try {
        var sel = tmp.selection;
        var selCount = sel ? sel.length : 0;
        shouldUnite = selCount >= 2;  // KEY: count selected top-level objects
      } catch (e) {}

      if (shouldUnite) {
        var oldUIL = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        try {
          app.executeMenuCommand("Live Pathfinder Add");
          app.executeMenuCommand("expandStyle");
          app.executeMenuCommand("ungroup");
          app.executeMenuCommand("ungroup");
        } catch (e) {
          // ignore
        } finally {
          app.userInteractionLevel = oldUIL;
        }
      }
      // else: No need to pathfinder; just continue to styling/export

      // Convert resulting paths to stroke-only outline
      // (handle PathItem + CompoundPathItem)
      function stylePathItem(pi) {
        try { pi.filled = false; } catch (e0) {}
        try { pi.stroked = true; } catch (e1) {}
        try { pi.strokeWidth = 1; } catch (e2) {}
        try {
          var c = new RGBColor();
          c.red = 0; c.green = 0; c.blue = 0;
          pi.strokeColor = c;
        } catch (e3) {}
      }

      for (var q = 0; q < tmp.pathItems.length; q++) {
        try { stylePathItem(tmp.pathItems[q]); } catch (e5) {}
      }
      for (var cp = 0; cp < tmp.compoundPathItems.length; cp++) {
        try {
          var cpi = tmp.compoundPathItems[cp];
          // compoundPathItems contain pathItems children
          for (var k = 0; k < cpi.pathItems.length; k++) stylePathItem(cpi.pathItems[k]);
        } catch (e6) {}
      }

      // Export SVG
      var file = new File(outDir + "/" + svgBaseName + ".svg");
      var opts = new ExportOptionsSVG();
      opts.embedRasterImages = false; // critical: keep it small/clean
      opts.coordinatePrecision = 3;
      opts.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
      tmp.exportFile(file, ExportType.SVG, opts);

      return svgBaseName + ".svg";
    } finally {
      try { tmp.close(SaveOptions.DONOTSAVECHANGES); } catch (eclose) {}
    }
  }

  // =========================
  // Layer naming / grouping
  // =========================
  function parsePrefix(name) {
    var n = String(name).replace(/^\s+|\s+$/g, "");
    var m = n.match(/^(front|back)_layer_(\d+)_/i);
    if (!m) return null;
    var side = m[1].toLowerCase();
    return {
      side: side,
      idx: parseInt(m[2], 10),
      prefix: side + "_layer_" + m[2],
    };
  }

  function classifyType(name) {
    var n = String(name)
      .replace(/^\s+|\s+$/g, "")
      .toLowerCase();
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
    if (!groups[info.prefix]) {
      groups[info.prefix] = { side: info.side, idx: info.idx, layers: [] };
    }
    groups[info.prefix].layers.push(layer);
  }

  // =========================
  // Card rect resolution (per card index, shared across front/back)
  // - Solves: back has no die_cut / no full-frame print -> would otherwise fallback to artboard
  // - Works with multi-card artboards: we never use full artboard unless we truly have no geometry
  // =========================

  // Build cards map by index: cards[idx] = { idx, sides: {front: group?, back: group?} }
  var cards = {};
  for (var gp in groups) {
    if (!groups.hasOwnProperty(gp)) continue;
    var g0 = groups[gp];
    var idx0 = g0.idx;
    if (!cards[idx0])
      cards[idx0] = { idx: idx0, sides: { front: null, back: null } };
    cards[idx0].sides[g0.side] = g0;
  }

  function getLayerBoundsVisible(layer) {
    // Illustrator bounds can be unreliable if everything is hidden; enforce visibility through soloLayer.
    soloLayer(layer);
    return collectLayerBounds(layer);
  }

  function unionBoundsFromLayers(layers, typeWanted) {
    var u = null;
    if (!layers) return null;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (typeWanted && classifyType(L.name) !== typeWanted) continue;
      var b = getLayerBoundsVisible(L);
      if (!b) continue;
      u = unionBounds(u, b);
    }
    return u;
  }

  function unionBoundsFromGroupByType(group, typeWanted) {
    if (!group) return null;
    return unionBoundsFromLayers(group.layers, typeWanted);
  }

  // Old-project style crop picker:
  // Prefer PRINT union (most stable for card size),
  // then union of finishes,
  // then diecut (ONLY as fallback because diecut can be smaller than the card),
  // then any layer bounds,
  // lastly artboard (absolute last resort).
  function pickCardRectForIndex(card) {
    var frontG = card.sides.front;
    var backG = card.sides.back;

    // 1) PRINT union across BOTH sides (critical fix for Case A)
    var printU = null;
    printU = unionBounds(printU, unionBoundsFromGroupByType(frontG, "PRINT"));
    printU = unionBounds(printU, unionBoundsFromGroupByType(backG, "PRINT"));
    if (printU) return printU;

    // 2) Effects union across both sides (foil/uv/emboss)
    var fxU = null;
    function addFx(group) {
      if (!group) return;
      fxU = unionBounds(fxU, unionBoundsFromGroupByType(group, "FOIL"));
      fxU = unionBounds(fxU, unionBoundsFromGroupByType(group, "UV"));
      fxU = unionBounds(fxU, unionBoundsFromGroupByType(group, "EMBOSS"));
    }
    addFx(frontG);
    addFx(backG);
    if (fxU) return fxU;

    // 3) DIECUT as fallback only (can be smaller than card)
    var dieU = null;
    dieU = unionBounds(dieU, unionBoundsFromGroupByType(frontG, "DIECUT"));
    dieU = unionBounds(dieU, unionBoundsFromGroupByType(backG, "DIECUT"));
    if (dieU) return dieU;

    // 4) Any bounds (whatever exists) across both sides
    var anyU = null;
    function addAny(group) {
      if (!group) return;
      for (var i = 0; i < group.layers.length; i++) {
        var b = getLayerBoundsVisible(group.layers[i]);
        if (b) anyU = unionBounds(anyU, b);
      }
    }
    addAny(frontG);
    addAny(backG);
    if (anyU) return anyU;

    // 5) Absolute last resort: active artboard
    return doc.artboards[0].artboardRect;
  }

  function centerRectAround(seedBounds, wPt, hPt) {
    var cx = (seedBounds[0] + seedBounds[2]) * 0.5;
    var cy = (seedBounds[1] + seedBounds[3]) * 0.5;
    return [cx - wPt * 0.5, cy + hPt * 0.5, cx + wPt * 0.5, cy - hPt * 0.5];
  }

  function chooseDpiForRect(cardRectPt) {
    var wPt = rectW(cardRectPt),
      hPt = rectH(cardRectPt);
    var wPxWant = ptsToPx(wPt, DPI),
      hPxWant = ptsToPx(hPt, DPI);

    var dpiUsed = DPI;
    if (wPxWant > MAX_PX || hPxWant > MAX_PX) {
      var scaleDown = Math.max(wPxWant / MAX_PX, hPxWant / MAX_PX);
      dpiUsed = Math.floor(DPI / scaleDown);
      if (dpiUsed < 150) dpiUsed = 150;
    }
    return dpiUsed;
  }

  function pickSeedBoundsForSide(group) {
    if (!group) return null;

    // Prefer PRINT bounds on this side
    var printU = unionBoundsFromGroupByType(group, "PRINT");
    if (printU) return printU;

    // Then effects
    var fxU = null;
    fxU = unionBounds(fxU, unionBoundsFromGroupByType(group, "FOIL"));
    fxU = unionBounds(fxU, unionBoundsFromGroupByType(group, "UV"));
    fxU = unionBounds(fxU, unionBoundsFromGroupByType(group, "EMBOSS"));
    if (fxU) return fxU;

    // Then any bounds
    var anyU = null;
    for (var i = 0; i < group.layers.length; i++) {
      var b = getLayerBoundsVisible(group.layers[i]);
      if (b) anyU = unionBounds(anyU, b);
    }
    return anyU;
  }

  // Per index: same card size (W/H), but per-side position (front/back can be elsewhere on the artboard)
  var cardByIndex = {};
  for (var idxKey in cards) {
    if (!cards.hasOwnProperty(idxKey)) continue;

    var c = cards[idxKey];
    var frontSeed = pickSeedBoundsForSide(c.sides.front);
    var backSeed = pickSeedBoundsForSide(c.sides.back);

    // If one side missing, mirror from the other
    if (!frontSeed && backSeed) frontSeed = backSeed;
    if (!backSeed && frontSeed) backSeed = frontSeed;

    // Last resort: artboard (avoid if possible)
    if (!frontSeed && !backSeed) {
      var ab = doc.artboards[0].artboardRect;
      frontSeed = ab;
      backSeed = ab;
    }

    // Decide card size from seeds (max W/H so both sides share the same size)
    var wPt = Math.max(rectW(frontSeed), rectW(backSeed));
    var hPt = Math.max(rectH(frontSeed), rectH(backSeed));

    // OPTIONAL: if you have known card size, you can override here via __PARSER_ARGS__.cardWPt / cardHPt

    var frontCardRectPt = centerRectAround(frontSeed, wPt, hPt);
    var backCardRectPt = centerRectAround(backSeed, wPt, hPt);

    // Lock one dpiUsed per index (based on the card size)
    var dpiUsedIndex = chooseDpiForRect(frontCardRectPt);

    cardByIndex[idxKey] = {
      dpiUsed: dpiUsedIndex,
      rectBySide: { front: frontCardRectPt, back: backCardRectPt },
    };
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
    arr.sort(function (x, y) {
      return x.a - y.a;
    });
    var mid = arr[Math.floor(arr.length / 2)].b;
    return { w: rectW(mid), h: rectH(mid) };
  }

  // Find a cardRect inside a layer matching the group's card size (frame rectangle).
  // Fallback to the layer bounds (never null here if we call it after checking bounds).
  function findLayerCardRect(layer, cardW, cardH) {
    var best = null;
    var bestScore = 1e18;

    function scanLayer(lay) {
      // scan items in this layer (and group items)
      walkPageItems(lay, function (it) {
        var b = getBounds(it);
        if (!b) return;
        var w = rectW(b),
          h = rectH(b);
        if (!approx(w, cardW, 0.03) || !approx(h, cardH, 0.03)) return;
        var score = Math.abs(w - cardW) + Math.abs(h - cardH);
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      });

      // IMPORTANT: scan nested sublayers too
      try {
        for (var j = 0; j < lay.layers.length; j++) scanLayer(lay.layers[j]);
      } catch (e) {}
    }

    scanLayer(layer);

    // If we didn't find a real "card rect", return null so caller can keep artboard rect.
    return best;
  }

  // =========================
  // Meta
  // =========================
  var meta = { version: 2, dpi: DPI, maxPx: MAX_PX, plates: [] };
  var placementById = {};

  function pushMeta(
    group,
    type,
    outName,
    cardRectPt,
    exportRectPt,
    dpiUsed,
    pngW,
    pngH,
    assets
  ) {
    // r is placement of exportRect within the cardRect, in PIXELS
    var r = rectToCardPx(cardRectPt, exportRectPt, dpiUsed);

    // Full card canvas size at this dpi (PIXELS)
    var cardWpx = Math.round(ptsToPx(rectW(cardRectPt), dpiUsed));
    var cardHpx = Math.round(ptsToPx(rectH(cardRectPt), dpiUsed));

    var x0 = Math.round(r.x0);
    var y0 = Math.round(r.y0);
    var x1 = Math.round(r.x1);
    var y1 = Math.round(r.y1);

    var plate = {
      id: outName,
      side: group.side,
      layerIndex: group.idx,
      type: type,
      file: outName + ".png",
      dpiUsed: dpiUsed,
      cardPx: { w: cardWpx, h: cardHpx },
      startPx: { x: x0, y: y0 },
      endPx: { x: x1, y: y1 },
      rectPx: { x0: x0, y0: y0, x1: x1, y1: y1, w: Math.round(r.w), h: Math.round(r.h) },
      sizePx: { w: pngW, h: pngH }
    };
    if (assets) plate.assets = assets;
    meta.plates.push(plate);
    // Also store placement in a merge-friendly map (id -> placement)
    placementById[outName] = {
      dpiUsed: dpiUsed,
      cardPx: { w: cardWpx, h: cardHpx },
      startPx: { x: x0, y: y0 },
      endPx: { x: x1, y: y1 },
      rectPx: { x0: x0, y0: y0, x1: x1, y1: y1, w: Math.round(r.w), h: Math.round(r.h) },
      sizePx: { w: pngW, h: pngH },
    };
  }

  // =========================
  // MAIN EXPORT
  // =========================
  try {
    // Iterate per card index (shared card rect for front+back)
    var idxList = [];
    for (var idxStr in cards)
      if (cards.hasOwnProperty(idxStr)) idxList.push(idxStr);
    idxList.sort(function (a, b) {
      return parseInt(a, 10) - parseInt(b, 10);
    });

    for (var ii = 0; ii < idxList.length; ii++) {
      var idxStr = idxList[ii];
      if (!cards.hasOwnProperty(idxStr)) continue;

      var idx = parseInt(idxStr, 10);
      var cardInfo = cardByIndex[idxStr];
      var dpiForced = cardInfo.dpiUsed;

      // Export both sides if present
      function exportGroup(g) {
        if (!g) return;

        var cardRectPt = cardInfo.rectBySide[g.side];

        for (var k = 0; k < g.layers.length; k++) {
          var layer = g.layers[k];
          var type = classifyType(layer.name);
          if (!type) continue;

          soloLayer(layer);

          var layerBounds = collectLayerBounds(layer);
          if (!layerBounds) continue; // truly empty layer

          var exportRectPt = null;
          var outName = null;

          if (type === "PRINT") {
            // ALWAYS export prints at the full card rect for consistency
            exportRectPt = cardRectPt;
            outName = layer.name;
          } else {
            // Effects: crop to actual content but keep placement via rectPx relative to cardRectPt
            var contentBounds = collectLayerContentBounds(
              layer,
              rectW(cardRectPt),
              rectH(cardRectPt)
            );
            if (!contentBounds) contentBounds = cardRectPt;

            var clipped = intersectBounds(contentBounds, cardRectPt);
            exportRectPt = clipped ? clipped : contentBounds;

            // NOTE: keep your existing naming convention
            outName = layer.name + "_mask";
          }

          var info = exportPNGClipped(outName, exportRectPt, dpiForced);

          var assets = null;

          if (type === "DIECUT") {
            // Export a clean outline SVG in full card coordinate space
            var svgBase = outName; // Use same base name as PNG (includes "_mask")
            var svgFile = exportDiecutOutlineSVGFromLayer(layer, svgBase, cardRectPt);
            if (svgFile) assets = { svg: svgFile };
          }

          pushMeta(
            g,
            type,
            outName,
            cardRectPt,
            exportRectPt,
            info.dpiUsed,
            info.wPx,
            info.hPx,
            assets
          );
        }
      }

      exportGroup(cards[idxStr].sides.front);
      exportGroup(cards[idxStr].sides.back);
    }

    // Write meta.json
    var metaFile = new File(outDir + "/meta.json");
    metaFile.encoding = "UTF-8";
    if (!metaFile.open("w")) throw new Error("Failed to open meta.json for writing");
    // Also include placement lookup table inside meta.json (no separate file needed)
    meta.placementById = placementById;

    metaFile.write(stringify(meta, true));
    metaFile.close();
  } finally {
    cleanupTempArtboard();
  }
})();
