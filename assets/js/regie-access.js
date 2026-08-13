// regie-access.js — accès RÉGIE réservé au propriétaire, discret.
// Le lien n'apparaît QUE sur le navigateur du propriétaire, après avoir visité
// une fois l'URL secrète :  https://tomsofoot.fr/?regie=<CODE>
// (le statut est mémorisé localement). Pour masquer à nouveau : ?regie=off
//
// IMPORTANT : ceci sert à la DISCRÉTION (cacher le lien aux visiteurs). La
// vraie protection reste la CONNEXION de chaque régie (GitHub / Supabase) :
// personne ne peut agir sans tes identifiants, même en trouvant l'URL.
(function () {
  var KEY = 'tsf-regie';
  // hachage non-cryptographique (djb2) — évite d'écrire le code en clair ici.
  function h(s) { var x = 5381; for (var i = 0; i < s.length; i++) { x = ((x << 5) + x) + s.charCodeAt(i); x |= 0; } return x >>> 0; }
  var OWNER_HASH = 2565088163; // = hash("regie-9k2p-tomso")

  try {
    var params = new URLSearchParams(location.search);
    if (params.has('regie')) {
      var v = params.get('regie');
      if (v === 'off') { try { localStorage.removeItem(KEY); } catch (e) {} }
      else if (h(v) === OWNER_HASH) { try { localStorage.setItem(KEY, '1'); } catch (e) {} }
      // Nettoie l'URL pour ne pas laisser le code visible dans la barre d'adresse.
      params.delete('regie');
      var q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
  } catch (e) {}

  var on = false; try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (!on) return; // visiteurs normaux : rien ne s'affiche.

  var css = '' +
    '#tsf-regie{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;font-family:Inter,system-ui,Arial,sans-serif}' +
    '#tsf-regie .tsf-regie-btn{display:inline-flex;align-items:center;gap:8px;background:#061334;color:#f4f7fc;border:1px solid rgba(255,255,255,.16);border-radius:24px;padding:10px 15px;font-size:13px;font-weight:800;letter-spacing:.02em;text-decoration:none;box-shadow:0 10px 26px rgba(0,0,0,.35)}' +
    '#tsf-regie .tsf-regie-btn:hover{border-color:#ef3340}' +
    '#tsf-regie .tsf-regie-dot{width:8px;height:8px;border-radius:50%;background:#ef3340}' +
    '#tsf-regie .tsf-regie-off{display:block;text-align:center;margin-top:6px;color:#93a3bd;font-size:10px;letter-spacing:.06em;text-decoration:none}' +
    '#tsf-regie .tsf-regie-off:hover{color:#f4f7fc}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // Le bouton mène à la page de connexion de la régie (regie.html) : l'accès
  // exige de se connecter (Supabase). L'affichage du bouton reste réservé au
  // propriétaire (discrétion) ; la connexion est la vraie protection.
  var wrap = document.createElement('div'); wrap.id = 'tsf-regie';
  wrap.innerHTML =
    '<a class="tsf-regie-btn" href="regie.html"><span class="tsf-regie-dot"></span>Régie</a>' +
    '<a class="tsf-regie-off" href="?regie=off">masquer sur cet appareil</a>';
  document.body.appendChild(wrap);
})();
