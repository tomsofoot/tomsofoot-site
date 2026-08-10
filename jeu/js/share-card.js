/* ================================================================
   JOGADLE — Générateur PNG premium 1080 x 1080
   Visuel uniquement : aucune règle de tirage n'est modifiée, aucune cible n'est calculée ici.

   Le générateur n'accepte QUE des états déjà renvoyés par le serveur (matchStates est calculé
   côté serveur ; le client ne connaît jamais la cible). `rows` est un tableau de lignes, chaque
   ligne étant un tableau de 7 chaînes "correct" | "wrong".

   API d'intégration :
   await JogadleShareCard.download({
     puzzleId,
     score: state.guesses.length,
     rows: state.guesses.map(g => g.states.map(s => s.state)), // états serveur uniquement
     logoSrc: "tomsofoot-logo.png"
   });
   ================================================================ */
(function (global) {
  "use strict";

  const W = 1080;
  const H = 1080;
  const COLORS = Object.freeze({
    bg0: "#050614",
    bg1: "#0b0c24",
    bg2: "#171239",
    violet: "#674ee5",
    violetSoft: "#34236f",
    red: "#f02f45",
    ruby0: "#d22540",
    ruby1: "#7c1028",
    green0: "#21b862",
    green1: "#0b6137",
    white: "#f7f7fc",
    muted: "#b7b7cd",
    line: "rgba(129,111,218,.34)"
  });

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fillRound(ctx, x, y, w, h, r, fill) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function strokeRound(ctx, x, y, w, h, r, stroke, width) {
    rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.allSettled([
      document.fonts.load("900 80px 'Archivo Black'"),
      document.fonts.load("800 40px Inter"),
      document.fonts.load("600 22px Inter")
    ]);
  }

  // Supprime seulement le blanc connecté aux bords de l'image.
  // Les détails blancs enfermés dans le vrai logo restent donc intacts.
  function transparentLogoCanvas(img) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, c.width, c.height);
    const p = data.data;
    const total = c.width * c.height;
    const seen = new Uint8Array(total);
    const q = new Int32Array(total);
    let head = 0, tail = 0;
    const isBg = (i) => p[i] > 238 && p[i + 1] > 238 && p[i + 2] > 238;
    const push = (idx) => {
      if (idx < 0 || idx >= total || seen[idx]) return;
      const i = idx * 4;
      if (!isBg(i)) return;
      seen[idx] = 1;
      q[tail++] = idx;
    };
    for (let xx = 0; xx < c.width; xx++) {
      push(xx);
      push((c.height - 1) * c.width + xx);
    }
    for (let yy = 0; yy < c.height; yy++) {
      push(yy * c.width);
      push(yy * c.width + c.width - 1);
    }
    while (head < tail) {
      const idx = q[head++];
      const px = idx % c.width;
      const py = (idx / c.width) | 0;
      p[idx * 4 + 3] = 0;
      if (px > 0) push(idx - 1);
      if (px + 1 < c.width) push(idx + 1);
      if (py > 0) push(idx - c.width);
      if (py + 1 < c.height) push(idx + c.width);
    }
    x.putImageData(data, 0, 0);

    // Recadrage automatique autour du symbole réellement visible.
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let yy = 0; yy < c.height; yy++) {
      for (let xx = 0; xx < c.width; xx++) {
        if (p[(yy * c.width + xx) * 4 + 3] > 12) {
          minX = Math.min(minX, xx); minY = Math.min(minY, yy);
          maxX = Math.max(maxX, xx); maxY = Math.max(maxY, yy);
        }
      }
    }
    return { canvas: c, sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
  }

  function drawBackground(ctx) {
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, COLORS.bg0);
    base.addColorStop(.44, COLORS.bg2);
    base.addColorStop(1, COLORS.bg0);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(540, 405, 20, 540, 405, 620);
    glow.addColorStop(0, "rgba(82,55,185,.28)");
    glow.addColorStop(.48, "rgba(41,31,104,.16)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Architecture de stade très discrète, sans photo et sans grain.
    ctx.save();
    ctx.strokeStyle = "rgba(112,87,218,.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-70, 580); ctx.quadraticCurveTo(170, 425, 365, 445);
    ctx.moveTo(1115, 225); ctx.quadraticCurveTo(920, 275, 852, 490);
    ctx.stroke();
    ctx.strokeStyle = "rgba(110,95,218,.08)";
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 610 + i * 26);
      ctx.lineTo(180 + i * 8, 520 + i * 23);
      ctx.stroke();
    }
    ctx.restore();

    const vignette = ctx.createRadialGradient(540, 520, 260, 540, 520, 790);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,12,.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function centeredSegments(ctx, y, segments) {
    const widths = segments.map((s) => {
      ctx.font = s.font;
      return ctx.measureText(s.text).width;
    });
    const gap = 13;
    let x = (W - widths.reduce((a, b) => a + b, 0) - gap * (segments.length - 1)) / 2;
    segments.forEach((s, i) => {
      ctx.font = s.font;
      ctx.fillStyle = s.color;
      ctx.textAlign = "left";
      ctx.fillText(s.text, x, y);
      x += widths[i] + gap;
    });
  }

  function drawBrand(ctx, puzzleId, score) {
    // JOGADLE : A rouge discret, reste blanc.
    const font = "900 78px 'Archivo Black', Arial";
    const parts = [
      { text: "JOG", color: COLORS.white, font },
      { text: "A", color: COLORS.red, font },
      { text: "DLE", color: COLORS.white, font }
    ];
    centeredSegments(ctx, 132, parts);

    centeredSegments(ctx, 189, [
      { text: "LE JOUEUR DU JOUR", color: COLORS.white, font: "800 23px Inter, Arial" },
      { text: "•", color: COLORS.red, font: "800 23px Inter, Arial" },
      { text: "#" + puzzleId, color: COLORS.red, font: "800 23px Inter, Arial" }
    ]);

    centeredSegments(ctx, 265, [
      { text: "TROUVÉ EN", color: "#e9e9f3", font: "600 21px Inter, Arial" },
      { text: String(score), color: COLORS.white, font: "900 34px Inter, Arial" },
      { text: score > 1 ? "PROPOSITIONS" : "PROPOSITION", color: "#d7d5e5", font: "600 21px Inter, Arial" }
    ]);

    ctx.fillStyle = COLORS.red;
    ctx.fillRect(527, 279, 26, 3);
  }

  function drawResultCell(ctx, x, y, w, h, state) {
    const good = state === "correct";
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (good) {
      g.addColorStop(0, COLORS.green0);
      g.addColorStop(1, COLORS.green1);
    } else {
      g.addColorStop(0, COLORS.ruby0);
      g.addColorStop(1, COLORS.ruby1);
    }
    ctx.save();
    ctx.shadowColor = good ? "rgba(33,184,98,.16)" : "rgba(240,47,69,.15)";
    ctx.shadowBlur = 7;
    fillRound(ctx, x, y, w, h, Math.min(6, h * .22), g);
    ctx.shadowBlur = 0;
    strokeRound(ctx, x + .5, y + .5, w - 1, h - 1, Math.min(6, h * .22), good ? "rgba(82,225,142,.48)" : "rgba(255,80,101,.48)", 1);
    ctx.fillStyle = "rgba(255,255,255,.11)";
    fillRound(ctx, x + 3, y + 2, w - 6, Math.max(1, Math.min(2, h * .08)), 1, ctx.fillStyle);
    ctx.restore();
  }

  function drawGrid(ctx, rows) {
    const panel = { x: 164, y: 326, w: 752, h: 506 };
    fillRound(ctx, panel.x, panel.y, panel.w, panel.h, 16, "rgba(8,8,31,.52)");
    strokeRound(ctx, panel.x + .5, panel.y + .5, panel.w - 1, panel.h - 1, 16, "rgba(132,111,218,.38)", 1);

    const n = Math.max(1, rows.length);
    const innerX = panel.x + 64;
    const innerY = panel.y + 27;
    const innerW = panel.w - 128;
    const innerH = panel.h - 54;
    const colGap = 10;
    const cellW = (innerW - colGap * 6) / 7;
    const rowGap = n <= 8 ? 10 : n <= 14 ? 7 : n <= 22 ? 5 : 3;
    const cellH = Math.max(4, Math.min(42, (innerH - rowGap * (n - 1)) / n));
    const usedH = cellH * n + rowGap * (n - 1);
    const startY = innerY + (innerH - usedH) / 2;

    rows.forEach((row, r) => {
      const normalized = Array.from({ length: 7 }, (_, c) => row[c] === "correct" ? "correct" : "wrong");
      normalized.forEach((state, c) => {
        drawResultCell(ctx, innerX + c * (cellW + colGap), startY + r * (cellH + rowGap), cellW, cellH, state);
      });
    });
  }

  function drawLegend(ctx) {
    const y = 864;
    drawResultCell(ctx, 290, y - 17, 40, 28, "correct");
    ctx.fillStyle = "#dedfeb";
    ctx.font = "600 16px Inter, Arial";
    ctx.textAlign = "left";
    ctx.fillText("BONNE RÉPONSE", 346, y + 4);
    ctx.fillStyle = "rgba(171,166,210,.28)";
    ctx.fillRect(535, y - 17, 1, 30);
    drawResultCell(ctx, 576, y - 17, 40, 28, "wrong");
    ctx.fillStyle = "#dedfeb";
    ctx.fillText("MAUVAISE RÉPONSE", 632, y + 4);
  }

  function drawCtaBase(ctx) {
    const x = 142, y = 910, w = 796, h = 94;
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, "rgba(25,17,65,.97)");
    g.addColorStop(.58, "rgba(11,11,39,.96)");
    g.addColorStop(1, "rgba(31,16,56,.96)");
    fillRound(ctx, x, y, w, h, 14, g);
    strokeRound(ctx, x + .5, y + .5, w - 1, h - 1, 14, "rgba(121,87,255,.78)", 2);
    ctx.save();
    rr(ctx, x, y, w, h, 14); ctx.clip();
    ctx.fillStyle = "rgba(240,47,69,.25)";
    ctx.beginPath(); ctx.moveTo(875,y); ctx.lineTo(925,y); ctx.lineTo(850,y+h); ctx.lineTo(800,y+h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COLORS.red;
    ctx.beginPath(); ctx.moveTo(925,y); ctx.lineTo(950,y); ctx.lineTo(875,y+h); ctx.lineTo(850,y+h); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawFittedLogo(ctx, prepared, x, y, boxW, boxH) {
    if (!prepared || prepared.sw <= 0 || prepared.sh <= 0) return;
    const scale = Math.min(boxW / prepared.sw, boxH / prepared.sh);
    const dw = prepared.sw * scale;
    const dh = prepared.sh * scale;
    ctx.drawImage(prepared.canvas, prepared.sx, prepared.sy, prepared.sw, prepared.sh,
      x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
  }

  function drawFooterText(ctx) {
    centeredSegments(ctx, 968, [
      { text: "Jouez sur", color: COLORS.white, font: "800 27px Inter, Arial" },
      { text: "tomsofoot.fr/jeu", color: COLORS.red, font: "800 27px Inter, Arial" }
    ]);
    ctx.textAlign = "center";
    ctx.fillStyle = "#b4b4c8";
    ctx.font = "500 18px Inter, Arial";
    ctx.fillText("Partagez vos scores entre amis", W / 2, 1042);
  }

  async function render(options) {
    const rows = Array.isArray(options.rows) ? options.rows : [];
    const score = Number.isFinite(options.score) ? options.score : rows.length;
    const puzzleId = options.puzzleId == null ? "—" : options.puzzleId;
    const logoSrc = options.logoSrc || "tomsofoot-logo.png";

    await loadFonts();
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    drawBackground(ctx);
    drawBrand(ctx, puzzleId, score);
    drawGrid(ctx, rows);
    drawLegend(ctx);
    drawCtaBase(ctx);

    try {
      const logo = await loadImage(logoSrc);
      const prepared = transparentLogoCanvas(logo);
      drawFittedLogo(ctx, prepared, 165, 916, 98, 82);
    } catch (error) {
      console.warn("Jogadle : logo TomsoFoot non chargé", error);
    }
    drawFooterText(ctx);
    return canvas;
  }

  async function download(options) {
    const canvas = await render(options);
    const link = document.createElement("a");
    link.download = "jogadle-" + (options.puzzleId ?? "resultat") + ".png";
    link.href = canvas.toDataURL("image/png", 1);
    link.click();
    return canvas;
  }

  global.JogadleShareCard = Object.freeze({ render, download });
})(window);
