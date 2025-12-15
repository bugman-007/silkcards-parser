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

  function exportPNG(name, dpi) {
    var file = new File(outDir + "/" + name + ".png");
    var opts = new ExportOptionsPNG24();
    opts.antiAliasing = true;
    opts.transparency = true;
    opts.horizontalScale = 100.0;
    opts.verticalScale = 100.0;
    // Illustrator PNG export doesn't directly set DPI; rely on doc raster effects settings if needed.
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
      exportPNG(n + "_mask", 1200);
    } else if (/_spot_uv$/.test(n)) {
      exportPNG(n + "_mask", 1200);
    } else if (/_emboss$/.test(n) || /_deboss$/.test(n)) {
      exportPNG(n + "_mask", 1200);
      // height generation happens server-side
    } else if (/_foil_/.test(n)) {
      exportPNG(n + "_mask", 1200);
    } else if (/_print$/.test(n) || /_back_print$/.test(n)) {
      exportPNG(n, 600);
    }
  }

})();
