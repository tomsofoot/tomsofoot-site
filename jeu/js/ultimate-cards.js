/* Jogadle — Cartes officielles « Le Roi des Rois » (champion Ligue Ultime).
   Adaptateur NON-module pour la version d'essai autonome : il reprend EXACTEMENT
   le calcul Canvas de champion-card-renderer.js fourni (SAFE_NAME_ZONE, fitName,
   mesure réelle, réduction de taille puis d'espacement, export 1023×1537).
   Le module ES d'origine (champion-card-renderer.js) est conservé INCHANGÉ dans le
   projet pour la production. Aucun PNG n'est modifié/recadré/compressé.
   Les sources d'images viennent de window.JOGADLE_ULTIMATE_CARD_SRC (chemins en
   modulaire, data URIs inlinés dans l'essai autonome). */
(function (global) {
  "use strict";

  var VARIANTS = Object.freeze({
    roi_asie: "assets/roi-des-rois-asie.png",
    roi_viking: "assets/roi-des-rois-viking.png",
    roi_afrique: "assets/roi-des-rois-afrique.png"
  });
  // Ordre d'affichage « Modèle 1/2/3 » (identifiants techniques masqués aux joueurs).
  var ORDER = ["roi_asie", "roi_viking", "roi_afrique"];

  // Zone du cartouche doré, volontairement arrêtée AVANT le crampon (proportions du master 1023×1537).
  var SAFE_NAME_ZONE = Object.freeze({ x: 0.245, y: 0.857, width: 0.39, height: 0.06 });
  var FONT_FAMILY = '"Archivo Black", "Arial Black", sans-serif';

  function srcFor(variant) {
    var map = global.JOGADLE_ULTIMATE_CARD_SRC || VARIANTS;
    return map[variant] || VARIANTS[variant];
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.decoding = "async";
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("Impossible de charger " + src)); };
      image.src = src;
    });
  }
  function normalizeName(value) {
    var name = String(value == null ? "" : value).normalize("NFC").trim();
    if (!name) throw new Error("Pseudo manquant");
    return name;
  }
  function measureSpacedText(ctx, text, spacing) {
    var width = 0;
    for (var index = 0; index < text.length; index += 1) {
      width += ctx.measureText(text[index]).width;
      if (index < text.length - 1) width += spacing;
    }
    return width;
  }
  function drawSpacedText(ctx, text, centerX, baselineY, spacing) {
    var totalWidth = measureSpacedText(ctx, text, spacing);
    var cursor = centerX - totalWidth / 2;
    for (var i = 0; i < text.length; i++) {
      var character = text[i];
      ctx.fillText(character, cursor, baselineY);
      cursor += ctx.measureText(character).width + spacing;
    }
  }
  function fitName(ctx, text, maxWidth, imageWidth) {
    var maximum = Math.round(imageWidth * 0.046);
    var minimum = Math.round(imageWidth * 0.017);
    for (var size = maximum; size >= minimum; size -= 1) {
      ctx.font = "900 " + size + "px " + FONT_FAMILY;
      for (var spacing = Math.round(size * 0.08); spacing >= 0; spacing -= 0.5) {
        if (measureSpacedText(ctx, text, spacing) <= maxWidth) return { size: size, spacing: spacing };
      }
    }
    // Compatibilité comptes anciens > 20 caractères : réduire encore, jamais d'ellipse.
    var s = minimum;
    while (s > 8) {
      ctx.font = "900 " + s + "px " + FONT_FAMILY;
      if (ctx.measureText(text).width <= maxWidth) return { size: s, spacing: 0 };
      s -= 0.5;
    }
    throw new Error("Pseudo trop long pour la carte");
  }

  // Rendu du master 1023×1537 avec le pseudo gravé dans la zone sûre.
  function render(opts) {
    var variant = opts.variant, collectorName = opts.collectorName;
    var source = srcFor(variant);
    if (!source) return Promise.reject(new Error("Modèle de carte inconnu"));
    var ready = (global.document && global.document.fonts && global.document.fonts.ready) || Promise.resolve();
    return ready.then(function () { return loadImage(source); }).then(function (image) {
      var canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;   // 1023
      canvas.height = image.naturalHeight; // 1537
      var ctx = canvas.getContext("2d", { alpha: true });
      ctx.drawImage(image, 0, 0);
      var zone = {
        x: SAFE_NAME_ZONE.x * canvas.width,
        y: SAFE_NAME_ZONE.y * canvas.height,
        width: SAFE_NAME_ZONE.width * canvas.width,
        height: SAFE_NAME_ZONE.height * canvas.height
      };
      var name = normalizeName(collectorName);
      var fit = fitName(ctx, name, zone.width, canvas.width);
      ctx.font = "900 " + fit.size + "px " + FONT_FAMILY;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = "#170b27";
      ctx.shadowColor = "rgba(255, 245, 190, 0.42)";
      ctx.shadowBlur = Math.max(1, fit.size * 0.08);
      drawSpacedText(ctx, name, zone.x + zone.width / 2, zone.y + zone.height / 2, fit.spacing);
      // Métadonnées de contrôle (pour recette/tests) — n'altèrent pas le pixel.
      canvas.__fit = { size: fit.size, spacing: fit.spacing, zone: zone, textWidth: measureSpacedText(ctx, name, fit.spacing) };
      return canvas;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error("Export PNG impossible")); }, "image/png");
    });
  }
  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  // Téléchargement du VRAI PNG pleine résolution (jamais une capture d'écran).
  function downloadMaster(opts) {
    return render(opts).then(function (canvas) {
      return canvasToBlob(canvas).then(function (blob) {
        triggerDownload(blob, "jogadle-roi-des-rois-" + normalizeName(opts.collectorName) + ".png");
        return canvas;
      });
    });
  }

  // Export social : carte ENTIÈRE en `contain` sur fond violet/noir de marque (aucun recadrage).
  function renderSocial(opts) {
    var W = opts.width, H = opts.height;
    return render(opts).then(function (card) {
      var out = document.createElement("canvas");
      out.width = W; out.height = H;
      var ctx = out.getContext("2d");
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#140f34"); g.addColorStop(1, "#050414");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var pad = Math.round(Math.min(W, H) * 0.04);
      var availW = W - pad * 2, availH = H - pad * 2;
      var scale = Math.min(availW / card.width, availH / card.height); // contain
      var dw = Math.round(card.width * scale), dh = Math.round(card.height * scale);
      var dx = Math.round((W - dw) / 2), dy = Math.round((H - dh) / 2);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(card, dx, dy, dw, dh);
      out.__placement = { dx: dx, dy: dy, dw: dw, dh: dh, W: W, H: H, cropped: (dx < 0 || dy < 0 || dw > W || dh > H) };
      return out;
    });
  }
  function downloadSocial(opts) {
    return renderSocial(opts).then(function (canvas) {
      return canvasToBlob(canvas).then(function (blob) {
        triggerDownload(blob, "jogadle-roi-des-rois-" + normalizeName(opts.collectorName) + "-" + opts.width + "x" + opts.height + ".png");
        return canvas;
      });
    });
  }

  global.JogadleUltimateCards = {
    VARIANTS: VARIANTS, ORDER: ORDER, SAFE_NAME_ZONE: SAFE_NAME_ZONE,
    render: render, downloadMaster: downloadMaster, renderSocial: renderSocial, downloadSocial: downloadSocial
  };
})(window);
