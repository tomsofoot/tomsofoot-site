/* TomsoFoot — « Défie ton pote » : fenêtre d'animation (mobile, tablette, ordinateur).

   Usage, une fois que le SERVEUR a validé le défi et sa mise :
     TomsoDefiPote.open({
       challengeId: "d_2026-11-06_42",        // identifiant stable du défi
       amount: 7,                             // mise validée par le serveur
       allowedAmounts: [1, 2, 3, 5, 7],       // facultatif : montants autorisés par le serveur
       plan: { eliminations: [[0,2],[1,3],[4]] }, // facultatif : plan visuel enregistré
       players: [{ name: "Tomso", points: 35 }, { name: "Alex", points: 12 }],
       onClose: function () {}
     });

   Garanties :
   - AFFICHAGE SEUL : aucun appel réseau, aucun tirage, aucun mouvement de points. Passer, fermer,
     redimensionner, rejouer ou revenir d'arrière-plan ne fait que redessiner le même plan ;
   - même défi + même montant => même animation sur mobile et sur ordinateur ;
   - le résultat textuel (mise en jeu) est toujours disponible, même si la vidéo, le son ou le
     canvas échouent, et il est annoncé aux lecteurs d'écran ;
   - prefers-reduced-motion : image finale immédiate, l'animation reste disponible à la demande. */
