#target illustrator

(function () {
  if (typeof __PARSER_ARGS__ === "undefined") {
    throw new Error("Missing __PARSER_ARGS__");
  }
  var outDir = __PARSER_ARGS__.outDir;

  // Allow override from caller (recommended)
  // If not provided, default to higher-res than before.
  var TARGET_WIDTH_PX  = (__PARSER_ARGS__.targetWidthPx  != null) ? __PARSER_ARGS__.targetWidthPx  : 4096;
  var TARGET_HEIGHT_PX = (__PARSER_ARGS__.targetHeightPx != null) ? __PARSER_ARGS__.targetHeightPx : 8192;

  var doc = app.activeDocument;

  function ensureFolder(p) {
    var f = new Folder(p);
    if (!f.exists) f.create();
    return f;
  }

  ensureFolder(outDir);

  /**
   * Union two bounds rectangles
   * @param {Array} a - bounds [L, T, R, B] or null
   * @param {Array} b - bounds [L, T, R, B]
   * @returns {Array} union bounds [L, T, R, B]
   */
  function unionBounds(a, b) {
    // bounds: [L, T, R, B]
    if (!a) return b;
    return [
      Math.min(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.min(a[3], b[3])
    ];
  }

  /**
   * Find card bounds from diecut layer/pageItems
   * Returns bounds [L, T, R, B] or null if no diecut found
   */
  function findCardBoundsFromDiecut() {
    var bounds = null;
    for (var i = 0; i < doc.layers.length; i++) {
      var layer = doc.layers[i];
      if (!/_laser_cut$|_die_cut$/.test(layer.name)) continue;

      // Make sure we can read pageItems bounds even if hidden
      // (visibility doesn't always matter for geometricBounds, but keep simple)
      for (var j = 0; j < layer.pageItems.length; j++) {
        try {
          var b = layer.pageItems[j].geometricBounds; // [L,T,R,B]
          bounds = unionBounds(bounds, b);
        } catch (e) {}
      }
    }
    return bounds;
  }

  // Hide all layers first
  for (var i = 0; i < doc.layers.length; i++) {
    doc.layers[i].visible = false;
  }

  // Find card bounds and create export artboard
  var originalAB = doc.artboards.getActiveArtboardIndex();
  var cardRect = findCardBoundsFromDiecut();

  var exportABIndex = 0;
  var tempAB = null;

  if (cardRect) {
    // Create temporary artboard at card bounds
    tempAB = doc.artboards.add(cardRect);
    exportABIndex = doc.artboards.length - 1;
  } else {
    // Fallback to artboard 0 if no diecut found
    exportABIndex = 0;
  }

  /**
   * Export PNG at high resolution based on CARD BOUNDS (from diecut or fallback artboard).
   * This ensures exports are clipped/padded to card size, not full artboard.
   * @param {string} name - Output filename (without extension)
   * @param {number} targetWidthPx - Target pixel width (e.g., 4096)
   * @param {number} targetHeightPx - Target pixel height (e.g., 8192)
   * @param {number} abIndex - Artboard index to use for export bounds
   */
  function exportPNG(name, targetWidthPx, targetHeightPx, abIndex) {
    // Use the export artboard (card bounds or fallback)
    doc.artboards.setActiveArtboardIndex(abIndex);

    var file = new File(outDir + "/" + name + ".png");

    // Get artboard dimensions in points (1 pt = 1 px at 72 DPI)
    var artboard = doc.artboards[abIndex];
    var r = artboard.artboardRect; // [left, top, right, bottom]
    var artboardWidthPt  = Math.abs(r[2] - r[0]);
    var artboardHeightPt = Math.abs(r[1] - r[3]);

    // Compute scale to reach requested pixels.
    // IMPORTANT: use uniform scale to avoid stretching if aspect differs slightly.
    var hScale = (targetWidthPx  / artboardWidthPt)  * 100.0;
    var vScale = (targetHeightPx / artboardHeightPt) * 100.0;
    var scale = Math.max(hScale, vScale);

    // Save & temporarily raise raster effects resolution (for effects like blur, etc.)
    var prevDPI = doc.rasterEffectSettings.resolution;

    // Convert target pixels to effective DPI for the artboard size.
    // DPI = (pixels / points) * 72
    var dpiFromW = (targetWidthPx  / artboardWidthPt)  * 72.0;
    var dpiFromH = (targetHeightPx / artboardHeightPt) * 72.0;
    var targetDPI = Math.max(dpiFromW, dpiFromH);

    // Cap DPI to avoid Illustrator instability on some files
    if (targetDPI > 1200) targetDPI = 1200;

    doc.rasterEffectSettings.resolution = targetDPI;

    var opts = new ExportOptionsPNG24();
    opts.antiAliasing = true;
    opts.transparency = true;

    // CRITICAL FIX:
    // Export full artboard region (card bounds). Without this, Illustrator may export only the
    // visible artwork bounds (which can be ~100x200 px).
    // With artBoardClipping=true, smaller artwork is padded with transparency,
    // and larger artwork is cropped to card bounds.
    opts.artBoardClipping = true;

    // Apply uniform scale
    opts.horizontalScale = scale;
    opts.verticalScale = scale;

    doc.exportFile(file, ExportType.PNG24, opts);

    // Restore original DPI
    doc.rasterEffectSettings.resolution = prevDPI;
  }

  function exportSVG(name) {
    var file = new File(outDir + "/" + name + ".svg");
    var opts = new ExportOptionsSVG();
    opts.embedRasterImages = true;
    opts.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
    opts.coordinatePrecision = 3;
    doc.exportFile(file, ExportType.SVG, opts);
  }

  function soloLayer(layer) {
    for (var i = 0; i < doc.layers.length; i++) doc.layers[i].visible = false;
    layer.visible = true;
  }

  // Export by naming convention
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i];
    var n = layer.name;

    // Only process locked contract naming
    if (!/^(front|back)_layer_\d+_/.test(n)) continue;

    soloLayer(layer);
    
    // Draft rule: diecut if name contains laser_cut or die_cut
    if (/_laser_cut$|_die_cut$/.test(n)) {
      exportSVG(n);
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX, exportABIndex);
    } else if (/_spot_uv$/.test(n)) {
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX, exportABIndex);
    } else if (/_emboss$/.test(n) || /_deboss$/.test(n)) {
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX, exportABIndex);
      // height generation happens server-side
    } else if (/_foil_/.test(n)) {
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX, exportABIndex);
    } else if (/_print$/.test(n) || /_back_print$/.test(n)) {
      exportPNG(n, TARGET_WIDTH_PX, TARGET_HEIGHT_PX, exportABIndex);
    }
  }

  // Clean up: restore original artboard and remove temporary artboard if created
  doc.artboards.setActiveArtboardIndex(originalAB);
  if (tempAB) {
    doc.artboards.remove(exportABIndex);
  }

})();
