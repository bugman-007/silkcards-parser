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

  function expandAppearanceForSoloedLayer(targetLayer) {
    // Assumes soloLayer() was already called, so only the target layer is visible.
    // Convert GroupItem-level appearance fills/effects into real PathItems we can suppress.
    var oldUIL = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    try {
      try { doc.selection = null; } catch (e0) {}
  
      // Select everything visible (only the soloed layer should be visible)
      try { app.executeMenuCommand("selectall"); } catch (e1) {}
  
      // Expand appearance
      try { app.executeMenuCommand("expandStyle"); } catch (e2) {}
      try { app.executeMenuCommand("expand"); } catch (e3) {}
  
      // CRITICAL: ensure expanded result lives inside the intended layer container
      // (some AI builds leave expanded items as doc-level or outside the layer reference)
      try {
        if (targetLayer) {
          // group current selection
          try { app.executeMenuCommand("group"); } catch (eg) {}
  
          // move grouped selection into the target layer
          var sel = doc.selection;
          if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) {
              try { sel[i].moveToBeginning(targetLayer); } catch (em) {}
            }
          }
        }
      } catch (eM) {}
  
      try { app.redraw(); } catch (e4) {}
    } finally {
      app.userInteractionLevel = oldUIL;
    }
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
    walkLayerItemsDeep(layer, function (it) {
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

    // CRITICAL: don't matte transparent pixels to black (causes “all black” plates)
    opts.matte = false;

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

  // =========================
  // Guide rect suppression (for MASK png exports: FOIL/UV/EMBOSS)
  // - We CANNOT just hide clipping paths, or clipped content disappears.
  // - So: if rect is a clipping path (or parent clipped), remove its stroke;
  //        otherwise hide the rect.
  // - Restores everything afterwards.
  // =========================

  function _getPathItems(it) {
    // Normalize PathItem/CompoundPathItem to an array of PathItems
    try {
      if (!it) return [];
      if (it.typename === "PathItem") return [it];
      if (it.typename === "CompoundPathItem") {
        var arr = [];
        for (var i = 0; i < it.pathItems.length; i++) arr.push(it.pathItems[i]);
        return arr;
      }
    } catch (e) {}
    return [];
  }
  
  function _isInClippedGroup(it) {
    // Any ancestor GroupItem with clipped=true
    try {
      var p = it.parent;
      while (p) {
        if (p.typename === "GroupItem" && p.clipped) return true;
        if (p.typename === "Layer") break;
        p = p.parent;
      }
    } catch (e) {}
    return false;
  }
  
  function _isRectishStrokeOnlyPath(pi) {
    try {
      if (!pi || pi.typename !== "PathItem") return false;
      if (!pi.closed) return false;
      if (!pi.pathPoints || pi.pathPoints.length < 4) return false;
      if (!pi.stroked) return false;
  
      // No fill
      if (pi.filled) {
        if (!pi.fillColor) return false;
        if (pi.fillColor.typename !== "NoColor") return false;
      }
      return true;
    } catch (e) {}
    return false;
  }
  
  function isRectishStrokeOnly(it) {
    var pis = _getPathItems(it);
    if (pis.length === 0) return false;
    // Treat as rect if ANY child path looks like a rect stroke-only
    for (var i = 0; i < pis.length; i++) {
      if (_isRectishStrokeOnlyPath(pis[i])) return true;
    }
    return false;
  }
  
  function isGuideRectForMaskPlates(it, b, cardRectPt) {
    // Works for PathItem and CompoundPathItem
    if (!isRectishStrokeOnly(it)) return false;
  
    // Named guides always count
    if (nameLooksGuide(it)) return true;
  
    // Keep existing near-card-edge heuristic when we can
    if (cardRectPt && it.typename === "PathItem" && isLikelyGuideRect(it, b, cardRectPt)) return true;
  
    // Otherwise: red stroke rectangle of meaningful size -> treat as guide
    var pis = _getPathItems(it);
    var anyRed = false;
    for (var i = 0; i < pis.length; i++) {
      try {
        if (isRedStrokeColor(pis[i].strokeColor)) { anyRed = true; break; }
      } catch (e0) {}
    }
    if (!anyRed) return false;
  
    // Avoid nuking small red rectangles that could be real artwork
    if (cardRectPt && b) {
      var a = rectArea(b);
      var ca = rectArea(cardRectPt);
      if (ca > 1 && (a / ca) < 0.02) return false; // <2% of card: ignore
    }
  
    return true;
  }
  
  function suppressGuideRectsForMaskExport(layer, cardRectPt) {
    var touched = [];
  
    walkLayerItemsDeep(layer, function (it) {
      try { if (it.hidden) return; } catch (e0) {}
  
      // Handle PathItem + CompoundPathItem
      if (!it || (it.typename !== "PathItem" && it.typename !== "CompoundPathItem")) return;
  
      var b = getBounds(it);
      if (!b) return;
  
      if (!isGuideRectForMaskPlates(it, b, cardRectPt)) return;
  
      // Determine clipping safety
      var isClip = false;
      try { isClip = !!it.clipping; } catch (e1) { isClip = false; }
  
      // For CompoundPathItem, its child paths can carry clipping flag
      if (!isClip && it.typename === "CompoundPathItem") {
        try {
          for (var ci = 0; ci < it.pathItems.length; ci++) {
            if (it.pathItems[ci] && it.pathItems[ci].clipping) { isClip = true; break; }
          }
        } catch (e2) {}
      }
  
      var inClippedGroup = _isInClippedGroup(it);
  
      // If it is (or lives within) a clipped group, DO NOT hide it. Remove stroke instead.
      if (isClip || inClippedGroup) {
        var pis = _getPathItems(it);
        for (var p = 0; p < pis.length; p++) {
          var pi = pis[p];
          if (!pi) continue;
  
          var rec = { kind: "path", it: pi };
          try { rec.wasHidden = pi.hidden; } catch (e3) { rec.wasHidden = false; }
          try { rec.wasStroked = pi.stroked; } catch (e4) { rec.wasStroked = true; }
          try { rec.wasStrokeWidth = pi.strokeWidth; } catch (e5) { rec.wasStrokeWidth = 1; }
          try { rec.wasStrokeColor = pi.strokeColor; } catch (e6) {}
  
          try {
            pi.stroked = false;
            pi.strokeWidth = 0;
          } catch (e7) {}
  
          touched.push(rec);
        }
        return;
      }
  
      // Not clipped: safe to hide the whole item.
      // Prefer hiding the container (CompoundPathItem), fallback to hiding child paths.
      var hid = false;
      try {
        var recC = { kind: "container", it: it };
        try { recC.wasHidden = it.hidden; } catch (e8) { recC.wasHidden = false; }
        it.hidden = true;
        touched.push(recC);
        hid = true;
      } catch (e9) {}
  
      if (!hid) {
        var pis2 = _getPathItems(it);
        for (var q = 0; q < pis2.length; q++) {
          var pi2 = pis2[q];
          if (!pi2) continue;
  
          var rec2 = { kind: "path", it: pi2 };
          try { rec2.wasHidden = pi2.hidden; } catch (e10) { rec2.wasHidden = false; }
          try { pi2.hidden = true; } catch (e11) {}
          touched.push(rec2);
        }
      }
    });
  
    try { app.redraw(); } catch (eR) {}
    return touched;
  }
  
  function restoreSuppressedGuideRects(touched) {
    for (var i = 0; i < touched.length; i++) {
      var r = touched[i];
      var it = r.it;
      if (!it) continue;
  
      if (r.kind === "container") {
        try { it.hidden = r.wasHidden; } catch (e0) {}
        continue;
      }
  
      // path restore
      try { it.hidden = r.wasHidden; } catch (e1) {}
      if (r.hasOwnProperty("wasStroked")) {
        try { it.stroked = r.wasStroked; } catch (e2) {}
        try { it.strokeWidth = r.wasStrokeWidth; } catch (e3) {}
        try { if (r.wasStrokeColor) it.strokeColor = r.wasStrokeColor; } catch (e4) {}
      }
    }
    try { app.redraw(); } catch (eR) {}
  }
  
  function withGuideRectsSuppressed(layer, cardRectPt, fn) {
    var touched = suppressGuideRectsForMaskExport(layer, cardRectPt);
    try {
      return fn();
    } finally {
      restoreSuppressedGuideRects(touched);
    }
  }
  
  function isNearBlackFillColor(c) {
    if (!c) return false;
    try {
      var tn = c.typename;
  
      if (tn === "NoColor") return false;
  
      // Illustrator has a dedicated RegistrationColor type in some cases
      if (tn === "RegistrationColor") return true;
  
      if (tn === "RGBColor") {
        return c.red <= 30 && c.green <= 30 && c.blue <= 30;
      }
  
      if (tn === "GrayColor") {
        return c.gray <= 15;
      }
  
      if (tn === "CMYKColor") {
        var C = c.cyan, M = c.magenta, Y = c.yellow, K = c.black;
  
        // Plain black: high K, low CMY
        if (K >= 80 && C <= 25 && M <= 25 && Y <= 25) return true;
  
        // Registration-like black (often used for scaffolds/frames): all channels high
        if (K >= 80 && C >= 70 && M >= 70 && Y >= 70) return true;
  
        // Rich black fallback (covers many "looks black" builds)
        if (K >= 90 && (C + M + Y) <= 200) return true;
  
        return false;
      }
  
      if (tn === "SpotColor") {
        var sn = "";
        try {
          sn = (c.spot && c.spot.name) ? String(c.spot.name).toLowerCase() : "";
        } catch (e) {}
  
        // Common black/registration naming
        if (sn.indexOf("registration") >= 0) return true;
        if (sn === "k" || sn.indexOf("black") >= 0) return true;
  
        return false;
      }
    } catch (e0) {}
  
    return false;
  }
  
  function _looksRectishPath(pi) {
    try {
      // "Rect-ish" = closed path with at least 4 points (covers expanded/rounded rectangles too)
      return !!(pi && pi.closed && pi.pathPoints && pi.pathPoints.length >= 4);
    } catch (e) {}
    return false;
  }
  
  function _hasRealFill(pi) {
    try {
      if (!pi || !pi.filled) return false;
      if (pi.fillColor && pi.fillColor.typename === "NoColor") return false;
      return true; // includes RGB/CMYK/Spot/Gradient/Pattern/etc.
    } catch (e) {}
    return false;
  }
  
  // EMBOSS cleanup: treat ANY full-card filled rect-ish object as scaffold/matte.
  // (This function is only used inside withEmbossMaskCleanup -> suppressFullCardBlackMattes.)
  function isLikelyFullCardFilledMatte(it, b, cardRectPt) {
    if (!it || !b || !cardRectPt) return false;
  
    // Must cover ~whole card
    var ib = intersectBounds(b, cardRectPt);
    if (!ib) return false;
  
    var ca = rectArea(cardRectPt);
    if (ca <= 1) return false;
  
    // >=95% coverage = candidate scaffold
    if (rectArea(ib) / ca < 0.95) return false;
  
    try {
      if (it.typename === "PathItem") {
        // Full-card mattes are almost always rect-ish + filled
        if (!_looksRectishPath(it)) return false;
        return _hasRealFill(it);
      }
  
      if (it.typename === "CompoundPathItem") {
        // If ANY child path is filled + rect-ish, treat as matte
        for (var i = 0; i < it.pathItems.length; i++) {
          var pi = it.pathItems[i];
          if (!pi) continue;
          if (!_looksRectishPath(pi)) continue;
          if (_hasRealFill(pi)) return true;
        }
      }
    } catch (e1) {}
  
    return false;
  }
  
  
  function suppressFullCardBlackMattes(layer, cardRectPt) {
    var touched = [];
  
    walkLayerItemsDeep(layer, function (it) {
      try { if (it.hidden) return; } catch (e0) {}
  
      if (!it || (it.typename !== "PathItem" && it.typename !== "CompoundPathItem")) return;
  
      var b = getBounds(it);
      if (!b) return;
  
      // NOTE: isLikelyFullCardFilledMatte is now color-agnostic (any full-card filled rect-ish matte).
      if (!isLikelyFullCardFilledMatte(it, b, cardRectPt)) return;
  
      // If it’s used as a clip path or inside clipped group, don’t hide it; just remove its FILL.
      var isClip = false;
      try { isClip = !!it.clipping; } catch (e1) { isClip = false; }
  
      // For CompoundPathItem, child paths can carry the clipping flag
      if (!isClip && it.typename === "CompoundPathItem") {
        try {
          for (var ci = 0; ci < it.pathItems.length; ci++) {
            if (it.pathItems[ci] && it.pathItems[ci].clipping) { isClip = true; break; }
          }
        } catch (e2) {}
      }
  
      var inClippedGroup = _isInClippedGroup(it);
  
      // --- PathItem matte ---
      if (it.typename === "PathItem") {
        var rec = { kind: "fillPath", it: it };
        try { rec.wasHidden = it.hidden; } catch (e3) { rec.wasHidden = false; }
        try { rec.wasFilled = it.filled; } catch (e4) { rec.wasFilled = true; }
        try { rec.wasFillColor = it.fillColor; } catch (e5) {}
  
        try {
          if (isClip || inClippedGroup) {
            it.filled = false; // keep clipping, remove matte fill
          } else {
            it.hidden = true;  // safe to hide
          }
        } catch (e6) {}
  
        touched.push(rec);
        return;
      }
  
      // --- CompoundPathItem matte ---
      // If not clipped: hide the whole container (simplest + safest).
      if (!(isClip || inClippedGroup)) {
        try {
          var recC = { kind: "container", it: it };
          try { recC.wasHidden = it.hidden; } catch (e7) { recC.wasHidden = false; }
          it.hidden = true;
          touched.push(recC);
          return;
        } catch (e8) {
          // fallback to per-child edits below
        }
      }
  
      // If clipped: do NOT hide. Remove fill from child paths that have real fill.
      try {
        for (var i = 0; i < it.pathItems.length; i++) {
          var pi = it.pathItems[i];
          if (!pi) continue;
  
          // remove matte fill regardless of color type
          if (!pi.filled) continue;
          if (pi.fillColor && pi.fillColor.typename === "NoColor") continue;
  
          var rec2 = { kind: "fillPath", it: pi };
          try { rec2.wasHidden = pi.hidden; } catch (e9) { rec2.wasHidden = false; }
          try { rec2.wasFilled = pi.filled; } catch (e10) { rec2.wasFilled = true; }
          try { rec2.wasFillColor = pi.fillColor; } catch (e11) {}
  
          try {
            // clipped => remove fill (do not hide)
            pi.filled = false;
          } catch (e12) {}
  
          touched.push(rec2);
        }
      } catch (e13) {}
    });
  
    try { app.redraw(); } catch (eR) {}
    return touched;
  }  
  
  function restoreSuppressedFullCardBlackMattes(touched) {
    for (var i = 0; i < touched.length; i++) {
      var r = touched[i];
      var it = r.it;
      if (!it) continue;
  
      try { it.hidden = r.wasHidden; } catch (e0) {}
      if (r.kind === "fillPath") {
        try { it.filled = r.wasFilled; } catch (e1) {}
        try { if (r.wasFillColor) it.fillColor = r.wasFillColor; } catch (e2) {}
      }
    }
    try { app.redraw(); } catch (eR) {}
  }

  function isRasterLike(it) {
    try {
      var tn = it.typename;
      return tn === "RasterItem" || tn === "PlacedItem" || tn === "PluginItem";
    } catch (e) {}
    return false;
  }
  
  function isLikelyFullCardRasterMatte(it, b, cardRectPt) {
    if (!it || !b || !cardRectPt) return false;
  
    // Must cover ~whole card
    var ib = intersectBounds(b, cardRectPt);
    if (!ib) return false;
  
    var ca = rectArea(cardRectPt);
    if (ca <= 1) return false;
  
    if (rectArea(ib) / ca < 0.95) return false;
  
    // If explicitly named as artwork, don't touch it
    try {
      if (it.name && String(it.name).length) {
        var n = String(it.name).toLowerCase();
        if (n.indexOf("keep") >= 0) return false;
      }
    } catch (e2) {}
  
    return isRasterLike(it);
  }
  
  function suppressFullCardRasterMattes(layer, cardRectPt) {
    var touched = [];
  
    walkLayerItemsDeep(layer, function (it) {
      try { if (it.hidden) return; } catch (e0) {}
      if (!it) return;
  
      // Only raster-like items
      if (!isRasterLike(it)) return;
  
      var b = getBounds(it);
      if (!b) return;
  
      if (!isLikelyFullCardRasterMatte(it, b, cardRectPt)) return;
  
      var rec = { it: it, kind: "raster" };
      try { rec.wasHidden = it.hidden; } catch (e1) { rec.wasHidden = false; }
  
      try { it.hidden = true; } catch (e2) {}
  
      touched.push(rec);
    });
  
    try { app.redraw(); } catch (eR) {}
    return touched;
  }
  
  function restoreSuppressedRasterMattes(touched) {
    for (var i = 0; i < touched.length; i++) {
      var r = touched[i];
      if (!r || !r.it) continue;
      try { r.it.hidden = r.wasHidden; } catch (e0) {}
    }
    try { app.redraw(); } catch (eR) {}
  }  
  
  function withEmbossMaskCleanup(layer, cardRectPt, fn) {
    var g = suppressGuideRectsForMaskExport(layer, cardRectPt);
    var m = suppressFullCardBlackMattes(layer, cardRectPt);
    var r = suppressFullCardRasterMattes(layer, cardRectPt);
    try {
      return fn();
    } finally {
      restoreSuppressedRasterMattes(r);
      restoreSuppressedFullCardBlackMattes(m);
      restoreSuppressedGuideRects(g);
    }
  }  

  function exportDiecutOutlineSVGFromLayer(layer, svgBaseName, cardRectPt, svgRectPt) {
    var mapRectPt = svgRectPt || cardRectPt; // Use crop rect if provided, else fallback to card rect
    
    // Collect candidates deterministically:
    // 1) Prefer clip paths (common AI "clipped mask" structure)
    // 2) Else prefer filled shapes (mask region)
    // 3) Else fall back to stroked paths
    var clips = [];
    var fills = [];
    var strokes = [];
    var sawClippedGroup = false;

    function pushUnique(arr, it) {
      for (var i = 0; i < arr.length; i++) if (arr[i] === it) return;
      arr.push(it);
    }

    function isStrokeOnlyRectNearCard(it, b) {
      try {
        if (!it || it.typename !== "PathItem") return false;
        var isRectish = it.closed && it.pathPoints && it.pathPoints.length === 4;
        if (!isRectish) return false;

        var strokeOnly = it.stroked && (!it.filled || (it.fillColor && it.fillColor.typename === "NoColor"));
        if (!strokeOnly) return false;

        var tol = 3.0;
        var nearAll =
          Math.abs(b[0] - cardRectPt[0]) <= tol &&
          Math.abs(b[2] - cardRectPt[2]) <= tol &&
          Math.abs(b[1] - cardRectPt[1]) <= tol &&
          Math.abs(b[3] - cardRectPt[3]) <= tol;

        return nearAll;
      } catch (e) {}
      return false;
    }

    function isLargeFilledScaffoldRect(it, b, isClip) {
      // Only drop near-full-card FILLED rectangles (scaffolding), and never drop the clip path.
      if (isClip) return false;
      try {
        if (!it || it.typename !== "PathItem") return false;
        var isRectish = it.closed && it.pathPoints && it.pathPoints.length === 4;
        if (!isRectish) return false;

        var hasFill = it.filled && !(it.fillColor && it.fillColor.typename === "NoColor");
        if (!hasFill) return false;

        // VERY conservative: basically the whole card
        return rectArea(b) > rectArea(cardRectPt) * 0.95;
      } catch (e) {}
      return false;
    }

    // ---- PASS 1 (STRICT): drop clipped contents, prefer clip paths ----
    walkLayerItemsDeep(layer, function (it) {
      try { if (it.hidden) return; } catch (e0) {}

      var tn = "";
      try { tn = it.typename; } catch (e1) {}

      // If we encounter a clipped group, remember it (for fallback), and try to capture its clip path robustly.
      if (tn === "GroupItem") {
        try {
          if (it.clipped) {
            sawClippedGroup = true;

            // Try to identify the clip path even if some Illustrator builds don't expose .clipping reliably.
            // Priority: any child PathItem/CompoundPathItem with clipping=true; else first child PathItem; else first CompoundPathItem.
            var clipCand = null;

            try {
              // First search children for explicit clipping flag
              for (var pi = 0; pi < it.pathItems.length; pi++) {
                if (it.pathItems[pi] && it.pathItems[pi].clipping) { clipCand = it.pathItems[pi]; break; }
              }
            } catch (e2) {}

            if (!clipCand) {
              try {
                for (var ci = 0; ci < it.compoundPathItems.length; ci++) {
                  if (it.compoundPathItems[ci] && it.compoundPathItems[ci].clipping) { clipCand = it.compoundPathItems[ci]; break; }
                }
              } catch (e3) {}
            }

            if (!clipCand) {
              try { if (it.pathItems.length > 0) clipCand = it.pathItems[0]; } catch (e4) {}
            }
            if (!clipCand) {
              try { if (it.compoundPathItems.length > 0) clipCand = it.compoundPathItems[0]; } catch (e5) {}
            }

            if (clipCand) {
              var bb = getBounds(clipCand);
              if (bb) {
                // Reject candidates that do not meaningfully intersect the card rect
                var ibb = intersectBounds(bb, cardRectPt);
                if (!ibb) return;
                if (rectArea(ibb) < rectArea(bb) * 0.2) return;
                // Filter obvious guides/frames even for clip candidates
                if (clipCand.typename === "PathItem" && isLikelyGuideRect(clipCand, bb, cardRectPt)) return;
                if (clipCand.typename === "PathItem" && isStrokeOnlyRectNearCard(clipCand, bb)) return;
                pushUnique(clips, clipCand);
              }
            }
          }
        } catch (eg) {}
        return;
      }

      if (tn !== "PathItem" && tn !== "CompoundPathItem") return;

      var b = getBounds(it);
      if (!b) return;

      // Reject candidates that do not meaningfully intersect the card rect
      var ib = intersectBounds(b, cardRectPt);
      if (!ib) return;
      if (rectArea(ib) < rectArea(b) * 0.2) return;

      // Clipping groups: KEEP clip path, drop clipped contents
      var isClip = false;
      try { isClip = !!it.clipping; } catch (e6) {}

      var parentClipped = false;
      try { parentClipped = (it.parent && it.parent.typename === "GroupItem" && it.parent.clipped); } catch (e7) {}

      if (parentClipped && !isClip) return; // strict pass: drop clipped artwork

      // Drop guide rectangles (red borders / named guides)
      if (tn === "PathItem" && isLikelyGuideRect(it, b, cardRectPt)) return;

      // Drop near-card stroke-only frames regardless of color
      if (tn === "PathItem" && isStrokeOnlyRectNearCard(it, b)) return;

      // Classify filled region
      var hasFill = false;
      try {
        hasFill = (tn === "PathItem" && it.filled && !(it.fillColor && it.fillColor.typename === "NoColor"));
      } catch (e8) {}

      // Drop only near-full-card filled scaffold rectangles (conservative) and never drop clip paths
      if (tn === "PathItem" && isLargeFilledScaffoldRect(it, b, isClip)) return;

      if (isClip) pushUnique(clips, it);
      else if (hasFill) fills.push(it);
      else strokes.push(it);
    });

    // If strict pass found nothing but we did see clipped groups, do a relaxed pass:
    // allow clipped contents (because some files encode the diecut region as clipped content, not the clip path).
    if (clips.length === 0 && fills.length === 0 && strokes.length === 0 && sawClippedGroup) {
      walkLayerItemsDeep(layer, function (it) {
        try { if (it.hidden) return; } catch (e0) {}

        var tn = "";
        try { tn = it.typename; } catch (e1) {}
        if (tn !== "PathItem" && tn !== "CompoundPathItem") return;

        var b = getBounds(it);
        if (!b) return;

        // Reject candidates that do not meaningfully intersect the card rect
        var ib = intersectBounds(b, cardRectPt);
        if (!ib) return;
        if (rectArea(ib) < rectArea(b) * 0.2) return;

        // Keep clip paths if present; otherwise allow clipped contents now.
        var isClip = false;
        try { isClip = !!it.clipping; } catch (e2) {}

        // Still drop guides/frames
        if (tn === "PathItem" && isLikelyGuideRect(it, b, cardRectPt)) return;
        if (tn === "PathItem" && isStrokeOnlyRectNearCard(it, b)) return;

        var hasFill = false;
        try {
          hasFill = (tn === "PathItem" && it.filled && !(it.fillColor && it.fillColor.typename === "NoColor"));
        } catch (e3) {}

        // Still drop only near-full-card filled scaffold rectangles
        if (tn === "PathItem" && isLargeFilledScaffoldRect(it, b, isClip)) return;

        if (isClip) pushUnique(clips, it);
        else if (hasFill) fills.push(it);
        else strokes.push(it);
      });
    }

    var candidates = (clips.length > 0) ? clips : ((fills.length > 0) ? fills : strokes);
    if (candidates.length === 0) return null;

    // Create temp document in points with artboard = mapRectPt size (CROP space)
    var wPt = rectW(mapRectPt);
    var hPt = rectH(mapRectPt);

    var tmp = app.documents.add(DocumentColorSpace.RGB, wPt, hPt);
    try {
      // Force single artboard rect to [0, h, w, 0]
      try {
        tmp.artboards[0].artboardRect = [0, hPt, wPt, 0];
        tmp.artboards.setActiveArtboardIndex(0);
      } catch (eab) {}

      // Duplicate candidates into tmp doc (duplicate into active layer, not the document)
      for (var i = 0; i < candidates.length; i++) {
        try {
          candidates[i].duplicate(tmp.activeLayer, ElementPlacement.PLACEATBEGINNING);
        } catch (ed) {}
      }

      // Group all duplicated items and translate ONCE (prevents double-translation)
      var rootG = tmp.activeLayer.groupItems.add();
      for (var mi = tmp.activeLayer.pageItems.length - 1; mi >= 0; mi--) {
        var pit = tmp.activeLayer.pageItems[mi];
        if (pit !== rootG) {
          try { pit.moveToBeginning(rootG); } catch (em) {}
        }
      }

      // Map mapRectPt to temp artboard [0..w, 0..h]
      var dx = -mapRectPt[0];
      var dy = hPt - mapRectPt[1];
      try { rootG.translate(dx, dy); } catch (et2) {}

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

      // Pathfinder Unite + Expand only if there are 2+ selected top-level objects
      var shouldUnite = false;
      try {
        var sel = tmp.selection;
        var selCount = sel ? sel.length : 0;
        shouldUnite = selCount >= 2;
      } catch (e) {}

      if (shouldUnite) {
        var oldUIL = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        try {
          app.executeMenuCommand("Live Pathfinder Add");
          app.executeMenuCommand("expandStyle");
          app.executeMenuCommand("ungroup");
          app.executeMenuCommand("ungroup");
        } catch (e3) {
          // ignore
        } finally {
          app.userInteractionLevel = oldUIL;
        }
      }

      // Convert resulting paths to stroke-only outline
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
          for (var k = 0; k < cpi.pathItems.length; k++) stylePathItem(cpi.pathItems[k]);
        } catch (e6) {}
      }

      // Export SVG
      var file = new File(outDir + "/" + svgBaseName + ".svg");
      var opts = new ExportOptionsSVG();
      opts.embedRasterImages = false; // critical
      opts.coordinatePrecision = 3;
      opts.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
      tmp.exportFile(file, ExportType.SVG, opts);

      return svgBaseName + ".svg";
    } finally {
      try { tmp.close(SaveOptions.DONOTSAVECHANGES); } catch (eclose) {}
    }
  }

  /**
   * Fallback: generate diecut outline SVG from PNG mask via Image Trace.
   * Used when vector candidates are empty (raster-only, placed items, etc.).
   */
  function exportDiecutOutlineSVGFromMaskPNG(pngFilename, svgBaseName, svgRectPt) {
    var pngFile = new File(outDir + "/" + pngFilename);
    if (!pngFile.exists) return null;
  
    var wPt = rectW(svgRectPt);
    var hPt = rectH(svgRectPt);
  
    var tmp = app.documents.add(DocumentColorSpace.RGB, wPt, hPt);
    try {
      tmp.artboards[0].artboardRect = [0, hPt, wPt, 0];
      tmp.artboards.setActiveArtboardIndex(0);
  
      // Place the CROPPED PNG to exactly fill the artboard (0..w, 0..h)
      var placed = tmp.placedItems.add();
      placed.file = pngFile;
      placed.width = wPt;
      placed.height = hPt;
      placed.left = 0;
      placed.top = hPt;
      app.redraw();
  
      tmp.activate();
  
      // Trace
      var pluginItem = placed.trace();
      app.redraw();
  
      var tr = pluginItem.tracing;
      var opt = tr.tracingOptions;
  
      opt.tracingMode = TracingModeType.TRACINGMODEBLACKANDWHITE;
      opt.fills = true;
      opt.strokes = false;
      opt.ignoreWhite = true;
      opt.threshold = 128;
      opt.pathFitting = 0.5;
      opt.cornerAngle = 20;
      opt.minArea = 1;
      opt.preprocessBlur = 0.0;
      opt.livePaintOutput = false;
  
      try { tr.retrace(); app.redraw(); } catch (e) {}
      app.redraw();
  
      // Expand
      try { tr.expandTracing(false); } catch (eExp) { return null; }
      app.redraw();
  
      // Cleanup raster + plugin container
      try { pluginItem.remove(); } catch (ePI) {}
      try { placed.remove(); } catch (eRm) {}
  
      // Remove any traced “outer frame” rectangle matching the artboard bounds
      var frameTol = 2.0;
      var rectB = [0, hPt, wPt, 0];
      var kill = [];
      for (var i = 0; i < tmp.pathItems.length; i++) {
        var p = tmp.pathItems[i];
        if (!p.closed) continue;
        var bb = getBounds(p);
        if (!bb) continue;
  
        var isFrame =
          Math.abs(bb[0] - rectB[0]) <= frameTol &&
          Math.abs(bb[1] - rectB[1]) <= frameTol &&
          Math.abs(bb[2] - rectB[2]) <= frameTol &&
          Math.abs(bb[3] - rectB[3]) <= frameTol;
  
        if (isFrame) kill.push(p);
      }
      for (var k = 0; k < kill.length; k++) { try { kill[k].remove(); } catch (eK) {} }
  
      // Stroke-only styling
      function stylePathItem(pi) {
        try { pi.filled = false; } catch (e0) {}
        try { pi.stroked = true; } catch (e1) {}
        try { pi.strokeWidth = 1; } catch (e2) {}
        try {
          var c = new RGBColor(); c.red = 0; c.green = 0; c.blue = 0;
          pi.strokeColor = c;
        } catch (e3) {}
      }
  
      for (var q = 0; q < tmp.pathItems.length; q++) {
        try { stylePathItem(tmp.pathItems[q]); } catch (e5) {}
      }
      for (var cp = 0; cp < tmp.compoundPathItems.length; cp++) {
        try {
          var cpi = tmp.compoundPathItems[cp];
          for (var j = 0; j < cpi.pathItems.length; j++) stylePathItem(cpi.pathItems[j]);
        } catch (e6) {}
      }
  
      // Export SVG
      var file = new File(outDir + "/" + svgBaseName + ".svg");
      var opts = new ExportOptionsSVG();
      opts.embedRasterImages = false;
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

          // CRITICAL: make group-level fills/effects real geometry for emboss export
          if (type === "EMBOSS") {
            expandAppearanceForSoloedLayer(layer);
          }

          var layerBounds = collectLayerBounds(layer);
          if (!layerBounds) continue;

          var exportRectPt = null;
          var outName = null;

          function doPlateExport() {
            if (type === "PRINT") {
              // ALWAYS export prints at full card rect
              exportRectPt = cardRectPt;
              outName = layer.name;
            } else {
              if (type === "EMBOSS") {
                exportRectPt = cardRectPt; // stable, avoids missing emboss art due to bounds heuristics
              } else {
                var contentBounds = collectLayerContentBounds(
                  layer,
                  rectW(cardRectPt),
                  rectH(cardRectPt)
                );
                if (!contentBounds) contentBounds = cardRectPt;
            
                var clipped = intersectBounds(contentBounds, cardRectPt);
                exportRectPt = clipped ? clipped : contentBounds;
              }
            
              outName = layer.name + "_mask";
            }
          
            return exportPNGClipped(outName, exportRectPt, dpiForced);
          }
          
          var info;
          
          // Apply guide-rect suppression for mask exports that often contain those red frames.
          // DO NOT apply to DIECUT: diecut paths are often red stroke lines and you’ll hide real cut geometry.
          if (type === "EMBOSS") {
            info = withEmbossMaskCleanup(layer, cardRectPt, doPlateExport);
          } else if (type === "UV" || type === "FOIL") {
            info = withGuideRectsSuppressed(layer, cardRectPt, doPlateExport);
          } else {
            info = doPlateExport();
          }     

          var assets = null;

          if (type === "DIECUT") {
            // Export SVG in the SAME coordinate space as the PNG crop (exportRectPt)
            var svgBase = outName;
          
            var svgFile = exportDiecutOutlineSVGFromLayer(layer, svgBase, cardRectPt, exportRectPt);
            if (!svgFile) {
              svgFile = exportDiecutOutlineSVGFromMaskPNG(outName + ".png", svgBase, exportRectPt);
            }
            if (!svgFile) throw new Error("Diecut SVG export failed: " + layer.name);
          
            assets = { svg: svgFile };
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