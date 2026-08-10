/**
 * Rendu déterministe des cartes « Le Roi des Rois ».
 * Le serveur doit confirmer la récompense avant d'appeler ce module.
 */

export const ULTIMATE_CARD_VARIANTS = Object.freeze({
  roi_asie: "assets/roi-des-rois-asie.png",
  roi_viking: "assets/roi-des-rois-viking.png",
  roi_afrique: "assets/roi-des-rois-afrique.png",
});

// Proportions du master 1023 × 1537. Zone volontairement arrêtée avant le crampon.
export const SAFE_NAME_ZONE = Object.freeze({
  x: 0.245,
  y: 0.857,
  width: 0.39,
  height: 0.06,
});

const FONT_FAMILY = '"Archivo Black", "Arial Black", sans-serif';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Impossible de charger ${src}`));
    image.src = src;
  });
}

function normalizeName(value) {
  const name = String(value ?? "").normalize("NFC").trim();
  if (!name) throw new Error("Pseudo manquant");
  return name;
}

function measureSpacedText(ctx, text, spacing) {
  let width = 0;
  for (let index = 0; index < text.length; index += 1) {
    width += ctx.measureText(text[index]).width;
    if (index < text.length - 1) width += spacing;
  }
  return width;
}

function drawSpacedText(ctx, text, centerX, baselineY, spacing) {
  const totalWidth = measureSpacedText(ctx, text, spacing);
  let cursor = centerX - totalWidth / 2;
  for (const character of text) {
    ctx.fillText(character, cursor, baselineY);
    cursor += ctx.measureText(character).width + spacing;
  }
}

function fitName(ctx, text, maxWidth, imageWidth) {
  const maximum = Math.round(imageWidth * 0.046);
  const minimum = Math.round(imageWidth * 0.017);

  for (let size = maximum; size >= minimum; size -= 1) {
    ctx.font = `900 ${size}px ${FONT_FAMILY}`;
    for (let spacing = Math.round(size * 0.08); spacing >= 0; spacing -= 0.5) {
      if (measureSpacedText(ctx, text, spacing) <= maxWidth) {
        return { size, spacing };
      }
    }
  }

  // Compatibilité avec d'anciens comptes dépassant exceptionnellement 20 caractères.
  let size = minimum;
  while (size > 8) {
    ctx.font = `900 ${size}px ${FONT_FAMILY}`;
    if (ctx.measureText(text).width <= maxWidth) return { size, spacing: 0 };
    size -= 0.5;
  }
  throw new Error("Pseudo trop long pour la carte");
}

export async function renderUltimateChampionCard({ variant, collectorName }) {
  const source = ULTIMATE_CARD_VARIANTS[variant];
  if (!source) throw new Error("Modèle de carte inconnu");

  await document.fonts?.ready;
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.drawImage(image, 0, 0);

  const zone = {
    x: SAFE_NAME_ZONE.x * canvas.width,
    y: SAFE_NAME_ZONE.y * canvas.height,
    width: SAFE_NAME_ZONE.width * canvas.width,
    height: SAFE_NAME_ZONE.height * canvas.height,
  };

  const name = normalizeName(collectorName);
  const { size, spacing } = fitName(ctx, name, zone.width, canvas.width);
  ctx.font = `900 ${size}px ${FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#170b27";
  ctx.shadowColor = "rgba(255, 245, 190, 0.42)";
  ctx.shadowBlur = Math.max(1, size * 0.08);

  drawSpacedText(ctx, name, zone.x + zone.width / 2, zone.y + zone.height / 2, spacing);
  return canvas;
}

export async function downloadUltimateChampionCard(options) {
  const canvas = await renderUltimateChampionCard(options);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Export PNG impossible")), "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `jogadle-roi-des-rois-${String(options.collectorName).trim()}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
