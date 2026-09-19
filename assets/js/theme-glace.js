/* TomsoFoot — habillage « Glace » : bouton jour / nuit + taches de lumière.
   Le thème initial est posé dans le <head> (avant l'affichage) pour éviter tout flash. */
(function () {
  var d = document.documentElement;
  var KEY = 'tf.theme';
  function saved() { try { var t = localStorage.getItem(KEY); return (t === 'light' || t === 'dark') ? t : null; } catch (e) { return null; } }
  function system() { try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
  function apply(t) {
    d.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    m.content = t === 'light' ? '#eef4fb' : '#050d1f';
    var b = document.querySelectorAll('.g-theme-btn');
    for (var i = 0; i < b.length; i++) {
      b[i].setAttribute('aria-label', t === 'light' ? 'Passer en mode nuit' : 'Passer en mode jour');
      b[i].setAttribute('title', t === 'light' ? 'Mode nuit' : 'Mode jour');
    }
  }
  var SVG = '<svg class="g-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
          + '<svg class="g-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  function toggle() {
    var t = d.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, t); } catch (e) {}
    apply(t);
  }
  function makeBtn(extra) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'g-theme-btn' + (extra ? ' ' + extra : '');
    b.innerHTML = SVG; b.addEventListener('click', toggle);
    return b;
  }
  function init() {
    if (!d.getAttribute('data-theme')) apply(saved() || system());
    // Taches de lumière (décor)
    if (!document.querySelector('.g-orbs')) {
      var o = document.createElement('div'); o.className = 'g-orbs'; o.setAttribute('aria-hidden', 'true');
      o.innerHTML = '<i></i><i></i><i></i>';
      document.body.insertBefore(o, document.body.firstChild);
    }
    // Bouton dans l'en-tête ; sinon bouton flottant
    var host = document.querySelector('.site-header .nav-actions');
    if (host) { var menu = host.querySelector('.menu-btn'); host.insertBefore(makeBtn('g-theme-btn--nav'), menu || null); }
    document.body.appendChild(makeBtn('g-theme-btn--float'));   // mobile : bouton flottant (l'en-tête est déjà plein)
    apply(d.getAttribute('data-theme'));
    // Suit le réglage de l'appareil tant que le visiteur n'a pas choisi lui-même
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
        if (!saved()) apply(e.matches ? 'light' : 'dark');
      });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
