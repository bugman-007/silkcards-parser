#target illustrator

(function () {
  if (typeof __PARSER_ARGS__ === "undefined") {
    throw new Error("Missing __PARSER_ARGS__");
  }
  var outDir = __PARSER_ARGS__.outDir;

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
   * Export PNG at high resolution
   * @param {string} name - Output filename (without extension)
   * @param {number} targetWidthPx - Target pixel width (e.g., 2048)
   * @param {number} targetHeightPx - Target pixel height (e.g., 4096)
   */
  function exportPNG(name, targetWidthPx, targetHeightPx) {
    var file = new File(outDir + "/" + name + ".png");
    
    // Get artboard dimensions in points (72 points = 1 inch)
    var artboard = doc.artboards[0];
    var artboardWidthPt = artboard.artboardRect[2] - artboard.artboardRect[0];
    var artboardHeightPt = artboard.artboardRect[1] - artboard.artboardRect[3];
    // artboardRect is [left, top, right, bottom], so height = top - bottom (top > bottom)
    artboardHeightPt = Math.abs(artboardHeightPt);
    
    // Calculate scale factors to achieve target pixel dimensions
    // PNG export: outputPixels = artboardPoints * (scale / 100)
    // Therefore: scale = (targetPixels / artboardPoints) * 100
    var horizontalScale = (targetWidthPx / artboardWidthPt) * 100.0;
    var verticalScale = (targetHeightPx / artboardHeightPt) * 100.0;
    
    // Set raster effects resolution to match target resolution
    // This ensures any rasterized content (effects, placed images) is high-res
    var targetDPI = Math.max(
      (targetWidthPx / artboardWidthPt) * 72,
      (targetHeightPx / artboardHeightPt) * 72
    );
    doc.rasterEffectSettings.resolution = targetDPI;
    
    var opts = new ExportOptionsPNG24();
    opts.antiAliasing = true;
    opts.transparency = true;
    opts.horizontalScale = horizontalScale;
    opts.verticalScale = verticalScale;
    
    doc.exportFile(file, ExportType.PNG24, opts);
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

  // High-resolution export: 2048x4096 pixels (portrait orientation)
  // All layers use identical dimensions for consistent quality
  // Minimum: 1024x2048, Preferred: 2048x4096
  var TARGET_WIDTH_PX = 2048;
  var TARGET_HEIGHT_PX = 4096;

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
