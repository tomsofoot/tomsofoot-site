/* Jogadle — animation premium « Impulsion & Élévation »
   Couche visuelle indépendante : aucune donnée et aucune règle de jeu ici. */
(function () {
  "use strict";

  const SETTINGS = Object.freeze({
    chargeMs: 360,
    staggerMs: 110,
    settleMs: 820
  });

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function createEnergyTrack(row) {
    const track = document.createElement("span");
    track.className = "jogadle-energy-track";
    track.setAttribute("aria-hidden", "true");
    track.innerHTML = '<span class="jogadle-energy-pulse"></span>';
    row.appendChild(track);
    return track;
  }

  async function play(row) {
    if (!(row instanceof HTMLElement)) return;

    const cells = Array.from(row.querySelectorAll(".flip-cell"));
    if (!cells.length) return;

    row.classList.remove("revealing");
    row.classList.add("premium-reveal", "premium-running");

    if (prefersReducedMotion()) {
      cells.forEach((cell) => cell.classList.add("premium-done"));
      row.classList.remove("premium-running");
      row.classList.add("premium-complete");
      return;
    }

    const track = createEnergyTrack(row);
    requestAnimationFrame(() => row.classList.add("premium-track-live"));

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      cell.style.setProperty("--premium-index", String(index));
      cell.classList.add("premium-charging");
      await wait(SETTINGS.chargeMs);
      cell.classList.remove("premium-charging");
      cell.classList.add("premium-active");
      await wait(SETTINGS.staggerMs);
    }

    await wait(SETTINGS.settleMs);

    cells.forEach((cell) => {
      cell.classList.remove("premium-active", "premium-charging");
      cell.classList.add("premium-done");
    });

    row.classList.remove("premium-running", "premium-track-live");
    row.classList.add("premium-complete");
    track.classList.add("is-fading");
    window.setTimeout(() => track.remove(), 450);
  }

  window.JogadleAnimation = Object.freeze({ play });
})();
