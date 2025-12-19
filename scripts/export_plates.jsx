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

  // Hide all layers first
  for (var i = 0; i < doc.layers.length; i++) {
    doc.layers[i].visible = false;
  }

  /**
   * Export PNG at high resolution based on ARTBOARD size (not artwork bounds).
   * This is critical: otherwise Illustrator may export cropped small images.
   * @param {string} name - Output filename (without extension)
   * @param {number} targetWidthPx - Target pixel width (e.g., 4096)
   * @param {number} targetHeightPx - Target pixel height (e.g., 8192)
   */
  function exportPNG(name, targetWidthPx, targetHeightPx) {
    // Always export using artboard 0 (your pipeline assumes one card artboard)
    doc.artboards.setActiveArtboardIndex(0);

    var file = new File(outDir + "/" + name + ".png");

    // Get artboard dimensions in points (1 pt = 1 px at 72 DPI)
    var artboard = doc.artboards[0];
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
    // Export full artboard region. Without this, Illustrator may export only the
    // visible artwork bounds (which can be ~100x200 px).
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
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX);
    } else if (/_spot_uv$/.test(n)) {
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX);
    } else if (/_emboss$/.test(n) || /_deboss$/.test(n)) {
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX);
      // height generation happens server-side
    } else if (/_foil_/.test(n)) {
      exportPNG(n + "_mask", TARGET_WIDTH_PX, TARGET_HEIGHT_PX);
    } else if (/_print$/.test(n) || /_back_print$/.test(n)) {
      exportPNG(n, TARGET_WIDTH_PX, TARGET_HEIGHT_PX);
    }
  }

})();
