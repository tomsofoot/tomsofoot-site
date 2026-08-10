/* Jogadle — AUTHENTIFICATION RÉELLE (Supabase Auth).
   Ce fichier initialise le VRAI client Supabase officiel (@supabase/supabase-js),
   restaure la session au chargement, écoute onAuthStateChange, ouvre Google (signInWithOAuth)
   et le lien magique (signInWithOtp), expose le JWT réel et gère la déconnexion.

   SÉCURITÉ :
   - Ce fichier n'utilise QUE window.JOGADLE_CONFIG.SUPABASE_URL et la clé anon PUBLIQUE.
   - La clé service_role n'apparaît JAMAIS ici (ni nulle part côté client) : elle reste
     exclusivement dans les Edge Functions Supabase.
   - En TEST_MODE (prévisualisation locale) ce module reste INERTE : aucun réseau, aucun Auth.
     Le parcours simulé d'identity.js prend alors le relais.

   API exposée :
   - window.JogadleAuth.ready            -> Promise résolue une fois l'init tentée
   - window.JogadleAuth.available()      -> true si un vrai client Supabase est prêt
   - window.JogadleAuth.signIn(p, email) -> "google" | "magic"
   - window.JogadleAuth.signOut()
   - window.JogadleAuth.getSession()     -> { access_token, user } | null
   - window.JogadleAuth.onChange(cb)     -> notifié à chaque changement d'état (login/logout)
   - window.JogadleAuth.client()         -> client Supabase partagé (réutilisé par realtime.js)
*/
(function (global) {
  "use strict";
  var CFG = global.JOGADLE_CONFIG || {};
  var TEST = !!CFG.TEST_MODE;
  var ready = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);

  var sb = null;                 // client Supabase partagé (jamais recréé)
  var current = null;            // session courante { access_token, user }
  var listeners = [];
  function emit(evt) { listeners.forEach(function (f) { try { f(evt, current); } catch (e) {} }); }

  function setSession(session) {
    current = session || null;
    // JWT réel exposé pour l'adaptateur api.js (Authorization: Bearer <jwt>).
    global.__JOGADLE_JWT = current && current.access_token ? current.access_token : null;
  }

  // Import dynamique du client officiel depuis un CDN ESM (aucun secret, clé anon publique).
  // Configurable via CFG.SUPABASE_JS_URL si besoin d'épingler une version/miroir.
  var CDN = CFG.SUPABASE_JS_URL || "https://esm.sh/@supabase/supabase-js@2";

  async function init() {
    if (TEST || !ready || !global.fetch) return false;   // inerte en preview / sans config
    try {
      var mod = await import(/* @vite-ignore */ CDN);
      var createClient = mod.createClient;
      sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,        // session conservée (localStorage géré par Supabase)
          autoRefreshToken: true,      // JWT rafraîchi automatiquement
          detectSessionInUrl: true,    // récupère la session au retour OAuth / lien magique
        },
      });
      global.__JOGADLE_SB = sb;        // partagé avec realtime.js

      // 1) Restauration de session au chargement (retour OAuth inclus).
      var got = await sb.auth.getSession();
      setSession(got && got.data ? got.data.session : null);

      // 2) Écoute continue des changements d'état (SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED).
      sb.auth.onAuthStateChange(function (event, session) {
        setSession(session);
        emit(event);
      });

      // Nettoyage éventuel des paramètres OAuth dans l'URL (jamais de token en clair dans l'URL).
      try {
        if (global.history && /[#?].*(access_token|code=)/.test(global.location.href)) {
          global.history.replaceState({}, document.title, global.location.pathname + global.location.search.replace(/[?&]code=[^&]*/,""));
        }
      } catch (e) {}

      emit("INIT");
      return true;
    } catch (e) {
      sb = null;
      return false;
    }
  }

  function redirectTo() {
    try { return global.location.origin + global.location.pathname; } catch (e) { return undefined; }
  }

  async function signIn(provider, email) {
    if (!sb) throw new Error("auth_unavailable");
    if (provider === "google") {
      // VRAI appel Supabase Auth : redirige vers Google puis revient sur la page.
      return sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    }
    if (provider === "magic") {
      // VRAI lien magique : Supabase envoie l'e-mail (aucun mot de passe).
      return sb.auth.signInWithOtp({ email: String(email || "").trim(), options: { emailRedirectTo: redirectTo() } });
    }
    throw new Error("bad_provider");
  }

  async function signOut() {
    if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
    setSession(null);
    emit("SIGNED_OUT");
  }

  var readyPromise = init();

  global.JogadleAuth = {
    ready: readyPromise,
    available: function () { return !!sb; },
    signIn: signIn,
    signOut: signOut,
    getSession: function () { return current; },
    onChange: function (cb) { if (typeof cb === "function") listeners.push(cb); },
    client: function () { return sb; },
  };
})(window);