(function (global) {
  "use strict";
  var doc = global.document;
  var Plan = global.TomsoDefiPlan, Scene = global.TomsoDefiScene;
  if (!doc || !Plan || !Scene) return;

  // Ressources locales : /assets/defi-pote/ (déduit de l'emplacement de ce script).
  var SCRIPT = doc.currentScript && doc.currentScript.src;
  var BASE = SCRIPT ? new URL("../../defi-pote/", SCRIPT).href : "/assets/defi-pote/";
  var SOUND_KEY = "tomsofoot.defiPote.son";
  var uid = 0, current = null;

  function store(get, value) {
    try { if (get) return global.localStorage.getItem(SOUND_KEY); global.localStorage.setItem(SOUND_KEY, value); } catch (e) { /* stockage indisponible */ }
    return null;
  }
  function el(tag, cls, attrs) {
    var n = doc.createElement(tag); if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }
  function fmtPts(n) { var v = Number(n) || 0; return v.toLocaleString("fr-FR") + (Math.abs(v) === 1 ? " pt" : " pts"); }
  function reducedMotion() { return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches); }

  // Qualité adaptée à l'appareil : densité de pixels plafonnée, particules allégées si besoin.
  function quality() {
    var coarse = !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches);
    var cores = global.navigator.hardwareConcurrency || 4, mem = global.navigator.deviceMemory || 4;
    var modest = coarse && (cores <= 4 || mem <= 3);
    return { dprCap: modest ? 1.5 : 2, density: modest ? 0.6 : (coarse ? 0.85 : 1) };
  }

  var ICON_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  function open(options) {
    if (current) current.close({ silent: true });
    options = options || {};
    var players = (options.players || []).slice(0, 2).map(function (p) { return { name: String(p && p.name || "Joueur"), points: Number(p && p.points) || 0 }; });
    var plan = Plan.createPlan({
      challengeId: options.challengeId, amount: options.amount, allowedAmounts: options.allowedAmounts,
      players: players, plan: options.plan
    });
    var base = options.assetsBase || BASE;
    var q = quality();
    var id = "dp" + (++uid);
    var opener = options.returnFocus || doc.activeElement;
    var reduced = reducedMotion();

    // ---------- DOM ----------
    var overlay = el("div", "dp-overlay");
    var dialog = el("div", "dp-dialog", { role: "dialog", "aria-modal": "true", "aria-labelledby": id + "-t", "aria-describedby": id + "-s", tabindex: "-1" });
    var heading = el("h2", "dp-sr", { id: id + "-t" }); heading.textContent = "Défie ton pote : tirage de la mise";
    var top = el("div", "dp-top");
    var soundBtn = el("button", "dp-btn dp-sound", { type: "button", "aria-pressed": "false" });
    var closeBtn = el("button", "dp-btn dp-close", { type: "button", "aria-label": "Fermer" }); closeBtn.innerHTML = ICON_CLOSE;
    top.appendChild(soundBtn); top.appendChild(closeBtn);
    var stage = el("div", "dp-stage");
    var canvas = el("canvas", "dp-canvas", { "aria-hidden": "true" });
    stage.appendChild(canvas);
    var info = el("div", "dp-info");
    var who = el("p", "dp-players");
    players.forEach(function (p, i) {
      if (i) { var vs = el("span", "dp-vs"); vs.textContent = "vs"; who.appendChild(vs); }
      var b = el("span", "dp-player"); var n = el("span", "dp-name"); n.textContent = p.name; n.title = p.name;
      var pts = el("span", "dp-pts"); pts.textContent = fmtPts(p.points);
      b.appendChild(n); b.appendChild(pts); who.appendChild(b);
    });
    var status = el("p", "dp-status", { id: id + "-s", role: "status", "aria-live": "polite" });
    info.appendChild(who); info.appendChild(status);
    var actions = el("div", "dp-actions");
    var mainBtn = el("button", "dp-btn dp-primary", { type: "button" });
    actions.appendChild(mainBtn);
    var brand = el("div", "dp-brand", { "aria-hidden": "true" }); brand.textContent = "TOMSOFOOT";
    dialog.appendChild(heading); dialog.appendChild(top); dialog.appendChild(stage); dialog.appendChild(info); dialog.appendChild(actions); dialog.appendChild(brand);
    overlay.appendChild(dialog);
    (options.container || doc.body).appendChild(overlay);
    doc.documentElement.classList.add("dp-lock");

    var state = { t: 0, playing: false, t0: 0, raf: 0, layout: null, dpr: 1, closed: false, revealedAnnounced: false,
      sound: store(true) === "1", videoOk: false, audioOk: true, hiddenWhilePlaying: false };
    var resultText = plan.ok
      ? "Mise révélée : " + Plan.spoken(plan.amount) + " en jeu. Le meilleur pronostic remportera le duel."
      : (isFinite(Number(options.amount)) && Number(options.amount) > 0
        ? "Mise du défi : " + Plan.spoken(Number(options.amount)) + "."
        : "Animation indisponible pour ce défi.");
    dialog.setAttribute("data-amount", plan.ok ? String(plan.amount) : "");
    dialog.setAttribute("data-plan", plan.ok ? JSON.stringify(plan.eliminations.map(function (e) { return e.indices; })) : "");

    // ---------- Médias (locaux) ----------
    var video = el("video", "dp-media", { muted: "", playsinline: "", preload: "auto", "aria-hidden": "true" });
    video.muted = true; video.playsInline = true; video.src = base + "duel-epees.mp4";
    dialog.appendChild(video); // masquée (.dp-media) : source des images des épées
    var audio = new global.Audio();
    audio.preload = "auto";
    audio.src = base + (audio.canPlayType && audio.canPlayType("audio/mp4; codecs=\"mp4a.40.2\"") ? "son.m4a" : "son.wav");
    function onVideoReady() {
      state.videoOk = true;
      if (state.playing) { syncMedia(true); var p = video.play(); if (p && p.catch) p.catch(function () { /* image fixe */ }); }
      else seekStill();
    }
    // Image fixe (Passer, mouvement réduit, redimensionnement) : la vidéo est recalée sur t, puis on redessine.
    function seekStill() {
      if (!state.videoOk) { draw(); return; }
      var vt = Math.min(state.t, (video.duration || 8) - 0.04);
      if (Math.abs(video.currentTime - vt) > 0.02) { try { video.currentTime = vt; } catch (e) { /* */ } }
      draw();
    }
    function onSeeked() { if (!state.playing && !state.closed) draw(); }
    function onVideoError() { state.videoOk = false; if (!state.playing) draw(); }
    function onAudioError() { state.audioOk = false; setSound(false, true); soundBtn.disabled = true; soundBtn.title = "Son indisponible"; }
    video.addEventListener("loadeddata", onVideoReady);
    video.addEventListener("error", onVideoError);
    video.addEventListener("seeked", onSeeked);
    audio.addEventListener("error", onAudioError);

    // ---------- Dessin ----------
    var ctx = canvas.getContext && canvas.getContext("2d");
    if (!plan.ok || !ctx) {
      dialog.classList.add("dp-fallback");
      if (!plan.ok && global.console) global.console.warn("[Défie ton pote] plan refusé :", plan.error, plan.message);
    }
    function measure() {
      if (!ctx || !plan.ok) return;
      var r = stage.getBoundingClientRect(), w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
      state.dpr = Math.min(global.devicePixelRatio || 1, q.dprCap);
      canvas.width = Math.round(w * state.dpr); canvas.height = Math.round(h * state.dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      state.layout = Scene.layout(w, h);
      dialog.setAttribute("data-layout", state.layout.mode);
    }
    function draw() {
      if (!ctx || !plan.ok || !state.layout) return;
      Scene.render(ctx, state.t, { plan: plan, layout: state.layout, video: state.videoOk ? video : null, dpr: state.dpr, density: q.density });
    }

    // ---------- Lecture ----------
    function setMain() {
      var done = !state.playing && state.t >= plan.timeline.settled;
      mainBtn.textContent = done ? (reduced && !state.watched ? "Voir l’animation" : "Rejouer") : "Passer";
      mainBtn.setAttribute("data-action", done ? "replay" : "skip");
    }
    function announce() {
      if (!plan.ok) { status.textContent = resultText; return; }
      if (state.t >= plan.timeline.reveal) {
        if (!state.revealedAnnounced) { state.revealedAnnounced = true; status.textContent = resultText; }
      } else if (state.playing) status.textContent = "Tirage de la mise en cours…";
    }
    function syncMedia(force) {
      if (state.videoOk) {
        var vt = Math.min(state.t, (video.duration || 8) - 0.04);
        if (force || Math.abs(video.currentTime - vt) > 0.12) { try { video.currentTime = vt; } catch (e) { /* pas encore seekable */ } }
      }
      if (state.sound && state.audioOk && state.playing) {
        if (force || Math.abs(audio.currentTime - state.t) > 0.15) { try { audio.currentTime = state.t; } catch (e) { /* idem */ } }
      }
    }
    function stopMedia() { try { video.pause(); } catch (e) { /* */ } try { audio.pause(); } catch (e) { /* */ } }
    function startMedia() {
      syncMedia(true);
      if (state.videoOk) { var p = video.play(); if (p && p.catch) p.catch(function () { /* image fixe : le canvas suit l'horloge */ }); }
      if (state.sound && state.audioOk) {
        var a = audio.play();
        if (a && a.catch) a.catch(function () { setSound(false, true); status.textContent = "Son bloqué par le navigateur : touchez « Son » pour l’activer."; });
      }
    }
    function frame(now) {
      if (state.closed || !state.playing) return;
      state.t = Math.min(plan.timeline.duration, (now - state.t0) / 1000);
      if (state.videoOk && !video.paused && Math.abs(video.currentTime - state.t) > 0.25) syncMedia(true);
      draw(); announce();
      if (state.t >= plan.timeline.duration) { state.playing = false; stopMedia(); setMain(); return; }
      state.raf = global.requestAnimationFrame(frame);
    }
    function play(from) {
      if (!plan.ok || !ctx) return;
      global.cancelAnimationFrame(state.raf);
      state.t = from || 0; state.playing = true; state.watched = true;
      if (!from) state.revealedAnnounced = false;
      state.t0 = global.performance.now() - state.t * 1000;
      startMedia(); setMain(); announce();
      state.raf = global.requestAnimationFrame(frame);
    }
    function settle() {
      global.cancelAnimationFrame(state.raf);
      state.playing = false; stopMedia();
      state.t = plan.ok ? Math.max(state.t, plan.timeline.settled) : 0;
      seekStill(); announce(); setMain();
    }
    function setSound(on, quiet) {
      state.sound = !!on && state.audioOk;
      soundBtn.setAttribute("aria-pressed", String(state.sound));
      soundBtn.innerHTML = (state.sound ? ICON_SOUND_ON : ICON_SOUND_OFF) + '<span class="dp-btn-label">' + (state.sound ? "Son activé" : "Son coupé") + "</span>";
      soundBtn.setAttribute("aria-label", state.sound ? "Couper le son" : "Activer le son");
      if (!quiet) store(false, state.sound ? "1" : "0");
      if (!state.sound) { try { audio.pause(); } catch (e) { /* */ } }
      else if (state.playing) { syncMedia(true); var a = audio.play(); if (a && a.catch) a.catch(function () { setSound(false, true); }); }
    }

    // ---------- Interactions ----------
    function onMain() { if (mainBtn.getAttribute("data-action") === "replay") play(0); else settle(); }
    function onStageClick() { if (state.playing) settle(); }
    function focusables() {
      return Array.prototype.filter.call(dialog.querySelectorAll("button:not([disabled])"), function (b) { return b.offsetParent !== null; });
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") {
        var f = focusables(); if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (doc.activeElement === first || doc.activeElement === dialog)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    function onVisibility() {
      if (doc.hidden) {
        if (state.playing) { state.hiddenWhilePlaying = true; global.cancelAnimationFrame(state.raf); state.playing = false; stopMedia(); }
      } else if (state.hiddenWhilePlaying) {
        state.hiddenWhilePlaying = false; play(state.t); // reprise au même instant, même plan
      }
    }
    var ro = global.ResizeObserver ? new global.ResizeObserver(function () { measure(); draw(); }) : null;
    function onResize() { measure(); draw(); }
    mainBtn.addEventListener("click", onMain);
    closeBtn.addEventListener("click", function () { close(); });
    soundBtn.addEventListener("click", function () { setSound(!state.sound); });
    stage.addEventListener("click", onStageClick);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    dialog.addEventListener("keydown", onKey);
    doc.addEventListener("visibilitychange", onVisibility);
    if (ro) ro.observe(stage); else global.addEventListener("resize", onResize);

    // ---------- Fermeture : tout s'arrête, rien n'est envoyé ----------
    function close(opts) {
      if (state.closed) return;
      state.closed = true; state.playing = false;
      global.cancelAnimationFrame(state.raf);
      stopMedia();
      video.removeEventListener("loadeddata", onVideoReady); video.removeEventListener("error", onVideoError); video.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("error", onAudioError);
      try { video.removeAttribute("src"); video.load(); } catch (e) { /* */ }
      try { audio.removeAttribute("src"); audio.load(); } catch (e) { /* */ }
      doc.removeEventListener("visibilitychange", onVisibility);
      if (ro) ro.disconnect(); else global.removeEventListener("resize", onResize);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      doc.documentElement.classList.remove("dp-lock");
      if (current === api) current = null;
      if (opener && opener.focus && doc.contains(opener)) { try { opener.focus(); } catch (e) { /* */ } }
      if (typeof options.onClose === "function" && !(opts && opts.silent)) options.onClose();
    }

    // ---------- Démarrage ----------
    setSound(state.sound, true);
    measure();
    var fontsReady = doc.fonts && doc.fonts.load
      ? Promise.race([Promise.all([doc.fonts.load("italic 900 40px DefiSans"), doc.fonts.load("700 40px DefiSans")]), new Promise(function (r) { setTimeout(r, 1500); })])
      : Promise.resolve();
    var api = {
      element: dialog, plan: plan,
      close: close,
      skip: function () { settle(); },
      replay: function () { play(0); },
      setSound: function (on) { setSound(on); },
      // Outils de vérification : redessine un instant donné sans rien modifier.
      renderAt: function (t) {
        global.cancelAnimationFrame(state.raf); state.playing = false; stopMedia(); state.t = t;
        if (plan.ok && t < plan.timeline.reveal) { state.revealedAnnounced = false; status.textContent = "Tirage de la mise en cours…"; }
        seekStill(); announce(); setMain();
      },
      layout: function () { return state.layout; },
      state: function () { return { t: state.t, playing: state.playing, sound: state.sound, videoOk: state.videoOk, closed: state.closed, raf: state.raf, audioPlaying: !audio.paused, videoPlaying: !video.paused }; }
    };
    current = api;
    if (!plan.ok || !ctx) { status.textContent = resultText; mainBtn.hidden = true; setTimeout(function () { closeBtn.focus(); }, 0); return api; }
    setMain();
    status.textContent = reduced ? resultText : "Préparation du tirage…";
    fontsReady.then(function () {
      if (state.closed) return;
      if (reduced) { state.revealedAnnounced = true; state.t = plan.timeline.settled; seekStill(); setMain(); }
      else play(0);
    });
    setTimeout(function () { if (!state.closed) mainBtn.focus(); }, 0);
    return api;
  }

  global.TomsoDefiPote = { open: open, version: "1.0.0" };
})(typeof window !== "undefined" ? window : this);
