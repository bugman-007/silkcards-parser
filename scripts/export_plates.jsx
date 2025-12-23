#target illustrator

(function () {
  if (typeof __PARSER_ARGS__ === "undefined") {
    throw new Error("Missing __PARSER_ARGS__");
  }

  var outDir = __PARSER_ARGS__.outDir;
  var DPI = (__PARSER_ARGS__.dpi != null) ? __PARSER_ARGS__.dpi : 600;

  var doc = app.activeDocument;

  // =========================
  // JSON fallback (ExtendScript-safe)
  // =========================
  function _isArray(v) {
    return v && typeof v === "object" && v.constructor === Array;
  }

  function _escapeString(s) {
    // Minimal JSON escaping
    return s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
  }

  function _stringifyValue(v, indent, level) {
    if (v === null) return "null";

    var t = typeof v;
    if (t === "number") {
      if (!isFinite(v)) return "null";
      return String(v);
    }
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return '"' + _escapeString(v) + '"';

    if (t === "object") {
      var pad = "";
      var padNext = "";
      if (indent) {
        for (var i = 0; i < level * indent.length; i++) pad += indent.charAt(0);
        for (var j = 0; j < (level + 1) * indent.length; j++) padNext += indent.charAt(0);
      }

      if (_isArray(v)) {
        if (v.length === 0) return "[]";
        var partsA = [];
        for (var a = 0; a < v.length; a++) {
          var av = _stringifyValue(v[a], indent, level + 1);
          partsA.push(indent ? (padNext + av) : av);
        }
        if (indent) {
          return "[\n" + partsA.join(",\n") + "\n" + pad + "]";
        }
        return "[" + partsA.join(",") + "]";
      }

      // object
      var keys = [];
      for (var k in v) {
        if (v.hasOwnProperty(k)) keys.push(k);
      }
      if (keys.length === 0) return "{}";

      var partsO = [];
      for (var o = 0; o < keys.length; o++) {
        var key = keys[o];
        var val = _stringifyValue(v[key], indent, level + 1);
        if (indent) {
          partsO.push(padNext + '"' + _escapeString(key) + '": ' + val);
        } else {
          partsO.push('"' + _escapeString(key) + '":' + val);
        }
      }
      if (indent) {
        return "{\n" + partsO.join(",\n") + "\n" + pad + "}";
      }
      return "{" + partsO.join(",") + "}";
    }

    // undefined / function
    return "null";
  }

  function stringify(obj, pretty) {
    // Use native JSON if available, else fallback
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.stringify) {
        return JSON.stringify(obj, null, pretty ? 2 : 0);
      }
    } catch (e) {}
    return _stringifyValue(obj, pretty ? "  " : "", 0);
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
  // Visibility
  // =========================
  function hideLayerRecursive(layer) {
    try { layer.visible = false; } catch (e) {}
    try {
      for (var i = 0; i < layer.layers.length; i++) {
        hideLayerRecursive(layer.layers[i]);
      }
    } catch (e2) {}
  }

  for (var i = 0; i < doc.layers.length; i++) {
    hideLayerRecursive(doc.layers[i]);
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
      for (var i = 0; i < layer.layers.length; i++) {
        forceLayerVisible(layer.layers[i]);
      }
    } catch (e) {}
  }

  function soloLayer(layer) {
    for (var i = 0; i < doc.layers.length; i++) hideLayerRecursive(doc.layers[i]);
    forceLayerVisible(layer);
  }

  // =========================
  // Bounds utilities (points)
  // =========================
  function unionBounds(a, b) {
    if (!a) return b;
    return [
      Math.min(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.min(a[3], b[3])
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

  function isValidBounds(b) {
    return b && b.length === 4 &&
      isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3]);
  }

  function hasNonZeroBounds(b) {
    var w = Math.abs(b[2] - b[0]);
    var h = Math.abs(b[1] - b[3]);
    return w > 0.01 || h > 0.01;
  }

  function getBounds(obj) {
    var b = null;
    try { b = obj.geometricBounds; } catch (e) {}
    if (!isValidBounds(b) || !hasNonZeroBounds(b)) {
      try { b = obj.visibleBounds; } catch (e2) {}
    }
    if (!isValidBounds(b) || !hasNonZeroBounds(b)) return null;
    return b;
  }

  function collectLayerBounds(layer) {
    var bounds = null;

    walkPageItems(layer, function (it) {
      try {
        if (it.hidden) return;
      } catch (e0) {}
      var b = getBounds(it);
      if (!b) return;
      bounds = unionBounds(bounds, b);
    });

    try {
      for (var j = 0; j < layer.layers.length; j++) {
        var sb = collectLayerBounds(layer.layers[j]);
        bounds = unionBounds(bounds, sb);
      }
    } catch (e3) {}

    return bounds;
  }

  // =========================
  // Units
  // =========================
  function ptsToPx(pt) {
    return (pt * DPI) / 72.0;
  }

  function rectToCardPx(cardRectPt, rectPt) {
    var cardL = cardRectPt[0];
    var cardT = cardRectPt[1];

    var L = rectPt[0], T = rectPt[1], R = rectPt[2], B = rectPt[3];

    var x0 = ptsToPx(L - cardL);
    var x1 = ptsToPx(R - cardL);
    var y0 = ptsToPx(cardT - T);
    var y1 = ptsToPx(cardT - B);

    return {
      x0: x0, y0: y0,
      x1: x1, y1: y1,
      w: (x1 - x0),
      h: (y1 - y0)
    };
  }

  // =========================
  // Temp artboard (REUSED)
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

    __tempAB = null;
    __restoreAB = null;
    __restoreDPI = null;
  }

  // =========================
  // Export
  // =========================
  function exportPNGClipped(name, clipRectPt) {
    initTempArtboard();

    var file = new File(outDir + "/" + name + ".png");

    var wPt = Math.abs(clipRectPt[2] - clipRectPt[0]);
    var hPt = Math.abs(clipRectPt[1] - clipRectPt[3]);
    var wPx = ptsToPx(wPt);
    var hPx = ptsToPx(hPt);

    var MAX_PX = 8192;
    var safeDPI = DPI;

    if (wPx > MAX_PX || hPx > MAX_PX) {
      var scaleDown = Math.max(wPx / MAX_PX, hPx / MAX_PX);
      safeDPI = Math.floor(DPI / scaleDown);
      if (safeDPI < 150) safeDPI = 150;
    }

    var scalePct = (safeDPI / 72.0) * 100.0;

    var opts = new ExportOptionsPNG24();
    opts.antiAliasing = true;
    opts.transparency = true;
    opts.artBoardClipping = true;
    opts.horizontalScale = scalePct;
    opts.verticalScale = scalePct;

    try {
      doc.rasterEffectSettings.resolution = safeDPI;
      doc.artboards[__tempAB].artboardRect = clipRectPt;
      doc.artboards.setActiveArtboardIndex(__tempAB);
      doc.exportFile(file, ExportType.PNG24, opts);
    } finally {
      doc.rasterEffectSettings.resolution = __restoreDPI;
      doc.artboards.setActiveArtboardIndex(__restoreAB);
    }
  }

  function exportSVG(name) {
    var file = new File(outDir + "/" + name + ".svg");
    var opts = new ExportOptionsSVG();
    opts.embedRasterImages = true;
    opts.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
    opts.coordinatePrecision = 3;
    doc.exportFile(file, ExportType.SVG, opts);
  }

  function safeMenuCommand(cmd) {
    try {
      app.executeMenuCommand(cmd);
      return true;
    } catch (e) {
      return false;
    }
  }

  function applyWhiteFillToItem(item, white) {
    if (!item) return;
    if (item.typename === "GroupItem") {
      for (var i = 0; i < item.pageItems.length; i++) {
        applyWhiteFillToItem(item.pageItems[i], white);
      }
      return;
    }
    if (item.typename === "CompoundPathItem") {
      for (var j = 0; j < item.pathItems.length; j++) {
        applyWhiteFillToItem(item.pathItems[j], white);
      }
      return;
    }
    if (item.typename === "PathItem") {
      try {
        item.filled = true;
        item.fillColor = white;
        item.stroked = false;
      } catch (e1) {}
    }
  }

  function applyWhiteFillToSelection() {
    if (!doc.selection || doc.selection.length === 0) return false;
    var white = new RGBColor();
    white.red = 255;
    white.green = 255;
    white.blue = 255;
    for (var i = 0; i < doc.selection.length; i++) {
      applyWhiteFillToItem(doc.selection[i], white);
    }
    return true;
  }

  function normalizeFinishLayer() {
    safeMenuCommand("deselectall");
    safeMenuCommand("selectall");
    if (!doc.selection || doc.selection.length === 0) return false;

    // Expand appearance, outline strokes, and unite into solid geometry.
    safeMenuCommand("expandStyle");
    safeMenuCommand("expand");
    safeMenuCommand("outline");
    safeMenuCommand("outlineStroke");

    if (!safeMenuCommand("Live Pathfinder Unite")) {
      safeMenuCommand("Live Pathfinder Add");
    }
    safeMenuCommand("expandStyle");
    safeMenuCommand("expand");

    applyWhiteFillToSelection();
    return true;
  }

  // =========================
  // Layer parsing
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
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i];
    var info = parsePrefix(layer.name);
    if (!info) continue;
    if (!groups[info.prefix]) {
      groups[info.prefix] = { side: info.side, idx: info.idx, layers: [] };
    }
    groups[info.prefix].layers.push(layer);
  }

  function findCardRectPt(group) {
    var rect = null;

    for (var i = 0; i < group.layers.length; i++) {
      var name = String(group.layers[i].name).toLowerCase();
      if (/_laser_cut$|_die_cut$/.test(name)) {
        rect = unionBounds(rect, collectLayerBounds(group.layers[i]));
      }
    }
    if (rect) return rect;

    for (var j = 0; j < group.layers.length; j++) {
      var pname = String(group.layers[j].name).toLowerCase();
      if (/_print$|_back_print$/.test(pname)) {
        rect = unionBounds(rect, collectLayerBounds(group.layers[j]));
      }
    }
    if (rect) return rect;

    for (var k = 0; k < group.layers.length; k++) {
      rect = unionBounds(rect, collectLayerBounds(group.layers[k]));
    }
    if (rect) return rect;

    return doc.artboards[0].artboardRect;
  }

  // =========================
  // Meta
  // =========================
  var meta = { dpi: DPI, plates: [] };

  function pushMeta(group, type, name, cardRectPt, exportRectPt) {
    var r = rectToCardPx(cardRectPt, exportRectPt);
    meta.plates.push({
      id: name,
      side: group.side,
      layerIndex: group.idx,
      type: type,
      file: name + ".png",
      rectPx: {
        x0: Math.round(r.x0),
        y0: Math.round(r.y0),
        x1: Math.round(r.x1),
        y1: Math.round(r.y1)
      },
      sizePx: {
        w: Math.round(r.w),
        h: Math.round(r.h)
      }
    });
  }

  // =========================
  // MAIN
  // =========================
  try {
    for (var key in groups) {
      if (!groups.hasOwnProperty(key)) continue;

      var g = groups[key];
      var cardRectPt = findCardRectPt(g);

      for (var li = 0; li < g.layers.length; li++) {
        var layer = g.layers[li];
        var type = classifyType(layer.name);
        if (!type) continue;

        soloLayer(layer);
        try { app.redraw(); } catch (e0) {}

        if (type === "FOIL" || type === "UV" || type === "EMBOSS") {
          normalizeFinishLayer();
          try { app.redraw(); } catch (e1) {}
        }

        var layerBoundsPt = collectLayerBounds(layer);
        if (!layerBoundsPt) continue;

        var exportRectPt;
        var outName;

        if (type === "PRINT") {
          exportRectPt = cardRectPt;
          outName = layer.name;
        } else {
          exportRectPt = intersectBounds(layerBoundsPt, cardRectPt);
          if (!exportRectPt) {
            exportRectPt = cardRectPt;
          }
          outName = layer.name + "_mask";
        }

        exportPNGClipped(outName, exportRectPt);
        pushMeta(g, type, outName, cardRectPt, exportRectPt);

        if (type === "DIECUT") {
          exportSVG(layer.name);
        }
      }
    }
  } finally {
    cleanupTempArtboard();
  }

  // =========================
  // Write meta.json
  // =========================
  var metaFile = new File(outDir + "/meta.json");
  metaFile.encoding = "UTF-8";
  metaFile.open("w");
  metaFile.write(stringify(meta, true)); // ✅ no JSON dependency
  metaFile.close();

})();
