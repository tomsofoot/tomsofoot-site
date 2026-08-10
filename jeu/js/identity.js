/* Jogadle — Identité : écran de connexion (Google / lien magique), jeu invité, création du pseudo.
   - Auth RÉELLE via window.JogadleAuth (auth-supabase.js) : Google (signInWithOAuth) et
     lien magique (signInWithOtp). En TEST_MODE, parcours simulé (aucun réseau).
   - Le profil (public_ref, display_name, ligue, rang, points) est TOUJOURS lu/écrit côté serveur
     via l'adaptateur (Edge Functions get-my-profile / get-or-create-profile).
   - Le client ne fabrique JAMAIS public_ref : il ne fait qu'AFFICHER ce que le serveur renvoie. */
(function (global) {
  "use strict";
  var CFG = global.JOGADLE_CONFIG || {};
  var TEST = !!CFG.TEST_MODE;
  var API = function () { return global.JogadleAPI; };
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function isConnected() { return !!global.__JOGADLE_ME; }
  function me() { return global.__JOGADLE_ME || null; }

  // ------- Bloc discret dans le panneau championnat (#jg-identity) -------
  function renderIdentityBlock() {
    var mount = document.querySelector("#jg-identity");
    if (!mount) return;
    if (isConnected()) {
      var m = me();
      var ligue = m.league && m.league !== "unranked" ? ("Ligue " + m.league) : "Hors Ligue";
      mount.innerHTML = '<div class="jg-id-connected"><span class="jg-id-pseudo">' + esc(m.pseudo || m.display_name) +
        '</span><span class="jg-id-meta">' + esc(ligue) + (m.points != null ? (" · " + m.points + " pts") : "") + '</span>' +
        '<button type="button" class="jg-id-logout">Se déconnecter</button></div>';
      mount.querySelector(".jg-id-logout").addEventListener("click", logout);
    } else {
      mount.innerHTML = '<button type="button" class="jg-id-join"><b>Rejoindre le championnat</b><small>Créez votre identité Jogadle et entrez dans la compétition.</small></button>';
      mount.querySelector(".jg-id-join").addEventListener("click", openConnect);
    }
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ------- Écran de connexion -------
  function openConnect() {
    if (document.querySelector(".jg-auth")) return;
    var o = document.createElement("div");
    o.className = "jg-auth";
    o.innerHTML =
      '<div class="jg-auth__card">' +
      '<button class="jg-auth__close" aria-label="Fermer">×</button>' +
      '<div class="jg-auth__eyebrow">Championnat Jogadle</div>' +
      '<h3 class="jg-auth__title">Créez votre identité</h3>' +
      '<p class="jg-auth__sub">Jouable sans compte. Pour gagner des points et entrer au classement, créez une identité permanente (sans mot de passe).</p>' +
      '<button class="jg-auth__btn jg-auth__google"><span>Continuer avec Google</span></button>' +
      '<div class="jg-auth__or">ou</div>' +
      '<div class="jg-auth__magic"><input type="email" placeholder="votre@email.fr" class="jg-auth__email"><button class="jg-auth__btn jg-auth__link">Recevoir un lien magique</button></div>' +
      '<div class="jg-auth__note" style="display:none"></div>' +
      '<div class="jg-auth__guest"><button class="jg-auth__ghost jg-auth__play-guest">Jouer en invité (sans points)</button></div>' +
      '</div>';
    document.body.appendChild(o);
    o.querySelector(".jg-auth__close").addEventListener("click", function () { o.remove(); });
    o.addEventListener("click", function (e) { if (e.target === o) o.remove(); });
    o.querySelector(".jg-auth__google").addEventListener("click", function () { signIn("google"); });
    o.querySelector(".jg-auth__link").addEventListener("click", function () {
      var email = o.querySelector(".jg-auth__email").value.trim();
      if (!email) { o.querySelector(".jg-auth__email").focus(); return; }
      signIn("magic", email);
    });
    o.querySelector(".jg-auth__play-guest").addEventListener("click", function () { o.remove(); global.__JOGADLE_ME = null; emit(); });
  }

  function authNote(msg, isErr) {
    var n = document.querySelector(".jg-auth__note");
    if (!n) return;
    n.textContent = msg; n.style.display = ""; n.classList.toggle("is-error", !!isErr);
  }

  function signIn(provider, email) {
    if (TEST) {
      // Parcours SIMULÉ (aucun vrai Auth) : on "connecte" un compte de démo, puis on lit le profil.
      global.__JOGADLE_JWT = "test-jwt";
      closeAuth();
      afterLogin();
      return;
    }
    // PRODUCTION : VRAI Supabase Auth.
    var Auth = global.JogadleAuth;
    if (!Auth || !Auth.available()) { authNote("Connexion momentanément indisponible.", true); return; }
    Auth.signIn(provider, email).then(function (res) {
      if (provider === "magic") {
        if (res && res.error) authNote("Envoi impossible : " + (res.error.message || "réessayez."), true);
        else authNote("Lien magique envoyé à " + email + ". Vérifiez votre boîte mail.", false);
      }
      // Google : redirection gérée par Supabase ; au retour, onAuthStateChange déclenche afterLogin().
    }).catch(function () { authNote("Connexion impossible. Réessayez.", true); });
  }

  // Appelé après une connexion réussie (retour OAuth, lien magique validé, ou démo TEST).
  var pseudoOpen = false;
  function afterLogin() {
    var api = API();
    if (!api || !api.getMyProfile) { openPseudo(); return; }
    api.getMyProfile().then(function (p) {
      if (p && p.public_ref) { setMe(p); }
      else { openPseudo(); }
    }).catch(function () { openPseudo(); });
  }

  function setMe(p) {
    // On n'AFFICHE que ce que le serveur renvoie (public_ref jamais fabriqué côté client).
    global.__JOGADLE_ME = {
      public_ref: p.public_ref, pseudo: p.display_name || p.pseudo,
      display_name: p.display_name || p.pseudo, league: p.league || null,
      rank: p.rank != null ? p.rank : null, points: p.points != null ? p.points : null,
    };
    closeAuth(); renderIdentityBlock(); emit();
  }

  // ------- Création du pseudo permanent (après 1re connexion) -------
  function openPseudo() {
    if (pseudoOpen || document.querySelector(".jg-auth__pseudo")) return;
    pseudoOpen = true;
    var o = document.createElement("div");
    o.className = "jg-auth";
    o.innerHTML =
      '<div class="jg-auth__card">' +
      '<div class="jg-auth__eyebrow">Dernière étape</div>' +
      '<h3 class="jg-auth__title">Choisissez votre pseudo</h3>' +
      '<p class="jg-auth__sub">Permanent, unique, 20 caractères maximum. Il ne pourra plus être modifié.</p>' +
      '<input type="text" maxlength="20" class="jg-auth__pseudo" placeholder="Votre pseudo">' +
      '<div class="jg-auth__err" style="display:none"></div>' +
      '<button class="jg-auth__btn jg-auth__save">Valider mon identité</button>' +
      '</div>';
    document.body.appendChild(o);
    var input = o.querySelector(".jg-auth__pseudo"); input.focus();
    var saveBtn = o.querySelector(".jg-auth__save");
    function fail(msg) { var err = o.querySelector(".jg-auth__err"); err.textContent = msg; err.style.display = ""; saveBtn.disabled = false; }
    saveBtn.addEventListener("click", function () {
      var v = input.value.trim();
      if (v.length < 2 || v.length > 20) { fail("Entre 2 et 20 caractères."); return; }
      saveBtn.disabled = true;
      var api = API();
      if (!api || !api.getOrCreateProfile) { fail("Service indisponible."); return; }
      // Création SERVEUR du pseudo : le public_ref est renvoyé par le serveur, jamais inventé ici.
      api.getOrCreateProfile(v).then(function (r) {
        if (r && r.error) {
          if (r.error === "pseudo_taken") return fail("Ce pseudo est déjà pris.");
          if (r.error === "pseudo_reserved") return fail("Pseudo réservé ou trompeur refusé.");
          if (r.error === "auth_required") return fail("Connectez-vous d'abord.");
          return fail("Création impossible. Réessayez.");
        }
        if (r && r.public_ref) { pseudoOpen = false; o.remove(); setMe(r); }
        else fail("Réponse inattendue du serveur.");
      }).catch(function () { fail("Création impossible. Réessayez."); });
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") saveBtn.click(); });
    o.addEventListener("click", function (e) { if (e.target === o) { /* pseudo obligatoire : ne pas fermer par clic extérieur */ } });
  }

  function logout() {
    global.__JOGADLE_ME = null;
    global.__JOGADLE_JWT = null;
    if (!TEST && global.JogadleAuth) { try { global.JogadleAuth.signOut(); } catch (e) {} }
    renderIdentityBlock(); emit();
  }
  function closeAuth() { var a = document.querySelector(".jg-auth"); if (a) a.remove(); }

  // ------- Init : brancher l'écoute de l'auth réelle (retour OAuth / restauration de session) -------
  function init(onChange) {
    if (onChange) listeners.push(onChange);
    renderIdentityBlock();
    if (!TEST && global.JogadleAuth) {
      global.JogadleAuth.onChange(function (evt) {
        if (evt === "SIGNED_OUT") { global.__JOGADLE_ME = null; renderIdentityBlock(); emit(); return; }
        // Session présente (restaurée, retour OAuth, ou lien magique validé) : lire le profil.
        if (global.__JOGADLE_JWT && !isConnected()) afterLogin();
      });
      // Session déjà restaurée avant l'attache de l'écouteur ?
      global.JogadleAuth.ready.then(function () {
        if (global.__JOGADLE_JWT && !isConnected()) afterLogin();
      });
    }
  }

  global.JogadleIdentity = {
    init: init, open: openConnect, me: me, isConnected: isConnected,
    onChange: function (f) { listeners.push(f); },
  };
})(window);
