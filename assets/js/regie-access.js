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

  var LINKS = [
    { label: 'Publier un journal · Pages CMS', href: 'https://app.pagescms.org/', ext: true },
    { label: 'Régie magazine', href: 'magazine/regie-magazine.html', ext: true },
    { label: 'Régie calendrier', href: 'regie-cal-7x9k2p.html', ext: true }
  ];

  var css = '' +
    '#tsf-regie{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;font-family:Inter,system-ui,Arial,sans-serif}' +
    '#tsf-regie .tsf-regie-btn{display:inline-flex;align-items:center;gap:8px;background:#061334;color:#f4f7fc;border:1px solid rgba(255,255,255,.16);border-radius:24px;padding:10px 15px;font-size:13px;font-weight:800;letter-spacing:.02em;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,.35)}' +
    '#tsf-regie .tsf-regie-btn:hover{border-color:#ef3340}' +
    '#tsf-regie .tsf-regie-dot{width:8px;height:8px;border-radius:50%;background:#ef3340}' +
    '#tsf-regie .tsf-regie-menu{position:absolute;right:0;bottom:52px;min-width:230px;background:#0a1b3d;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:6px;box-shadow:0 18px 40px rgba(0,0,0,.45);display:none}' +
    '#tsf-regie.is-open .tsf-regie-menu{display:block}' +
    '#tsf-regie .tsf-regie-menu a{display:block;color:#f4f7fc;text-decoration:none;padding:11px 12px;border-radius:8px;font-size:13px;font-weight:600}' +
    '#tsf-regie .tsf-regie-menu a:hover{background:rgba(255,255,255,.06);color:#fff}' +
    '#tsf-regie .tsf-regie-menu .tsf-regie-head{color:#93a3bd;font-size:10px;letter-spacing:.16em;text-transform:uppercase;padding:8px 12px 4px}' +
    '#tsf-regie .tsf-regie-off{color:#93a3bd !important;font-size:11px !important;border-top:1px solid rgba(255,255,255,.1);margin-top:4px}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var wrap = document.createElement('div'); wrap.id = 'tsf-regie';
  var menu = '<div class="tsf-regie-menu"><div class="tsf-regie-head">Ma régie</div>';
  LINKS.forEach(function (l) {
    menu += '<a href="' + l.href + '"' + (l.ext ? ' target="_blank" rel="noopener"' : '') + '>' + l.label + '</a>';
  });
  menu += '<a class="tsf-regie-off" href="?regie=off">Masquer ce menu sur cet appareil</a></div>';
  wrap.innerHTML =
    '<button class="tsf-regie-btn" type="button" aria-haspopup="true" aria-expanded="false">' +
    '<span class="tsf-regie-dot"></span>Régie</button>' + menu;
  document.body.appendChild(wrap);

  var btn = wrap.querySelector('.tsf-regie-btn');
  btn.addEventListener('click', function () {
    var open = wrap.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) wrap.classList.remove('is-open'); });
})();
