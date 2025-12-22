#target illustrator

(function () {
  if (typeof __PARSER_ARGS__ === "undefined") throw new Error("Missing __PARSER_ARGS__");
  var outDir = __PARSER_ARGS__.outDir;
  var DPI = (__PARSER_ARGS__.dpi != null) ? __PARSER_ARGS__.dpi : 600; // keep quality high
  var doc = app.activeDocument;

  function ensureFolder(p) {
    var f = new Folder(p);
    if (!f.exists) f.create();
    return f;
  }
  ensureFolder(outDir);

  // Hide all layers first
  for (var i = 0; i < doc.layers.length; i++) doc.layers[i].visible = false;

  // ---------------------------
  // Bounds helpers (points)
  // ---------------------------
  function unionBounds(a, b) {
    if (!a) return b;
    return [
      Math.min(a[0], b[0]), // L
      Math.max(a[1], b[1]), // T
      Math.max(a[2], b[2]), // R
      Math.min(a[3], b[3])  // B
    ];
  }

  function intersectBounds(a, b) {
    // [L,T,R,B]
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

  function collectLayerBounds(layer) {
    var bounds = null;

    // include items in this layer
    walkPageItems(layer, function (it) {
      try {
        var b = it.geometricBounds; // [L,T,R,B]
        var w = Math.abs(b[2] - b[0]);
        var h = Math.abs(b[1] - b[3]);
        if (w > 0.5 && h > 0.5) bounds = unionBounds(bounds, b);
      } catch (e) {}
    });

    // include sublayers recursively
    try {
      for (var j = 0; j < layer.layers.length; j++) {
        var sb = collectLayerBounds(layer.layers[j]);
        bounds = unionBounds(bounds, sb);
      }
    } catch (e3) {}

    return bounds;
  }

  function ptsToPx(pt) {
    return (pt * DPI) / 72.0;
  }

  // Card pixel coordinate system:
  // origin (0,0) is TOP-LEFT of cardRect
  function rectToCardPx(cardRectPt, rectPt) {
    var cardL = cardRectPt[0], cardT = cardRectPt[1];
    var L = rectPt[0], T = rectPt[1], R = rectPt[2], B = rectPt[3];

    // x grows to the right
    var x0 = ptsToPx(L - cardL);
    var x1 = ptsToPx(R - cardL);

    // Illustrator top is larger than bottom.
    // For top-left origin with y down:
    var y0 = ptsToPx(cardT - T);
    var y1 = ptsToPx(cardT - B);

    return { x0: x0, y0: y0, x1: x1, y1: y1, w: (x1 - x0), h: (y1 - y0) };
  }

  // ---------------------------
  // Export helpers
  // ---------------------------
  function soloLayer(layer) {
    for (var i = 0; i < doc.layers.length; i++) doc.layers[i].visible = false;
    layer.visible = true;
  }

  function exportPNGClipped(name, clipRectPt) {
    // Create temp artboard at clip rect, export with artBoardClipping=true, remove it.
    var restoreIdx = doc.artboards.getActiveArtboardIndex();
    var prevDPI = doc.rasterEffectSettings.resolution;

    var idx = doc.artboards.length;
    doc.artboards.add(clipRectPt);
    doc.artboards.setActiveArtboardIndex(idx);

    // fixed DPI -> scale percent
    var scalePct = (DPI / 72.0) * 100.0;
    doc.rasterEffectSettings.resolution = DPI;

    var file = new File(outDir + "/" + name + ".png");
    var opts = new ExportOptionsPNG24();
    opts.antiAliasing = true;
    opts.transparency = true;
    opts.artBoardClipping = true;
    opts.horizontalScale = scalePct;
    opts.verticalScale = scalePct;

    doc.exportFile(file, ExportType.PNG24, opts);

    // restore
    doc.rasterEffectSettings.resolution = prevDPI;
    doc.artboards.setActiveArtboardIndex(restoreIdx);
    doc.artboards.remove(idx);
  }

  function exportSVG(name) {
    var file = new File(outDir + "/" + name + ".svg");
    var opts = new ExportOptionsSVG();
    opts.embedRasterImages = true;
    opts.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
    opts.coordinatePrecision = 3;
    doc.exportFile(file, ExportType.SVG, opts);
  }

  // ---------------------------
  // Layer naming + grouping
  // ---------------------------
  function parsePrefix(name) {
    // front_layer_0_xxx
    var m = name.match(/^(front|back)_layer_(\d+)_/);
    if (!m) return null;
    return { side: m[1], idx: parseInt(m[2], 10), prefix: m[1] + "_layer_" + m[2] };
  }

  function classifyType(layerName) {
    if (/_laser_cut$|_die_cut$/.test(layerName)) return "DIECUT";
    if (/_spot_uv$/.test(layerName)) return "UV";
    if (/_emboss$/.test(layerName) || /_deboss$/.test(layerName)) return "EMBOSS";
    if (/_foil_/.test(layerName)) return "FOIL";
    if (/_print$/.test(layerName) || /_back_print$/.test(layerName)) return "PRINT";
    return null;
  }

  // Group layers by card prefix (front_layer_0, back_layer_0, etc.)
  var groups = {}; // prefix -> { side, idx, layers: [] }
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i];
    var info = parsePrefix(layer.name);
    if (!info) continue;
    if (!groups[info.prefix]) groups[info.prefix] = { side: info.side, idx: info.idx, layers: [] };
    groups[info.prefix].layers.push(layer);
  }

  // Determine cardRect for each group:
  // Prefer diecut bounds; fallback to print bounds; fallback to artboard[0].
  function findCardRectPt(group) {
    var rect = null;

    // prefer diecut
    for (var i = 0; i < group.layers.length; i++) {
      var l = group.layers[i];
      if (/_laser_cut$|_die_cut$/.test(l.name)) {
        var b = collectLayerBounds(l);
        rect = unionBounds(rect, b);
      }
    }
    if (rect) return rect;

    // fallback print
    for (var j = 0; j < group.layers.length; j++) {
      var p = group.layers[j];
      if (/_print$/.test(p.name) || /_back_print$/.test(p.name)) {
        var pb = collectLayerBounds(p);
        rect = unionBounds(rect, pb);
      }
    }
    if (rect) return rect;

    // fallback artboard[0]
    return doc.artboards[0].artboardRect;
  }

  // ---------------------------
  // Export + meta.json
  // ---------------------------
  var meta = {
    dpi: DPI,
    plates: []
  };

  function pushMetaPlate(group, layer, type, fileName, rectPx, pngW, pngH) {
    meta.plates.push({
      id: fileName,
      side: group.side,
      layerIndex: group.idx,
      type: type,
      file: fileName + ".png",
      rectPx: {
        x0: Math.round(rectPx.x0),
        y0: Math.round(rectPx.y0),
        x1: Math.round(rectPx.x1),
        y1: Math.round(rectPx.y1)
      },
      sizePx: {
        w: Math.round(pngW),
        h: Math.round(pngH)
      }
    });
  }

  // Export each group
  for (var prefix in groups) {
    if (!groups.hasOwnProperty(prefix)) continue;
    var g = groups[prefix];

    var cardRectPt = findCardRectPt(g);
    var cardWpx = ptsToPx(Math.abs(cardRectPt[2] - cardRectPt[0]));
    var cardHpx = ptsToPx(Math.abs(cardRectPt[1] - cardRectPt[3]));

    for (var k = 0; k < g.layers.length; k++) {
      var layer = g.layers[k];
      var type = classifyType(layer.name);
      if (!type) continue;

      soloLayer(layer);

      // Determine export rect
      var layerBoundsPt = collectLayerBounds(layer);

      // If a layer has no items (bounds null), skip
      if (!layerBoundsPt) continue;

      var exportRectPt;
      var outName;

      if (type === "PRINT") {
        // PRINT: always export full card rect
        exportRectPt = cardRectPt;
        outName = layer.name; // e.g., front_layer_0_print
      } else {
        // Effects: export cropped to intersection with card rect
        exportRectPt = intersectBounds(layerBoundsPt, cardRectPt);
        if (!exportRectPt) continue; // nothing on card
        outName = layer.name + "_mask";
      }

      exportPNGClipped(outName, exportRectPt);

      // Meta rect in card coords (even for print it will be full-card)
      var rectPx = rectToCardPx(cardRectPt, exportRectPt);

      // Exported PNG dimensions in px (derive from rect in points at DPI)
      var pngW = ptsToPx(Math.abs(exportRectPt[2] - exportRectPt[0]));
      var pngH = ptsToPx(Math.abs(exportRectPt[1] - exportRectPt[3]));

      pushMetaPlate(g, layer, type, outName, rectPx, pngW, pngH);

      // Diecut also exports SVG (keep as before)
      if (type === "DIECUT") {
        exportSVG(layer.name);
        // You can optionally add svg file into meta if needed
      }
    }
  }

  // Write meta.json
  var metaFile = new File(outDir + "/meta.json");
  metaFile.encoding = "UTF-8";
  metaFile.open("w");
  metaFile.write(JSON.stringify(meta, null, 2));
  metaFile.close();

})();
