/* TomsoFoot — « Défie ton pote » : rendu Canvas de l'animation validée (modèle 3).

   Reprise fidèle de la référence validée (sources/scene-reference.js) : boutons bleu nuit satinés,
   chiffres blancs, six segments néon par case, épées 3D (vidéo duel-epees.mp4), traînées
   lumineuses, ondes de choc, étincelles et révélation dorée.

   Différences avec la démo :
   - toutes les données viennent du plan (defi-plan.js) : montant, cases autorisées, ordre
     d'extinction. Plus aucun « 10 PTS », « Tomso 35 » ou indice codé en dur ;
   - la scène est découpée en zones (titre, duel, grille, bandeau) dessinées chacune dans leur
     repère d'origine, puis placées selon la mise en page (portrait ou large) : on recompose au
     lieu de rétrécir la vidéo verticale ;
   - les halos (shadowBlur, non affecté par la transformation du canvas) sont remis à l'échelle,
     la densité de particules est réglable et le texte est rendu à la densité de l'écran.
   Ce module dessine seulement : aucun état de jeu, aucun appel réseau. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./defi-plan.js"));
  else root.TomsoDefiScene = factory(root.TomsoDefiPlan);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Plan) {
  "use strict";

  var clamp = function (x, a, b) { if (a === undefined) a = 0; if (b === undefined) b = 1; return Math.max(a, Math.min(b, x)); };
  var ease = function (x) { return 1 - Math.pow(1 - clamp(x), 3); };
  var FONT = "DefiSans,Arial,sans-serif";

  // Dimensions des zones dans le repère de la référence 1080 × 1920.
  var Z = {
    title: { w: 1080, h: 390 },          // origine globale y = 80 (titre centré en 540,265)
    video: { w: 1080, h: 788 },          // origine globale y = 500 (insert des épées)
    grid: { w: 1004, h: 394 },           // origine globale (38,1290)
    banner: { w: 1080, h: 400 }          // origine globale y = 380 (bandeau centré en 540,594)
  };
  var CROP_MAX = 150;                    // haut de la vidéo sans épée : recadrable si la place manque

  // Échelle des halos : shadowBlur s'exprime en pixels physiques.
  var PX = 1;
  // Tampon hors écran par contexte (masque des bords de la vidéo en mise en page large).
  var BUFFERS = typeof WeakMap !== "undefined" ? new WeakMap() : null;

  // ---------- Utilitaires de dessin (identiques à la référence) ----------
  function roundRectPath(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function rounded(ctx, x, y, w, h, r, fill) { ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
  function font(size, weight, italic) { return (italic ? "italic " : "") + weight + " " + size + "px " + FONT; }
  function text(ctx, s, x, y, size, color, weight, italic, align) {
    ctx.font = font(size, weight || 700, italic); ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = color || "#fff"; ctx.fillText(s, x, y);
  }
  function glow(ctx, x, y, r, color) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, "transparent");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function poly(ctx, points, color) {
    ctx.beginPath(); points.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function lock(ctx, x, y) {
    ctx.save(); ctx.strokeStyle = "#667785"; ctx.lineWidth = 3.25; ctx.beginPath(); ctx.arc(x, y - 5, 8, Math.PI, 0); ctx.stroke();
    rounded(ctx, x - 11, y - 5, 22, 17, 4, "#667785"); ctx.restore();
  }
  function mixColor(a, b, u) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var c = [16, 8, 0].map(function (shift) { return Math.round(((pa >> shift) & 255) * (1 - u) + ((pb >> shift) & 255) * u); });
    return "rgb(" + c.join(",") + ")";
  }
  var noise = function (n) { var v = Math.sin(n * 127.13 + 311.7) * 43758.5453; return v - Math.floor(v); };

  function impactPower(plan, t) {
    var power = 0, ticks = plan.timeline.clashes;
    for (var i = 0; i < ticks.length; i++) { var age = t - ticks[i]; if (age >= 0 && age < 0.65) power = Math.max(power, Math.exp(-age * 9)); }
    return power;
  }
  function flare(ctx, x, y, size, color, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    glow(ctx, x, y, size, color);
    var g = ctx.createLinearGradient(x - size * 2, y, x + size * 2, y);
    g.addColorStop(0, "transparent"); g.addColorStop(0.5, "#eaffff"); g.addColorStop(1, "transparent");
    ctx.fillStyle = g; ctx.fillRect(x - size * 2, y - 1.7, size * 4, 3.4);
    ctx.restore();
  }

  // ---------- Titre (repère : zone titre, centre en 540,185) ----------
  function title(ctx, t) {
    var scale = 1 + 0.035 * Math.sin(clamp(t / 0.40) * Math.PI) * (t < 0.4 ? 1 : 0);
    ctx.save(); ctx.translate(540, 185); ctx.rotate(-0.115); ctx.scale(scale, scale); ctx.transform(1, 0, -0.10, 1, 0, 0);
    ctx.font = font(154, 900, true); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    var edge = ctx.createLinearGradient(-420, -120, 420, 120); edge.addColorStop(0, "#e9ec42"); edge.addColorStop(0.5, "#73fa8b"); edge.addColorStop(1, "#2eea8f");
    ctx.shadowColor = "#61ee8b"; ctx.shadowBlur = 13 * PX; ctx.lineWidth = 5; ctx.strokeStyle = edge; ctx.strokeText("DÉFIE", 0, -75);
    ctx.shadowBlur = 0; ctx.fillStyle = "#002b3c"; ctx.fillText("DÉFIE", 0, -75);
    ctx.font = font(126, 900, true); ctx.lineWidth = 4; ctx.strokeText("TON POTE", 0, 65); ctx.fillStyle = "#f4fff7"; ctx.fillText("TON POTE", 0, 65);
    ctx.lineWidth = 2; ctx.strokeStyle = "#6df3a38c"; ctx.beginPath(); ctx.moveTo(-435, 3); ctx.lineTo(410, 3); ctx.stroke();
    poly(ctx, [[-460, -86], [-430, -111], [-403, -93], [-422, -89], [-432, -103]], "#dfe947");
    poly(ctx, [[370, 103], [407, 90], [431, 97], [404, 98]], "#4ce88d"); ctx.restore();
  }

  // ---------- Bouton néon (repère : zone grille) ----------
  function neonButton(ctx, plan, t, x, y, w, h, light, winner) {
    if (light <= 0.001) return;
    var accent = winner ? "#ffd944" : "#3dffb0";
    var pulse = 0.85 + 0.15 * Math.sin(t * 5.4), hit = impactPower(plan, t);
    ctx.save(); ctx.beginPath(); ctx.rect(x - 12, y - 12, w + 24, h + 24); ctx.clip();
    ctx.globalAlpha = light * (0.38 + hit * 0.35); ctx.strokeStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = (18 + hit * 12) * PX; ctx.lineWidth = 1.8 + hit;
    ctx.beginPath(); roundRectPath(ctx, x + 1.8, y + 1.8, w - 3.6, h - 3.6, 25); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath(); roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, 24); ctx.clip();
    ctx.globalAlpha = light * pulse;
    var wash = ctx.createLinearGradient(x, y + 45, x, y + h);
    wash.addColorStop(0, "transparent"); wash.addColorStop(1, winner ? "#ffcc343d" : "#26ffac3d");
    rounded(ctx, x, y, w, h, 26, wash);
    var phase = (t * 0.68) % 1, sx = x - w + phase * w * 3;
    var sweep = ctx.createLinearGradient(sx - 45, y, sx + 55, y + h);
    sweep.addColorStop(0, "transparent"); sweep.addColorStop(0.46, "transparent");
    sweep.addColorStop(0.55, winner ? "#ffe58932" : "#9dffdd26"); sweep.addColorStop(0.65, "transparent"); sweep.addColorStop(1, "transparent");
    ctx.fillStyle = sweep; ctx.fillRect(x, y, w, h);
    ctx.restore();
    var decidedAt = plan.timeline.clashes[2];
    if (winner && t < decidedAt + 0.64) {
      var age = t - decidedAt, fade = clamp(1 - age / 0.64);
      flare(ctx, x + w - 13, y + 10, 33 + age * 30, "#ffe978", fade * 0.85);
    }
  }

  // ---------- Effets du duel (repère : vidéo des épées, 1080 × 788) ----------
  function duelEffects(ctx, plan, t, density) {
    var ticks = plan.timeline.clashes;
    ctx.save(); ctx.beginPath(); ctx.rect(24, -25, 1032, 805); ctx.clip();
    ctx.globalCompositeOperation = "screen";
    var gold = t >= ticks[2], accent = gold ? "#ffd652" : "#48ffc1";
    var ambient = Math.round(22 * density), sparks = Math.max(12, Math.round(32 * density));
    for (var i = 0; i < ambient; i++) {
      var x = 150 + noise(i + 10) * 780, y = 750 - ((t * (35 + noise(i + 70) * 48) + noise(i + 25) * 780) % 780);
      ctx.globalAlpha = 0.13 + 0.18 * Math.pow(Math.sin(t * 2 + i), 2); ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(x, y, 1.4 + noise(i + 41) * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = "round";
    for (i = 0; i < 2; i++) {
      var angle = t * 0.8 + i * Math.PI;
      ctx.globalAlpha = 0.21; ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.shadowColor = accent; ctx.shadowBlur = 12 * PX;
      ctx.beginPath(); ctx.ellipse(540, 430, 355, 244, -0.18, angle, angle + 1.15); ctx.stroke();
      var a = angle + 1.15, px = Math.cos(a) * 355, py = Math.sin(a) * 244;
      var rx = px * Math.cos(-0.18) - py * Math.sin(-0.18), ry = px * Math.sin(-0.18) + py * Math.cos(-0.18);
      ctx.globalAlpha = 0.55; ctx.fillStyle = "#d6fff1"; ctx.beginPath(); ctx.arc(540 + rx, 430 + ry, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (var n = 0; n < ticks.length; n++) {
      var age = t - ticks[n]; if (age < -0.18 || age > 0.78) continue;
      var color = n === 2 ? "#ffd65a" : "#59ffd6";
      // Deux rubans lumineux accompagnent l'approche et le choc des lames.
      var slash = clamp((age + 0.18) / 0.18) * clamp(1 - age / 0.32);
      if (slash > 0) {
        for (var side = 0; side < 2; side++) {
          ctx.save(); if (side) { ctx.translate(1080, 0); ctx.scale(-1, 1); }
          ctx.globalAlpha = slash * 0.58; ctx.strokeStyle = color; ctx.lineWidth = 3.6;
          ctx.shadowColor = color; ctx.shadowBlur = 18 * PX;
          ctx.beginPath(); ctx.moveTo(170, 600); ctx.bezierCurveTo(180, 305, 330, 205, 540, 415); ctx.stroke();
          ctx.globalAlpha = slash * 0.14; ctx.lineWidth = 14; ctx.stroke(); ctx.restore();
        }
      }
      if (age < 0) continue;
      var life = clamp(1 - age / 0.78), radius = 34 + age * 530;
      ctx.save(); ctx.translate(540, 415);
      ctx.globalAlpha = life * 0.78; ctx.strokeStyle = color; ctx.lineWidth = 2.6;
      ctx.shadowColor = color; ctx.shadowBlur = 17 * PX;
      ctx.beginPath(); ctx.ellipse(0, 0, radius, radius * 0.54, -0.08, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = life * 0.22; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.ellipse(0, 0, radius + 16, (radius + 16) * 0.54, -0.08, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      for (var j = 0; j < sparks; j++) {
        var ang = j * 2.399 + noise(n * 100 + j) * 0.4, speed = 180 + noise(j + n * 80) * 420;
        var dist = 25 + age * speed, sx = Math.cos(ang) * dist, sy = Math.sin(ang) * dist * 0.72 + age * age * 90;
        var tail = (9 + noise(j + 111) * 30) * life;
        ctx.globalAlpha = life * (0.45 + noise(j + 69) * 0.5); ctx.strokeStyle = j % 4 ? color : "#fff7d3"; ctx.lineWidth = j % 5 ? 1.7 : 3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(ang) * tail, sy - Math.sin(ang) * tail * 0.72); ctx.stroke();
      }
      ctx.restore();
      flare(ctx, 540, 415, 110 * Math.exp(-age * 9) + 22, color, Math.exp(-age * 6));
    }
    ctx.restore();
  }

  // ---------- Révélation (repère : zone bandeau, centre en 540,214) ----------
  function revealEffects(ctx, plan, t, density) {
    var age = t - plan.timeline.reveal; if (age < 0 || age > 1.25) return;
    var life = clamp(1 - age / 1.25), count = Math.max(16, Math.round(44 * density));
    ctx.save(); ctx.beginPath(); ctx.rect(15, 30, 1050, 870); ctx.clip(); ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = life * 0.6; glow(ctx, 540, 214, 260 + age * 320, "#ffc63a70");
    ctx.strokeStyle = "#ffe480"; ctx.lineWidth = 3; ctx.shadowColor = "#ffd451"; ctx.shadowBlur = 23 * PX;
    ctx.globalAlpha = life * 0.85; ctx.beginPath(); ctx.ellipse(540, 214, 120 + age * 720, 65 + age * 370, -0.045, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    for (var i = 0; i < count; i++) {
      var a = i * 2.399, dist = 70 + age * (280 + noise(i + 163) * 420), x = 540 + Math.cos(a) * dist, y = 214 + Math.sin(a) * dist * 0.62;
      var tail = 12 + 32 * life; ctx.globalAlpha = life * (0.35 + noise(i + 219) * 0.6);
      ctx.strokeStyle = i % 4 ? "#ffe46b" : "#fffce1"; ctx.lineWidth = i % 6 ? 2 : 3.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * tail, y - Math.sin(a) * tail * 0.62); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Montant et unité d'une case ----------
  function amountText(ctx, value, bx, by, bw, color, boost) {
    var unit = value === 1 ? "PT" : "PTS";
    if (boost.unit <= 1.001 && boost.num <= 1.001) { // proportions exactes de la référence
      text(ctx, String(value), bx + bw * (value === 10 ? 0.39 : 0.43), by + 56, 68, color, 900);
      text(ctx, unit, bx + bw * (value === 10 ? 0.76 : 0.70), by + 61, 27, color, 700);
      return;
    }
    // Petit écran : chiffres et unités agrandis, groupe recentré et contenu dans la case.
    var ns = 68 * boost.num, us = 27 * boost.unit, gap = 10;
    ctx.font = font(ns, 900); var nw = ctx.measureText(String(value)).width;
    ctx.font = font(us, 700); var uw = ctx.measureText(unit).width;
    var fit = Math.min(1, (bw - 36) / (nw + gap + uw));
    ns *= fit; us *= fit; nw *= fit; uw *= fit;
    var x0 = bx + (bw - (nw + gap + uw)) / 2;
    text(ctx, String(value), x0, by + 56, ns, color, 900, false, "left");
    text(ctx, unit, x0 + nw + gap, by + 56 + ns * 0.08, us, color, 700, false, "left");
  }

  // ---------- Grille des six montants (repère : zone grille 1004 × 394) ----------
  function grid(ctx, plan, t, fx, boost) {
    rounded(ctx, 0, 0, 1004, 394, 68, "#20384dd9");
    var tl = plan.timeline, duel = t >= tl.duelStart && t < tl.clashes[2], decided = t >= tl.clashes[2];
    for (var i = 0; i < 6; i++) {
      var bx = 48 + (i % 3) * 305, by = 48 + Math.floor(i / 3) * 176, bw = 276, bh = 134;
      var eligible = plan.eligible[i], light = Plan.caseLight(plan, t, i), value = plan.choices[i];
      var finalist = duel && light > 0.001 && (i === plan.winnerIndex || i === plan.finalistIndex);
      var winner = decided && i === plan.winnerIndex;
      var face = ctx.createLinearGradient(bx, by, bx, by + bh);
      face.addColorStop(0, mixColor("#09141e", winner ? "#25352e" : "#1a3a4e", light));
      face.addColorStop(0.48, mixColor("#08121b", winner ? "#162a28" : "#102b3d", light));
      face.addColorStop(1, mixColor("#071018", "#0a1f2d", light));
      ctx.save(); ctx.shadowColor = "#00000042"; ctx.shadowBlur = 9 * PX; ctx.shadowOffsetY = 5 * PX;
      rounded(ctx, bx, by, bw, bh, 26, face); ctx.restore();
      ctx.save(); ctx.beginPath(); roundRectPath(ctx, bx + 1, by + 1, bw - 2, bh - 2, 25);
      ctx.lineWidth = winner ? 2.1 : 1.5;
      ctx.strokeStyle = mixColor("#142530", winner ? "#d9cb60" : finalist ? "#4b8a83" : "#35576b", light);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 27, by + 2); ctx.lineTo(bx + bw - 27, by + 2);
      ctx.strokeStyle = mixColor("#142530", winner ? "#e3d878" : "#557487", light);
      ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
      if (fx) neonButton(ctx, plan, t, bx, by, bw, bh, light, winner);
      var color = mixColor("#293741", "#f6f9fc", light);
      ctx.save(); if (fx) { ctx.shadowColor = winner ? "#ffe35a70" : "#57ffbd50"; ctx.shadowBlur = 8 * light * PX; }
      amountText(ctx, value, bx, by, bw, color, boost);
      ctx.restore();
      for (var k = 0; k < 6; k++) {
        var sx = bx + 29 + k * 38, sy = by + 103, power = Plan.segmentLight(plan, t, i, k);
        var c = mixColor("#20323f", winner ? (fx ? "#ffe250" : "#f4d44d") : (fx ? "#68ffbb" : "#65efad"), power);
        ctx.save();
        if (fx && power > 0.001) {
          ctx.beginPath(); ctx.rect(bx - 12, by - 12, bw + 24, bh + 24); ctx.clip();
          ctx.shadowColor = winner ? "#ffd332" : "#32ffac"; ctx.shadowBlur = (22 + impactPower(plan, t) * 12) * PX;
        }
        rounded(ctx, sx, sy, 28, 11, 2.3, c); ctx.restore();
        if (power > 0.001) { ctx.save(); ctx.globalAlpha = power * 0.44; rounded(ctx, sx + 1, sy + 0.7, 26, 2, 1, "#e9fff5"); ctx.restore(); }
      }
      if (!eligible) lock(ctx, bx + bw - 29, by + 23);
    }
  }

  // ---------- Bandeau doré (repère : zone bandeau) ----------
  function banner(ctx, plan, t) {
    var reveal = plan.timeline.reveal;
    if (t < reveal) return;
    var enter = clamp((t - reveal) / 0.18), shift = (1 - ease(enter)) * -1150;
    ctx.save(); ctx.translate(shift, -380);
    var points = [[25, 541], [1056, 411], [1056, 775], [25, 705]];
    ctx.save(); ctx.shadowColor = "#b8e83d"; ctx.shadowBlur = 23 * clamp((t - reveal) * 4) * PX; poly(ctx, points, "#ffe00b"); ctx.restore();
    ctx.save(); ctx.beginPath(); points.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.clip();
    for (var i = -2; i < 7; i++) poly(ctx, [[i * 290, 900], [i * 290 + 140, 900], [i * 290 + 540, 350], [i * 290 + 410, 350]], "#ffed5480");
    ctx.restore();
    ctx.lineWidth = 8; ctx.strokeStyle = "#132b33"; ctx.beginPath(); ctx.moveTo(25, 538); ctx.lineTo(1056, 408); ctx.moveTo(25, 707); ctx.lineTo(1056, 777); ctx.stroke();
    poly(ctx, [[26, 520], [174, 499], [222, 500], [59, 530]], "#fff0a2");
    poly(ctx, [[813, 419], [1056, 386], [1056, 399], [876, 429]], "#eada0b");
    poly(ctx, [[36, 551], [48, 570], [54, 548]], "#15313b"); poly(ctx, [[1035, 424], [1037, 443], [1024, 433]], "#15313b");
    poly(ctx, [[1026, 745], [1041, 759], [1008, 750]], "#15313b");
    ctx.save(); ctx.translate(540, 594); ctx.rotate(-0.045); ctx.transform(1, 0, -0.08, 1, 0, 0);
    text(ctx, Plan.label(plan.amount), 0, 0, 148, "#122a30", 900, true); ctx.restore();
    var age = t - reveal;
    if (age < 1.15) {
      for (i = 0; i < 15; i++) {
        var angle = i * 2.399, dist = 60 + age * (170 + i * 12), px = 540 + Math.cos(angle) * dist * 1.5, py = 590 + Math.sin(angle) * dist * 0.65;
        ctx.globalAlpha = clamp(1 - age / 1.15); poly(ctx, [[px, py], [px + 13, py + 3], [px + 25, py - 5]], i % 3 ? "#e9ee28" : "#53ed8f");
      }
    }
    ctx.restore();
  }

  function portraitLayout(W, H) {
    // Proportions exactes de la référence : titre (80→470), 30, insert (500→1288), 2, grille (1290→1684).
    var GAP_T = 30, GAP_G = 2;
    var stack = function (ts, crop) { return Z.title.h * ts + GAP_T * ts + (Z.video.h - crop) + GAP_G + Z.grid.h; };
    var full = stack(1, 0);                                  // 1604
    var s = W / 1080, avail = H / s, crop = 0, ts = 1;
    if (avail < full) {
      crop = Math.min(CROP_MAX, full - avail);               // d'abord le haut vide de la vidéo
      var still = stack(1, crop) - avail;
      if (still > 0) ts = Math.max(0.78, 1 - still / (Z.title.h + GAP_T)); // puis un titre plus compact
      if (stack(ts, crop) > avail) s = H / stack(ts, crop);  // enfin seulement, l'échelle
    }
    var contentH = stack(ts, crop) * s, spare = Math.max(0, H - contentH), x0 = (W - 1080 * s) / 2;
    var y = spare / 2;
    var titleZ = { x: x0 + 540 * s * (1 - ts), y: y, s: s * ts };
    y += (Z.title.h + GAP_T) * ts * s;
    var duelZ = { x: x0, y: y, s: s, crop: crop, visible: Z.video.h - crop };
    y += (Z.video.h - crop + GAP_G) * s;
    var gridZ = { x: x0 + 38 * s, y: y, s: s };
    // Bandeau : même rapport aux lames que la référence (haut visible de l'insert − 120).
    return { mode: "portrait", title: titleZ, duel: duelZ, grid: gridZ, banner: { x: x0, y: duelZ.y - 120 * s, s: s } };
  }
  function wideLayout(W, H) {
    var crop = 120, ts = 0.8, gapX = 40, gapY = 26;
    var rightH = Z.title.h * ts + gapY + Z.grid.h, leftH = Z.video.h - crop;
    var totalW = 1080 + gapX + 1004, totalH = Math.max(rightH, leftH);
    var s = Math.min(W / totalW, H / totalH);
    var ox = (W - totalW * s) / 2, oy = (H - totalH * s) / 2;
    var duel = { x: ox, y: oy + (totalH - leftH) / 2 * s, s: s, crop: crop, visible: leftH };
    var rx = ox + (1080 + gapX) * s, ry = oy + (totalH - rightH) / 2 * s;
    var titleZ = { x: rx + (1004 - 1080 * ts) / 2 * s, y: ry, s: s * ts };
    var gridZ = { x: rx, y: ry + (Z.title.h * ts + gapY) * s, s: s };
    var bcy = duel.y + leftH * 0.30 * s;                         // centre du bandeau sur les lames
    var banner = { x: ox, y: Math.max(-6 * s, Math.min(H - 394 * s, bcy - 214 * s)), s: s };
    return { mode: "wide", title: titleZ, duel: duel, grid: gridZ, banner: banner };
  }
  /* Mise en page : on retient la composition qui affiche la plus grande grille
     (portrait empilé comme la référence, ou large : duel à gauche, titre + grille à droite).
     La grille reste 3 × 2 partout ; seule la disposition change, jamais l'état du jeu. */
  function layout(W, H) {
    W = Math.max(1, W); H = Math.max(1, H);
    var P = portraitLayout(W, H), Wd = wideLayout(W, H);
    var L = Wd.grid.s >= P.grid.s * 0.97 ? Wd : P;
    // Lisibilité : chiffres ≥ 18 px et unités ≥ 11 px à l'écran, quelle que soit la largeur.
    var gs = L.grid.s;
    L.boost = { num: clamp(18 / (68 * gs), 1, 1.25), unit: clamp(11 / (27 * gs), 1, 1.65) };
    L.width = W; L.height = H;
    return L;
  }

  // Rectangle CSS d'une case (pour les tests et l'accessibilité).
  function cellRect(L, index) {
    var g = L.grid, bx = 48 + (index % 3) * 305, by = 48 + Math.floor(index / 3) * 176;
    return { x: g.x + bx * g.s, y: g.y + by * g.s, w: 276 * g.s, h: 134 * g.s, segY: g.y + (by + 108.5) * g.s, segX: function (k) { return g.x + (bx + 29 + k * 38 + 14) * g.s; } };
  }

  function zone(ctx, z, dpr) {
    ctx.setTransform(z.s * dpr, 0, 0, z.s * dpr, z.x * dpr, z.y * dpr);
    PX = z.s * dpr;
  }

  /* Dessine l'image à l'instant t.
     o = { plan, layout, video (HTMLVideoElement/Canvas, facultatif), dpr, density (0,4–1), effects } */
  function render(ctx, t, o) {
    var plan = o.plan, L = o.layout, dpr = o.dpr || 1, fx = o.effects !== false, density = clamp(o.density == null ? 1 : o.density, 0.3, 1);
    t = clamp(t, 0, plan.timeline.duration);
    var W = L.width * dpr, H = L.height * dpr, d = L.duel;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    // Fond : même dégradé que la référence, centré sur le duel.
    var cx = (d.x + 540 * d.s) * dpr, cy = (d.y + (530 - d.crop) * d.s) * dpr, R = Math.max(W, H, 1230 * d.s * dpr);
    var bg = ctx.createRadialGradient(cx, cy, 5 * dpr, cx, cy - 30 * d.s * dpr, R);
    bg.addColorStop(0, "#0066aa"); bg.addColorStop(0.36, "#003552"); bg.addColorStop(0.75, "#00121e"); bg.addColorStop(1, "#00050b");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Portrait : comme la référence, tout le haut (titre) repose sur l'aplat #001725.
    if (L.mode === "portrait") { ctx.fillStyle = "#001725"; ctx.fillRect(0, 0, W, Math.ceil(d.y * dpr)); }
    // Duel : insert vidéo des épées, recadré (d.y = haut visible = ligne d.crop de la vidéo).
    zone(ctx, { x: d.x, y: d.y - d.crop * d.s, s: d.s }, dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(0, d.crop, 1080, d.visible); ctx.clip();
    var v = o.video, ready = v && (v.readyState === undefined || v.readyState >= 2);
    if (ready && L.mode === "wide") {
      // Large : bords de l'insert fondus par masque alpha (aucun cadre visible sur le fond).
      var k = d.s * dpr, ow = Math.ceil(1080 * k), oh = Math.ceil(d.visible * k);
      var off = BUFFERS ? BUFFERS.get(ctx) : null;
      if (!off && typeof document !== "undefined") { off = document.createElement("canvas"); if (BUFFERS) BUFFERS.set(ctx, off); }
      if (off) {
        if (off.width !== ow || off.height !== oh) { off.width = ow; off.height = oh; }
        var oc = off.getContext("2d");
        oc.setTransform(1, 0, 0, 1, 0, 0); oc.globalCompositeOperation = "source-over"; oc.clearRect(0, 0, ow, oh);
        try { oc.drawImage(v, 0, d.crop / 788 * (v.videoHeight || 788), (v.videoWidth || 1080), d.visible / 788 * (v.videoHeight || 788), 0, 0, ow, oh); } catch (e) { /* */ }
        oc.globalCompositeOperation = "destination-in";
        var mh = oc.createLinearGradient(0, 0, ow, 0);
        mh.addColorStop(0, "rgba(0,0,0,0)"); mh.addColorStop(0.22, "#000"); mh.addColorStop(0.78, "#000"); mh.addColorStop(1, "rgba(0,0,0,0)");
        oc.fillStyle = mh; oc.fillRect(0, 0, ow, oh);
        var mv = oc.createLinearGradient(0, 0, 0, oh);
        mv.addColorStop(0, "rgba(0,0,0,0)"); mv.addColorStop(0.12, "#000"); mv.addColorStop(0.97, "#000"); mv.addColorStop(1, "rgba(0,0,0,0)");
        oc.fillStyle = mv; oc.fillRect(0, 0, ow, oh);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, Math.round(d.x * dpr), Math.round(d.y * dpr)); ctx.restore();
      }
    } else if (ready) {
      try { ctx.drawImage(v, 0, 0, 1080, 788); } catch (e) { /* image non décodable : fond seul */ }
      var top = ctx.createLinearGradient(0, d.crop, 0, d.crop + 70); top.addColorStop(0, "#001725"); top.addColorStop(1, "#00172500");
      ctx.fillStyle = top; ctx.fillRect(0, d.crop, 1080, 70);
    }
    if (fx) duelEffects(ctx, plan, t, density);
    ctx.restore();

    zone(ctx, L.title, dpr); title(ctx, t);
    zone(ctx, L.grid, dpr); grid(ctx, plan, t, fx, L.boost);
    zone(ctx, L.banner, dpr);
    if (fx) revealEffects(ctx, plan, t, density);
    banner(ctx, plan, t);
    ctx.restore();
    PX = 1;
  }

  return { layout: layout, render: render, cellRect: cellRect, ZONES: Z };
});
