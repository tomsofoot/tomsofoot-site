/* Jogadle — moteur autonome (portage vanilla du prototype React).
   Devine le footballeur mystère du jour. Aucune dépendance externe. */
(function () {
  "use strict";
  const root = document.querySelector(".jogadle");
  const PLAYERS = window.JOGADLE_PLAYERS;
  if (!root || !Array.isArray(PLAYERS) || !PLAYERS.length) return;

  const DAY_MS = 86400000;
  const REVEAL_MS = 3100; // durée totale de la révélation (7 cases x 350 ms + marge)

  // ---------- Utilitaires ----------
  function dayNumber() {
    const parts = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return Math.floor(Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day)) / DAY_MS);
  }
  function getAge(birthDate) {
    const b = new Date(birthDate + "T00:00:00");
    const t = new Date();
    let age = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
    return age;
  }
  function normalize(value) {
    return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ø/g, "o").replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ł/g, "l")
      .replace(/[đð]/g, "d").replace(/þ/g, "th").replace(/ß/g, "ss").replace(/[\s'’`.\-]+/g, "");
  }
  function firstName(player) {
    const parts = player.name.trim().split(/\s+/);
    return parts.length > 1 ? parts[0] : "";
  }
  function positionFamily(position) {
    if (position.includes("Ailier") || position.includes("Avant-centre") || position.toLowerCase().includes("attaquant")) return "attaque";
    if (position.includes("Milieu")) return "milieu";
    if (position.includes("Défenseur") || position.includes("Arrière")) return "défense";
    return position;
  }
  function matchStates(player, target) {
    const ageGap = Math.abs(getAge(player.birthDate) - getAge(target.birthDate));
    const numberGap = player.number == null || target.number == null ? null : Math.abs(player.number - target.number);
    return [
      player.confederation === target.confederation ? "correct" : "wrong",
      player.club === target.club ? "correct" : "wrong",
      player.league === target.league ? "correct" : "wrong",
      player.country === target.country ? "correct" : "wrong",
      player.position === target.position ? "correct" : "wrong",
      ageGap === 0 ? "correct" : "wrong",
      numberGap === 0 ? "correct" : "wrong",
    ];
  }
  function getStored(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }
  function setStored(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  }

  // ---------- Sélection déterministe du joueur du jour ----------
  // Mélange fixe (seed constant) pour éviter que les joueurs d'un même club
  // se suivent jour après jour, tout en restant reproductible pour les stats.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Pool des joueurs TIRABLES comme réponse du jour : restreint par la rareté du club
  // (champ `eligible` calculé au build selon l'étoile). Tout le reste — recherche,
  // comparaison, autocomplétion — continue d'utiliser PLAYERS en entier.
  // Repli : si aucun joueur n'est marqué eligible (ancienne base sans étoiles), tout est tirable.
  // Pool « facile » : joueurs bien connus uniquement (eligible + valeur marchande elevee).
  // Repli progressif si le seuil vide le pool : eligible seuls, puis tous les joueurs.
  const EASY_MIN_VALUE = 40000000; // seuil de notoriete (valeur marchande) pour le joueur du jour
  const ELIGIBLE = PLAYERS.filter((p) => p.eligible);
  const EASY = ELIGIBLE.filter((p) => (p.marketValue || 0) >= EASY_MIN_VALUE);
  const POOL = EASY.length ? EASY : (ELIGIBLE.length ? ELIGIBLE : PLAYERS);
  const ORDER = POOL.map((_, i) => i);
  (function shuffle() {
    const rand = mulberry32(0x7031d1e);
    for (let i = ORDER.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = ORDER[i]; ORDER[i] = ORDER[j]; ORDER[j] = tmp;
    }
  })();
  function targetForPuzzle(id) {
    const n = POOL.length;
    return POOL[ORDER[((id % n) + n) % n]];
  }

  // ---------- État ----------
  // Configuration facultative (version d'essai) : window.JOGADLE_CONFIG
  //   forceTargetId : force le joueur à trouver (ex. "corentin-tolisso")
  //   buildId       : identifiant de build → réinitialise la partie à chaque mise à jour
  const CFG = window.JOGADLE_CONFIG || {};
  const puzzleId = dayNumber();
  const forced = CFG.forceTargetId ? PLAYERS.find((p) => p.id === CFG.forceTargetId) : null;
  const target = forced || targetForPuzzle(puzzleId);
  const storageKey = "jogadle-v2-" + (CFG.buildId ? "essai-" + CFG.buildId : puzzleId);
  let guesses = [];
  let revealing = false;

  // ---------- Références DOM ----------
  const el = {
    puzzle: root.querySelector("#td-puzzle"),
    count: root.querySelector("#td-count"),
    search: root.querySelector("#td-search"),
    field: root.querySelector("#td-field"),
    input: root.querySelector("#td-input"),
    sugg: root.querySelector("#td-suggestions"),
    boardArea: root.querySelector("#td-board-area"),
    end: root.querySelector("#td-end"),
    modal: root.querySelector("#td-modal"),
    modalBody: root.querySelector("#td-modal-body"),
    modalClose: root.querySelector("#td-modal .modal-close"),
    toast: root.querySelector("#td-toast"),
  };

  const HEAD = ["Joueur", "Confédération", "Club", "Ligue", "Nation", "Poste", "Âge", "N°"];

  function won() { return guesses.some((g) => g.id === target.id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Rendu du plateau ----------
  function cellHTML(value, cls, delay) {
    return '<div class="flip-cell" style="--delay:' + (delay * 350) + 'ms"><div class="flip-inner">' +
      '<div class="flip-face flip-front" aria-hidden="true"><span>T</span></div>' +
      '<div class="flip-face flip-back ' + cls + '"><span>' + value + "</span></div></div></div>";
  }
  function rowHTML(player, revealCls) {
    const age = getAge(player.birthDate), targetAge = getAge(target.birthDate);
    const states = matchStates(player, target);
    const ARW_DOWN = '<svg class="arw" viewBox="0 0 100 100" aria-hidden="true"><path d="M42 12 h16 v47 h18 L50 88 24 59 h18 Z"/></svg>';
    const ARW_UP = '<svg class="arw up" viewBox="0 0 100 100" aria-hidden="true"><path d="M42 12 h16 v47 h18 L50 88 24 59 h18 Z"/></svg>';
    const ageArrow = age < targetAge ? ARW_UP : age > targetAge ? ARW_DOWN : "";
    let numHTML = '<span class="fig dash">—</span>';
    if (player.number != null) {
      const arr = target.number != null && player.number < target.number ? ARW_UP : target.number != null && player.number > target.number ? ARW_DOWN : "";
      numHTML = '<span class="fig">' + player.number + "</span>" + arr;
    }
    const cells = [
      '<div class="flip-cell" style="--delay:0ms"><div class="flip-inner"><div class="flip-face flip-front" aria-hidden="true"><span>T</span></div><div class="flip-face flip-back player-cell"><b>' + esc(player.shortName) + "</b></div></div></div>",
      cellHTML(esc(player.confederation || "—"), "result " + states[0], 1),
      cellHTML(esc(player.club), "result " + states[1], 2),
      cellHTML(esc(player.league), "result " + states[2], 3),
      cellHTML(esc(player.country), "result " + states[3], 4),
      cellHTML(esc(player.position), "result " + states[4], 5),
      cellHTML('<span class="fig">' + age + "</span>" + ageArrow, "result num " + states[5], 6),
      cellHTML(numHTML, "result num " + states[6], 7),
    ].join("");
    return '<div class="guess-row ' + revealCls + '" data-id="' + esc(player.id) + '">' + cells + "</div>";
  }
  function renderBoard() {
    if (!guesses.length) {
      el.boardArea.innerHTML = '<div class="empty-board"><div class="ball-mark">T</div><h3>À vous de jouer</h3><p>Saisissez le nom d’un joueur pour révéler les premiers indices.</p></div>';
      return;
    }
    const head = '<div class="board-head">' + HEAD.map((h) => "<span>" + h + "</span>").join("") + "</div>";
    const rows = guesses.map((g) => rowHTML(g, "revealed")).reverse().join("");
    el.boardArea.innerHTML = '<div class="board-wrap"><div class="board">' + head + rows + "</div></div>";
  }
  function updateCount() {
    el.count.textContent = String(guesses.length).padStart(2, "0");
  }

  // ---------- Suggestions ----------
  function renderSuggestions() {
    const q = el.input.value.trim();
    if (q.length < 2 || won() || revealing) { el.sugg.hidden = true; el.sugg.innerHTML = ""; return; }
    const needle = normalize(q);
    const found = PLAYERS.filter((p) => (normalize(p.shortName).includes(needle) || normalize(p.name).includes(needle)) && !guesses.some((g) => g.id === p.id)).slice(0, 5);
    if (!found.length) { el.sugg.hidden = true; el.sugg.innerHTML = ""; return; }
    el.sugg.innerHTML = found.map((p) => {
      const gn = firstName(p);
      return '<button type="button" data-id="' + esc(p.id) + '"><span>' + esc(p.shortName) + "</span>" + (gn ? "<small>" + esc(gn) + "</small>" : "") + "</button>";
    }).join("");
    el.sugg.hidden = false;
  }

  // ---------- Proposition ----------
  function submit(player) {
    if (!player || won() || revealing || guesses.some((g) => g.id === player.id)) return;
    guesses.push(player);
    setStored(storageKey, { guesses: guesses.map((g) => g.id), won: won() });
    el.input.value = "";
    el.sugg.hidden = true; el.sugg.innerHTML = "";
    updateCount();

    // rendu avec la nouvelle ligne en cours de révélation (en tête)
    const head = '<div class="board-head">' + HEAD.map((h) => "<span>" + h + "</span>").join("") + "</div>";
    const older = guesses.slice(0, -1).map((g) => rowHTML(g, "revealed")).reverse().join("");
    const fresh = rowHTML(player, "revealing");
    el.boardArea.innerHTML = '<div class="board-wrap"><div class="board">' + head + fresh + older + "</div></div>";

    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    revealing = true;
    lockInput(true);
    const finish = () => {
      revealing = false;
      lockInput(false);
      const row = el.boardArea.querySelector('.guess-row[data-id="' + cssEscape(player.id) + '"]');
      if (row) { row.classList.remove("revealing"); row.classList.add("revealed"); }
      if (won()) { showEnd(); } else { el.input.focus(); }
    };
    if (reduced) finish(); else setTimeout(finish, REVEAL_MS + 200);
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function lockInput(on) {
    el.field.classList.toggle("locked", on);
    el.input.disabled = on;
    el.input.placeholder = on ? "Révélation en cours…" : "Rechercher un joueur…";
  }

  // ---------- Fin de partie ----------
  // Réglages de la pop-up de victoire (surchargables via window.JOGADLE_CONFIG)
  const WIN = {
    subscribeUrl:  CFG.subscribeUrl   || "https://www.youtube.com/@Tomso-Foot?sub_confirmation=1",
    nextGameUrl:   CFG.nextGameUrl    || "",   // ← URL du prochain mini-jeu (à définir)
    comingSoonUrl: CFG.comingSoonUrl  || "#newsletter", // lancement solo : renvoie vers l'inscription
    latestApi:     CFG.latestVideoApi || "/.netlify/functions/youtube-latest",
    fallbackVideo: { id: "pXNzsY7_Sdg", title: "Japon : comment les Samouraïs comptent devenir champions du monde" }
  };
  function escHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function showEnd() {
    el.search.style.display = "none";
    const n = guesses.length;
    el.end.innerHTML = '<div class="end-card"><span>Bravo !</span><h3>Trouvé en ' + n + " proposition" + (n > 1 ? "s" : "") +
      '</h3><p>Revenez demain à minuit pour découvrir un nouveau joueur.</p><div class="end-actions">' +
      '<button type="button" data-td-share>Partager</button>' +
      '<button type="button" class="secondary" data-td-png>Télécharger le PNG</button></div></div>';
    openWinModal();
  }

  async function fetchLatestVideo() {
    try {
      const r = await fetch(WIN.latestApi, { cache: "no-store" });
      if (r.ok) {
        const v = await r.json();
        if (v && v.id) return { id: v.id, title: v.title || WIN.fallbackVideo.title, thumbnail: v.thumbnail };
      }
    } catch (e) { /* hors-ligne / version d'essai : repli sur la vidéo par défaut */ }
    return { id: WIN.fallbackVideo.id, title: WIN.fallbackVideo.title };
  }

  function winModalHTML(v) {
    const n = guesses.length;
    const who = escHtml(target.shortName || target.name || "le joueur");
    const watch = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.id);
    const thumb = v.thumbnail || ("https://i.ytimg.com/vi/" + v.id + "/maxresdefault.jpg");
    const nextBtn = WIN.nextGameUrl
      ? '<a class="win-next" href="' + escHtml(WIN.nextGameUrl) + '">Jeu suivant →</a>'
      : '<a class="win-next" href="' + escHtml(WIN.comingSoonUrl) + '" data-next-game>D’autres jeux arrivent bientôt</a>';
    const ytIcon = '<svg viewBox="0 0 28 20" aria-hidden="true"><path fill="#fff" d="M27.4 3.1a3.5 3.5 0 0 0-2.46-2.48C22.77 0 14 0 14 0S5.23 0 3.06.62A3.5 3.5 0 0 0 .6 3.1 36.7 36.7 0 0 0 0 10a36.7 36.7 0 0 0 .6 6.9 3.5 3.5 0 0 0 2.46 2.48C5.23 20 14 20 14 20s8.77 0 10.94-.62a3.5 3.5 0 0 0 2.46-2.48A36.7 36.7 0 0 0 28 10a36.7 36.7 0 0 0-.6-6.9Z"/><path fill="#FF0000" d="M11.2 14.3 18.5 10l-7.3-4.3Z"/></svg>';
    return '<div class="win-pop">' +
      '<div class="win-eyebrow"><i></i>Victoire · Joueur du jour</div>' +
      '<h3 class="win-title">Bravo !</h3>' +
      '<p class="win-sub">Tu as trouvé <b>' + who + "</b> en " + n + " essai" + (n > 1 ? "s" : "") + ".</p>" +
      '<span class="halo-frame">' + nextBtn + "</span>" +
      '<div class="win-countdown"><span class="win-cd-label">Prochaine partie dans</span><span class="win-clock" data-countdown>-- : -- : --</span></div>' +
      '<div class="win-video">' +
        '<span class="win-video-label">La dernière vidéo de la chaîne</span>' +
        '<a class="win-thumb" href="' + watch + '" target="_blank" rel="noopener">' +
          '<img src="' + thumb + '" alt="' + escHtml(v.title) + '" loading="lazy">' +
          '<span class="win-play">▶</span>' +
        "</a>" +
        '<a class="win-vtitle" href="' + watch + '" target="_blank" rel="noopener">' + escHtml(v.title) + "</a>" +
      "</div>" +
      '<a class="win-sub-btn" href="' + escHtml(WIN.subscribeUrl) + '" target="_blank" rel="noopener">' + ytIcon + "S’abonner à ma chaîne</a>" +
      '<div class="win-utils">' +
        '<button type="button" data-td-share>Partager mon score</button>' +
        '<button type="button" data-td-png>Télécharger le PNG</button>' +
      "</div>" +
    "</div>";
  }

  async function openWinModal() {
    const v = await fetchLatestVideo();
    openModal(winModalHTML(v));
    const img = el.modalBody.querySelector(".win-thumb img");
    if (img) img.onerror = function () { img.onerror = null; img.src = "https://i.ytimg.com/vi/" + v.id + "/hqdefault.jpg"; };
    startCountdown();
  }

  // ---------- Compte à rebours vers minuit (heure de Paris) ----------
  let countdownTimer = null;
  const parisClock = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function secondsUntilParisMidnight() {
    const parts = parisClock.formatToParts(new Date());
    const val = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
    let h = val("hour"); const m = val("minute"), s = val("second");
    if (h === 24) h = 0; // certains moteurs renvoient "24" à minuit
    const elapsed = h * 3600 + m * 60 + s;
    return (86400 - elapsed) % 86400; // 0 pile à minuit
  }
  function formatHMS(total) {
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const p = (n) => String(n).padStart(2, "0");
    return p(h) + " : " + p(m) + " : " + p(s);
  }
  function stopCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }
  function startCountdown() {
    stopCountdown();
    const node = el.modalBody.querySelector("[data-countdown]");
    if (!node) return;
    const tick = () => { node.textContent = formatHMS(secondsUntilParisMidnight()); };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function resultEmoji(player) {
    return matchStates(player, target).map((s) => (s === "correct" ? "🟩" : "🟥")).join("");
  }
  async function share() {
    const score = guesses.length;
    const grid = guesses.map(resultEmoji).join("\n");
    const text = "Jogadle #" + puzzleId + " — trouvé en " + score + " proposition" + (score > 1 ? "s" : "") +
      "\n\n" + grid + "\n\nJouez sur tomsofoot.fr/jeu et partagez vos scores entre amis";
    try {
      if (navigator.share) { await navigator.share({ title: "Mon score Jogadle", text }); }
      else { await navigator.clipboard.writeText(text); toast("Score copié !"); }
    } catch { /* partage annulé */ }
  }
  function downloadScore() {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const g = ctx.createLinearGradient(0, 0, 1080, 1080);
    g.addColorStop(0, "#07101f"); g.addColorStop(1, "#102b49");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1080);
    ctx.fillStyle = "#ef3340"; ctx.fillRect(80, 78, 64, 8);
    ctx.fillStyle = "#ffffff"; ctx.font = "900 70px Arial"; ctx.fillText("TOMSO", 80, 180);
    ctx.fillStyle = "#ef3340"; ctx.fillText("DLE", 327, 180);
    ctx.fillStyle = "#c8a967"; ctx.font = "700 24px Arial"; ctx.fillText("LE JOUEUR DU JOUR  •  #" + puzzleId, 80, 230);
    ctx.fillStyle = "#ffffff"; ctx.font = "900 62px Arial"; ctx.fillText("TROUVÉ EN " + guesses.length, 80, 355);
    guesses.forEach((player, row) => {
      matchStates(player, target).forEach((state, col) => {
        ctx.fillStyle = state === "correct" ? "#16a34a" : "#ef3340";
        ctx.fillRect(80 + col * 104, 425 + row * 70, 84, 48);
      });
    });
    ctx.fillStyle = "#f5f0e7"; ctx.font = "700 25px Arial"; ctx.fillText("Jouez sur tomsofoot.fr/jeu", 80, 980);
    ctx.fillStyle = "#8e9aab"; ctx.font = "500 20px Arial"; ctx.fillText("Partagez vos scores entre amis", 80, 1018);
    const link = document.createElement("a");
    link.download = "jogadle-" + puzzleId + ".png"; link.href = canvas.toDataURL("image/png"); link.click();
  }
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1900);
  }

  // ---------- Modales aide / stats ----------
  function openModal(html) { el.modalBody.innerHTML = html; el.modal.hidden = false; }
  function closeModal() { el.modal.hidden = true; stopCountdown(); }
  function helpHTML() {
    return '<div class="td-eyebrow"><i></i> Règles du jeu</div><h3>Comment jouer ?</h3>' +
      "<p>Proposez autant de joueurs que nécessaire pour identifier le joueur du jour. Après chaque proposition, les indices et leurs couleurs se dévoilent un à un.</p>" +
      "<ul><li><b>Vert :</b> le critère est exact.</li>" +
      "<li><b>Rouge :</b> le critère est différent.</li><li><b>Flèche :</b> la valeur recherchée est plus grande ou plus petite.</li></ul>";
  }
  function statsHTML() {
    let played = 0, wins = 0, best = 0, current = 0;
    for (let i = puzzleId; i > puzzleId - 90; i--) {
      const game = getStored("jogadle-v2-" + i);
      if (!game || !game.guesses || !game.guesses.length) { if (i < puzzleId) break; continue; }
      played++;
      const t = targetForPuzzle(i);
      if (game.guesses.includes(t.id)) { wins++; current++; best = Math.max(best, current); } else { current = 0; }
    }
    return '<div class="td-eyebrow"><i></i> Vos résultats</div><h3>Statistiques</h3>' +
      '<div class="stats-grid"><div><b>' + played + "</b><span>Parties</span></div><div><b>" + wins +
      "</b><span>Victoires</span></div><div><b>" + current + "</b><span>Série</span></div><div><b>" + best +
      "</b><span>Record</span></div></div><p>Vos résultats restent enregistrés uniquement sur cet appareil.</p>";
  }

  // ---------- Écouteurs ----------
  el.input.addEventListener("input", renderSuggestions);
  el.input.addEventListener("focus", renderSuggestions);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = el.sugg.querySelector("button[data-id]");
      if (first) submit(PLAYERS.find((p) => p.id === first.dataset.id));
    } else if (e.key === "Escape") { el.sugg.hidden = true; }
  });
  el.sugg.addEventListener("mousedown", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (btn) { e.preventDefault(); submit(PLAYERS.find((p) => p.id === btn.dataset.id)); }
  });
  document.addEventListener("click", (e) => {
    if (!el.search.contains(e.target)) el.sugg.hidden = true;
  });
  el.end.addEventListener("click", (e) => {
    if (e.target.closest("[data-td-share]")) share();
    else if (e.target.closest("[data-td-png]")) downloadScore();
  });
  root.querySelector("[data-td-help]").addEventListener("click", () => openModal(helpHTML()));
  root.querySelector("[data-td-stats]").addEventListener("click", () => openModal(statsHTML()));
  el.modalClose.addEventListener("click", closeModal);
  el.modal.addEventListener("mousedown", (e) => { if (e.target === el.modal) closeModal(); });
  el.modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-td-share]")) share();
    else if (e.target.closest("[data-td-png]")) downloadScore();
    else if (e.target.closest("[data-next-game]")) closeModal();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.modal.hidden) closeModal(); });

  // ---------- Initialisation ----------
  function init() {
    el.puzzle.textContent = forced ? "ESSAI" : "#" + puzzleId;
    const saved = getStored(storageKey);
    if (saved && Array.isArray(saved.guesses)) {
      guesses = saved.guesses.map((id) => PLAYERS.find((p) => p.id === id)).filter(Boolean);
    }
    updateCount();
    renderBoard();
    if (won()) showEnd();
  }
  init();
})();
