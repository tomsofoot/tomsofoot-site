/* ================================================================
   JOGADLE — Générateur PNG premium 1080 x 1080 (identité bleu roi)
   Visuel uniquement : aucune règle de tirage n'est modifiée, aucune cible n'est calculée ici.

   Le générateur n'accepte QUE des états déjà renvoyés par le serveur (matchStates est calculé
   côté serveur ; le client ne connaît jamais la cible). `rows` = lignes de 7 "correct" | "wrong".

   await JogadleShareCard.download({
     puzzleId, score, points,
     rows: state.guesses.map(g => g.states.map(s => s.state)),
     logoSrc: "assets/tomsofoot-logo.png",
     qrSrc:   "assets/qr-jeu.png",
     markSrc: "assets/coq-watermark.png"
   });
   ================================================================ */
(function (global) {
  "use strict";

  const W = 1080, H = 1080;
  const COLORS = Object.freeze({
    bg0: "#03081a", bg2: "#0c2c63",
    blue: "#2e6be0", blueDeep: "#0a4eb8",
    red: "#f02f45",
    ruby0: "#d22540", ruby1: "#7c1028",
    green0: "#21b862", green1: "#0b6137",
    gold0: "#ffd76a", gold1: "#e0a325",
    white: "#f7f9ff", muted: "#a9bbe0"
  });

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function fillRound(ctx, x, y, w, h, r, fill) { rr(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
  function strokeRound(ctx, x, y, w, h, r, stroke, width) { rr(ctx, x, y, w, h, r); ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }

  function loadImage(src) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
  }
  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.allSettled([
      document.fonts.load("900 80px 'Archivo Black'"),
      document.fonts.load("900 34px Inter"), document.fonts.load("800 22px Inter"), document.fonts.load("600 18px Inter")
    ]);
  }
  function star(ctx, cx, cy, r, fill) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / 5, a2 = a + Math.PI / 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a2) * r * 0.45, cy + Math.sin(a2) * r * 0.45);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function frDate(d) {
    try { let s = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }); return s.charAt(0).toUpperCase() + s.slice(1); }
    catch (_) { return ""; }
  }
  function rankFor(score) {
    if (score <= 1) return { label: "IMPARABLE", stars: 3 };
    if (score <= 2) return { label: "MAÎTRE", stars: 3 };
    if (score <= 4) return { label: "EXPERT", stars: 3 };
    if (score <= 6) return { label: "SOLIDE", stars: 2 };
    if (score <= 9) return { label: "BIEN JOUÉ", stars: 2 };
    if (score <= 14) return { label: "TENACE", stars: 1 };
    return { label: "TROUVÉ", stars: 1 };
  }
  function centeredSegments(ctx, y, segments, gap) {
    gap = gap == null ? 13 : gap;
    const widths = segments.map((s) => { ctx.font = s.font; return ctx.measureText(s.text).width; });
    let x = (W - widths.reduce((a, b) => a + b, 0) - gap * (segments.length - 1)) / 2;
    segments.forEach((s, i) => { ctx.font = s.font; ctx.fillStyle = s.color; ctx.textAlign = "left"; ctx.fillText(s.text, x, y); x += widths[i] + gap; });
  }

  function drawBackground(ctx, watermark) {
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, COLORS.bg0); base.addColorStop(.46, COLORS.bg2); base.addColorStop(1, COLORS.bg0);
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(540, 360, 20, 540, 360, 660);
    glow.addColorStop(0, "rgba(30,95,220,.30)"); glow.addColorStop(.48, "rgba(15,55,150,.15)"); glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // Filigrane coq (silhouette blanche, très discret).
    if (watermark) {
      ctx.save(); ctx.globalAlpha = 0.05;
      const iw = watermark.naturalWidth || watermark.width, ih = watermark.naturalHeight || watermark.height;
      const dw = 760, dh = dw * ih / iw;
      ctx.drawImage(watermark, W - dw + 150, H - dh + 40, dw, dh);
      ctx.restore();
    }
    const vignette = ctx.createRadialGradient(540, 520, 260, 540, 520, 800);
    vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,3,14,.66)");
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  }

  function drawHeader(ctx, puzzleId) {
    const font = "900 74px 'Archivo Black', Arial";
    centeredSegments(ctx, 116, [
      { text: "JOG", color: COLORS.white, font }, { text: "A", color: COLORS.red, font }, { text: "DLE", color: COLORS.white, font }
    ]);
    centeredSegments(ctx, 162, [
      { text: "LE JOUEUR DU JOUR", color: COLORS.white, font: "800 21px Inter, Arial" },
      { text: "•", color: COLORS.blue, font: "800 21px Inter, Arial" },
      { text: "#" + puzzleId, color: COLORS.blue, font: "800 21px Inter, Arial" },
      { text: "•", color: COLORS.blue, font: "800 21px Inter, Arial" },
      { text: frDate(new Date()), color: "#cdd9f4", font: "700 21px Inter, Arial" }
    ], 11);
  }

  function drawMedal(ctx, cy, rank) {
    const label = rank.label;
    ctx.font = "900 27px Inter, Arial";
    const labW = ctx.measureText(label).width;
    const medalR = 23, starR = 11, starGap = 6, gapA = 16, gapB = 18;
    const starsW = 3 * (starR * 2) + 2 * starGap;
    const totalW = medalR * 2 + gapA + labW + gapB + starsW;
    let x = (W - totalW) / 2;
    // médaille
    const cx = x + medalR;
    const g = ctx.createLinearGradient(cx, cy - medalR, cx, cy + medalR);
    g.addColorStop(0, COLORS.gold0); g.addColorStop(1, COLORS.gold1);
    ctx.beginPath(); ctx.arc(cx, cy, medalR, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.stroke();
    star(ctx, cx, cy, medalR * 0.56, "#5a3d05");
    x += medalR * 2 + gapA;
    // label
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "900 27px Inter, Arial"; ctx.fillStyle = COLORS.white;
    ctx.fillText(label, x, cy + 1);
    x += labW + gapB;
    // étoiles
    for (let i = 0; i < 3; i++) { star(ctx, x + starR + i * (starR * 2 + starGap), cy, starR, i < rank.stars ? COLORS.gold0 : "rgba(160,180,225,.32)"); }
    ctx.textBaseline = "alphabetic";
  }

  function drawStatChips(ctx, y, chips) {
    const h = 46, padX = 22, gap = 16;
    ctx.font = "900 26px Inter, Arial"; const valW = chips.map(c => ctx.measureText(c.value).width);
    ctx.font = "800 15px Inter, Arial"; const labW = chips.map(c => ctx.measureText(c.label).width);
    const widths = chips.map((c, i) => valW[i] + 10 + labW[i] + padX * 2);
    let x = (W - widths.reduce((a, b) => a + b, 0) - gap * (chips.length - 1)) / 2;
    chips.forEach((c, i) => {
      const w = widths[i];
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, "rgba(30,95,220,.30)"); grad.addColorStop(1, "rgba(12,44,110,.30)");
      fillRound(ctx, x, y, w, h, 12, grad);
      strokeRound(ctx, x + .5, y + .5, w - 1, h - 1, 12, "rgba(80,135,235,.55)", 1.5);
      let tx = x + padX; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.font = "900 26px Inter, Arial"; ctx.fillStyle = COLORS.white; ctx.fillText(c.value, tx, y + h / 2 + 1);
      tx += valW[i] + 10;
      ctx.font = "800 15px Inter, Arial"; ctx.fillStyle = "#9fb6e6"; ctx.fillText(c.label, tx, y + h / 2 + 1);
      ctx.textBaseline = "alphabetic"; x += w + gap;
    });
  }

  function drawCell(ctx, x, y, w, h, good) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (good) { g.addColorStop(0, COLORS.green0); g.addColorStop(1, COLORS.green1); } else { g.addColorStop(0, COLORS.ruby0); g.addColorStop(1, COLORS.ruby1); }
    ctx.save();
    ctx.shadowColor = good ? "rgba(33,184,98,.16)" : "rgba(240,47,69,.15)"; ctx.shadowBlur = 7;
    fillRound(ctx, x, y, w, h, Math.min(6, h * .22), g); ctx.shadowBlur = 0;
    strokeRound(ctx, x + .5, y + .5, w - 1, h - 1, Math.min(6, h * .22), good ? "rgba(82,225,142,.48)" : "rgba(255,80,101,.48)", 1);
    ctx.fillStyle = "rgba(255,255,255,.11)"; fillRound(ctx, x + 3, y + 2, w - 6, Math.max(1, Math.min(2, h * .08)), 1, ctx.fillStyle);
    if (h >= 17) {
      ctx.fillStyle = "rgba(255,255,255,.94)"; ctx.font = "900 " + Math.round(h * 0.56) + "px Inter, Arial";
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(good ? "✓" : "✗", x + w / 2, y + h / 2 + 1); ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }

  // Seuil au-delà duquel on résume : on garde les 5 derniers essais en grand.
  const CONDENSE_FROM = 10, TAIL = 5;

  function drawGrid(ctx, rows) {
    const panel = { x: 164, y: 322, w: 752, h: 430 };
    fillRound(ctx, panel.x, panel.y, panel.w, panel.h, 16, "rgba(6,12,34,.52)");
    strokeRound(ctx, panel.x + .5, panel.y + .5, panel.w - 1, panel.h - 1, 16, "rgba(80,130,225,.40)", 1);
    const n = Math.max(1, rows.length);
    const innerX = panel.x + 62, innerY = panel.y + 26, innerW = panel.w - 124, innerH = panel.h - 52;
    const colGap = 10, cellW = (innerW - colGap * 6) / 7;

    if (n >= CONDENSE_FROM) { drawGridCondensed(ctx, rows, panel, innerX, innerY, innerW, innerH, cellW, colGap); return; }

    const rowGap = n <= 8 ? 10 : 7;
    const cellH = Math.max(4, Math.min(40, (innerH - rowGap * (n - 1)) / n));
    const usedH = cellH * n + rowGap * (n - 1);
    const startY = innerY + (innerH - usedH) / 2;
    rows.forEach((row, r) => {
      const rowY = startY + r * (cellH + rowGap);
      drawRowNumber(ctx, panel.x + 33, rowY + cellH / 2, r + 1, cellH);
      for (let c = 0; c < 7; c++) drawCell(ctx, innerX + c * (cellW + colGap), rowY, cellW, cellH, row[c] === "correct");
    });
  }

  function drawRowNumber(ctx, cx, cy, num, cellH) {
    if (cellH < 16) return;
    ctx.fillStyle = "rgba(159,182,230,.85)"; ctx.font = "800 " + Math.round(Math.min(cellH * 0.6, 18)) + "px Inter, Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(num), cx, cy); ctx.textBaseline = "alphabetic";
  }

  // Découpe 1..earlyN en blocs (pas de 10, style « 1 à 10 / 10 à 20 / 20 à 25 »).
  function earlyRanges(earlyN) {
    const bounds = [];
    for (let b = 0; b < earlyN; b += 10) bounds.push(b);
    bounds.push(earlyN);
    // Fusionne un dernier bloc trop court (≤ 2) avec le précédent.
    if (bounds.length >= 3 && (bounds[bounds.length - 1] - bounds[bounds.length - 2]) <= 2) bounds.splice(bounds.length - 2, 1);
    const ranges = [];
    for (let i = 0; i < bounds.length - 1; i++) ranges.push([bounds[i] === 0 ? 1 : bounds[i], bounds[i + 1]]);
    return ranges;
  }

  // Pastille bleue « lo à hi ✗ » (bloc d'essais résumé).
  function drawRangeChip(ctx, x, y, w, h, label) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#1c62d4"); g.addColorStop(1, COLORS.blueDeep);
    fillRound(ctx, x, y, w, h, h / 2, g);
    strokeRound(ctx, x + .5, y + .5, w - 1, h - 1, h / 2, "rgba(120,170,250,.55)", 1.5);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "900 23px Inter, Arial"; ctx.fillStyle = COLORS.white;
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, x + CHIP_PADX, y + h / 2 + 1);
    ctx.font = "900 26px Inter, Arial"; ctx.fillStyle = COLORS.red;
    ctx.fillText("✗", x + CHIP_PADX + tw + 12, y + h / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }
  const CHIP_PADX = 22;
  function chipWidth(ctx, label) {
    ctx.font = "900 23px Inter, Arial"; const tw = ctx.measureText(label).width;
    ctx.font = "900 26px Inter, Arial"; const xw = ctx.measureText("✗").width;
    return CHIP_PADX + tw + 12 + xw + CHIP_PADX;
  }

  function drawGridCondensed(ctx, rows, panel, innerX, innerY, innerW, innerH, cellW, colGap) {
    const n = rows.length, earlyN = n - TAIL;
    const lastGap = 9, lastCellH = 40, dividerH = 30;
    const lastZoneH = TAIL * lastCellH + (TAIL - 1) * lastGap;
    const chipZoneTop = innerY, chipZoneH = innerH - lastZoneH - dividerH;

    // --- Zone haute : pastilles de blocs (essais 1 .. earlyN) ---
    const ranges = earlyRanges(earlyN);
    const chipH = 46, xGap = 12, lineGap = 12;
    const labels = ranges.map(r => r[0] + " à " + r[1]);
    const widths = labels.map(l => chipWidth(ctx, l));
    // Répartition en lignes qui tiennent dans innerW.
    const lines = []; let cur = [], curW = 0;
    ranges.forEach((_, i) => {
      const add = widths[i] + (cur.length ? xGap : 0);
      if (cur.length && curW + add > innerW) { lines.push({ items: cur.slice(), w: curW }); cur = []; curW = 0; }
      cur.push(i); curW += widths[i] + (cur.length > 1 ? xGap : 0);
    });
    if (cur.length) lines.push({ items: cur, w: curW });
    const blockH = lines.length * chipH + (lines.length - 1) * lineGap;
    let ly = chipZoneTop + (chipZoneH - blockH) / 2;
    lines.forEach(line => {
      let lx = innerX + (innerW - line.w) / 2;
      line.items.forEach(i => { drawRangeChip(ctx, lx, ly, widths[i], chipH, labels[i]); lx += widths[i] + xGap; });
      ly += chipH + lineGap;
    });

    // --- Séparateur avec libellé ---
    const divY = chipZoneTop + chipZoneH + dividerH / 2;
    ctx.strokeStyle = "rgba(120,150,215,.28)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(innerX, divY); ctx.lineTo(innerX + innerW, divY); ctx.stroke();
    const lab = TAIL + " DERNIERS ESSAIS";
    ctx.font = "900 14px Inter, Arial"; const lw = ctx.measureText(lab).width;
    fillRound(ctx, panel.x + panel.w / 2 - lw / 2 - 12, divY - 12, lw + 24, 24, 12, "rgba(6,12,34,.92)");
    ctx.fillStyle = "#9fb6e6"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(lab, panel.x + panel.w / 2, divY + 1); ctx.textBaseline = "alphabetic";

    // --- Zone basse : 5 derniers essais en grand ---
    const lastTop = chipZoneTop + chipZoneH + dividerH;
    for (let i = 0; i < TAIL; i++) {
      const realIdx = earlyN + i, rowY = lastTop + i * (lastCellH + lastGap);
      drawRowNumber(ctx, panel.x + 33, rowY + lastCellH / 2, realIdx + 1, lastCellH);
      for (let c = 0; c < 7; c++) drawCell(ctx, innerX + c * (cellW + colGap), rowY, cellW, lastCellH, rows[realIdx][c] === "correct");
    }
  }

  function drawLegend(ctx, y) {
    drawCell(ctx, 300, y - 17, 40, 28, true);
    ctx.fillStyle = "#dfe6f6"; ctx.font = "600 16px Inter, Arial"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("BONNE RÉPONSE", 356, y + 4);
    ctx.fillStyle = "rgba(150,170,220,.30)"; ctx.fillRect(548, y - 17, 1, 30);
    drawCell(ctx, 590, y - 17, 40, 28, false);
    ctx.fillStyle = "#dfe6f6"; ctx.fillText("MAUVAISE RÉPONSE", 646, y + 4);
  }

  function drawCtaBase(ctx, x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, "rgba(10,44,105,.97)"); g.addColorStop(.58, "rgba(6,18,52,.96)"); g.addColorStop(1, "rgba(12,38,92,.96)");
    fillRound(ctx, x, y, w, h, 16, g);
    strokeRound(ctx, x + .5, y + .5, w - 1, h - 1, 16, "rgba(80,140,240,.80)", 2);
    ctx.save(); rr(ctx, x, y, w, h, 16); ctx.clip();
    ctx.fillStyle = "rgba(240,47,69,.9)"; ctx.beginPath(); ctx.moveTo(x + w - 30, y); ctx.lineTo(x + w - 8, y); ctx.lineTo(x + w - 30, y + h); ctx.lineTo(x + w - 52, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(46,107,224,.9)"; ctx.beginPath(); ctx.moveTo(x + w - 8, y); ctx.lineTo(x + w + 12, y); ctx.lineTo(x + w - 10, y + h); ctx.lineTo(x + w - 30, y + h); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawFittedImage(ctx, img, x, y, boxW, boxH) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height; if (!iw || !ih) return;
    const scale = Math.min(boxW / iw, boxH / ih), dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
  }

  // ---- Icônes réseaux (monochrome blanc) ----
  function icoYouTube(ctx, x, y, s) { fillRound(ctx, x, y + s * .2, s, s * .6, s * .18, "#fff"); ctx.fillStyle = COLORS.blueDeep; ctx.beginPath(); ctx.moveTo(x + s * .4, y + s * .36); ctx.lineTo(x + s * .4, y + s * .64); ctx.lineTo(x + s * .64, y + s * .5); ctx.closePath(); ctx.fill(); }
  function icoInsta(ctx, x, y, s) { ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineWidth = s * .085; rr(ctx, x + s * .12, y + s * .12, s * .76, s * .76, s * .24); ctx.stroke(); ctx.beginPath(); ctx.arc(x + s * .5, y + s * .5, s * .18, 0, 7); ctx.stroke(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + s * .72, y + s * .28, s * .045, 0, 7); ctx.fill(); ctx.restore(); }
  function icoX(ctx, x, y, s) { ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineWidth = s * .12; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x + s * .22, y + s * .22); ctx.lineTo(x + s * .78, y + s * .78); ctx.moveTo(x + s * .78, y + s * .22); ctx.lineTo(x + s * .22, y + s * .78); ctx.stroke(); ctx.restore(); }
  function icoTikTok(ctx, x, y, s) { ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineWidth = s * .1; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x + s * .44, y + s * .18); ctx.lineTo(x + s * .44, y + s * .64); ctx.stroke(); ctx.beginPath(); ctx.arc(x + s * .35, y + s * .66, s * .12, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + s * .44, y + s * .18); ctx.quadraticCurveTo(x + s * .68, y + s * .22, x + s * .7, y + s * .4); ctx.stroke(); ctx.restore(); }

  function drawSocial(ctx, y) {
    const s = 30, gap = 16;
    const items = [
      { draw: icoYouTube, h: "@Tomso-Foot" }, { draw: icoInsta, h: "@tomso_foot" },
      { draw: icoX, h: "@tomsofoot" }, { draw: icoTikTok, h: "@tomsofoot" }
    ];
    ctx.font = "800 17px Inter, Arial";
    const hw = items.map(it => ctx.measureText(it.h).width);
    const unit = items.map((it, i) => s + 8 + hw[i]);
    const total = unit.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    let x = (W - total) / 2;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    items.forEach((it, i) => {
      it.draw(ctx, x, y - s / 2, s);
      ctx.font = "800 17px Inter, Arial"; ctx.fillStyle = COLORS.white; ctx.fillText(it.h, x + s + 8, y + 1);
      x += unit[i] + gap;
    });
    ctx.textBaseline = "alphabetic";
  }

  async function render(options) {
    const rows = Array.isArray(options.rows) ? options.rows : [];
    const score = Number.isFinite(options.score) ? options.score : rows.length;
    const points = (options.points == null || !isFinite(options.points)) ? null : options.points;
    const puzzleId = options.puzzleId == null ? "—" : options.puzzleId;

    await loadFonts();
    let watermark = null, logo = null, qr = null;
    try { watermark = await loadImage(options.markSrc || "assets/coq-watermark.png"); } catch (e) {}
    try { logo = await loadImage(options.logoSrc || "assets/tomsofoot-logo.png"); } catch (e) {}
    try { qr = await loadImage(options.qrSrc || "assets/qr-jeu.png"); } catch (e) {}

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    drawBackground(ctx, watermark);
    drawHeader(ctx, puzzleId);
    drawMedal(ctx, 208, rankFor(score));
    const chips = [{ label: score > 1 ? "PROPOSITIONS" : "PROPOSITION", value: String(score) }];
    if (points != null) chips.push({ label: "POINTS", value: String(points) });
    drawStatChips(ctx, 248, chips);
    drawGrid(ctx, rows);
    drawLegend(ctx, 786);

    // Bandeau bas : logo + accroche + QR brandé
    const bx = 142, by = 820, bw = 796, bh = 108;
    drawCtaBase(ctx, bx, by, bw, bh);
    if (logo) drawFittedImage(ctx, logo, bx + 16, by + 12, bh - 24, bh - 24);
    let qrLeft = bx + bw - 20;
    if (qr) {
      const qs = bh - 24, qx = bx + bw - qs - 34, qy = by + 12;
      fillRound(ctx, qx - 6, qy - 6, qs + 12, qs + 12, 10, "#ffffff");
      drawFittedImage(ctx, qr, qx, qy, qs, qs);
      qrLeft = qx - 12;
    }
    const tl = bx + (bh - 24) + 26, tc = (tl + qrLeft) / 2;
    ctx.textAlign = "center";
    ctx.font = "800 27px Inter, Arial";
    const a = "Joue sur ", b = "tomsofoot.fr/jeu";
    const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width, ts = tc - (wa + wb) / 2;
    ctx.textAlign = "left"; ctx.fillStyle = COLORS.white; ctx.fillText(a, ts, by + 46);
    ctx.fillStyle = COLORS.blue; ctx.fillText(b, ts + wa, by + 46);
    ctx.textAlign = "center"; ctx.font = "800 19px Inter, Arial"; ctx.fillStyle = "#cdd9f4";
    ctx.fillText("Sauras-tu faire mieux ?", tc, by + 78);

    drawSocial(ctx, 976);
    ctx.textAlign = "center"; ctx.fillStyle = "#8494bd"; ctx.font = "500 15px Inter, Arial";
    ctx.fillText("Partagez vos scores entre amis", W / 2, 1018);
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
