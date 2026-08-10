/* Jogadle — MOCK de prévisualisation (TEST_MODE uniquement). Données FICTIVES.
   Simule le backend R2 (mêmes formes de réponse) pour jouer localement sans Supabase.
   N'est chargé/actif que si JOGADLE_CONFIG.TEST_MODE === true. Jamais en production. */
(function (global) {
  "use strict";
  if (!(global.JOGADLE_CONFIG && global.JOGADLE_CONFIG.TEST_MODE)) return;

  // --- Petit jeu de données fictif (attributs publics only) ---
  var P = [
    ["kylian-mbappe","Kylian Mbappé","Mbappé","UEFA","Real Madrid","Liga","France","Avant-centre","1998-12-20",10],
    ["marcus-rashford","Marcus Rashford","Rashford","UEFA","Manchester United","Premier League","Angleterre","Ailier gauche","1997-10-31",null],
    ["erling-haaland","Erling Haaland","Haaland","UEFA","Manchester City","Premier League","Norvège","Avant-centre","2000-07-21",9],
    ["vinicius-junior","Vinícius Jr","Vinícius","UEFA","Real Madrid","Liga","Brésil","Ailier gauche","2000-07-12",7],
    ["jude-bellingham","Jude Bellingham","Bellingham","UEFA","Real Madrid","Liga","Angleterre","Milieu offensif","2003-06-29",5],
    ["bukayo-saka","Bukayo Saka","Saka","UEFA","Arsenal","Premier League","Angleterre","Ailier droit","2001-09-05",7],
    ["harry-kane","Harry Kane","Kane","UEFA","Bayern Munich","Bundesliga","Angleterre","Avant-centre","1993-07-28",9],
    ["mohamed-salah","Mohamed Salah","Salah","UEFA","Liverpool","Premier League","Égypte","Ailier droit","1992-06-15",11],
    ["kevin-de-bruyne","Kevin De Bruyne","De Bruyne","UEFA","Manchester City","Premier League","Belgique","Milieu offensif","1991-06-28",17],
    ["rodri","Rodri","Rodri","UEFA","Manchester City","Premier League","Espagne","Milieu défensif","1996-06-22",16],
    ["lamine-yamal","Lamine Yamal","Yamal","UEFA","Barcelone","Liga","Espagne","Ailier droit","2007-07-13",19],
    ["achraf-hakimi","Achraf Hakimi","Hakimi","UEFA","Paris SG","Ligue 1","Maroc","Arrière droit","1998-11-04",2],
    ["florian-wirtz","Florian Wirtz","Wirtz","UEFA","Liverpool","Premier League","Allemagne","Milieu offensif","2003-05-03",8],
    ["martin-odegaard","Martin Ødegaard","Ødegaard","UEFA","Arsenal","Premier League","Norvège","Milieu offensif","1998-12-17",8],
    ["declan-rice","Declan Rice","Rice","UEFA","Arsenal","Premier League","Angleterre","Milieu défensif","1999-01-14",41],
    ["cole-palmer","Cole Palmer","Palmer","UEFA","Chelsea","Premier League","Angleterre","Milieu offensif","2002-05-06",10],
    ["antoine-griezmann","Antoine Griezmann","Griezmann","UEFA","Atlético","Liga","France","Deuxième attaquant","1991-03-21",7],
    ["ousmane-dembele","Ousmane Dembélé","Dembélé","UEFA","Paris SG","Ligue 1","France","Ailier droit","1997-05-15",10],
    ["pedri","Pedri","Pedri","UEFA","Barcelone","Liga","Espagne","Milieu central","2002-11-25",8],
    ["gavi","Gavi","Gavi","UEFA","Barcelone","Liga","Espagne","Milieu central","2004-08-05",6],
    ["phil-foden","Phil Foden","Foden","UEFA","Manchester City","Premier League","Angleterre","Ailier gauche","2000-05-28",47],
    ["nico-williams","Nico Williams","N. Williams","UEFA","Athletic","Liga","Espagne","Ailier gauche","2002-07-12",10],
    ["victor-osimhen","Victor Osimhen","Osimhen","UEFA","Galatasaray","Süper Lig","Nigeria","Avant-centre","1998-12-29",9],
    ["lautaro-martinez","Lautaro Martínez","Lautaro","UEFA","Inter","Serie A","Argentine","Avant-centre","1997-08-22",10],
    ["rafael-leao","Rafael Leão","Leão","UEFA","Milan","Serie A","Portugal","Ailier gauche","1999-06-10",10],
    ["federico-valverde","Federico Valverde","Valverde","UEFA","Real Madrid","Liga","Uruguay","Milieu central","1998-07-22",8],
    ["jamal-musiala","Jamal Musiala","Musiala","UEFA","Bayern Munich","Bundesliga","Allemagne","Milieu offensif","2003-02-26",42],
    ["bruno-fernandes","Bruno Fernandes","B. Fernandes","UEFA","Manchester United","Premier League","Portugal","Milieu offensif","1994-09-08",8],
    ["son-heung-min","Son Heung-min","Son","AFC","Tottenham","Premier League","Corée du Sud","Ailier gauche","1992-07-08",7],
    ["kylian-simeone","Giovanni Simeone","Simeone","UEFA","Napoli","Serie A","Argentine","Avant-centre","1995-07-05",18],
  ].map(function (a) {
    return { id: a[0], name: a[1], short_name: a[2], confederation: a[3], club: a[4], league: a[5], country: a[6], position: a[7], birth_date: a[8], number: a[9] };
  });
  var byId = {}; P.forEach(function (p) { byId[p.id] = p; });

  // Cible fictive du jour (déterministe pour la démo).
  var TARGET = byId["marcus-rashford"]; // sans numéro officiel => illustre la case verte "—"

  function ageAt(bd) { if (!bd) return null; var b = new Date(bd + "T00:00:00Z"); var t = new Date("2026-08-09T12:00:00Z"); var a = t.getUTCFullYear() - b.getUTCFullYear(); var m = t.getUTCMonth() - b.getUTCMonth(); if (m < 0 || (m === 0 && t.getUTCDate() < b.getUTCDate())) a--; return a; }
  function matchStates(g, t) {
    var ga = ageAt(g.birth_date), ta = ageAt(t.birth_date), gn = g.number == null ? null : g.number, tn = t.number == null ? null : t.number;
    var eq = function (a, b) { return (a == null ? null : a) === (b == null ? null : b) ? "correct" : "wrong"; };
    var dir = function (a, b) { return a == null || b == null ? null : a < b ? "up" : a > b ? "down" : null; };
    return [
      { key: "confederation", state: eq(g.confederation, t.confederation) },
      { key: "club", state: eq(g.club, t.club) },
      { key: "league", state: eq(g.league, t.league) },
      { key: "country", state: eq(g.country, t.country) },
      { key: "position", state: eq(g.position, t.position) },
      { key: "age", state: ga != null && ta != null && ga === ta ? "correct" : "wrong", direction: dir(ga, ta) },
      { key: "number", state: gn == null && tn == null ? "correct" : gn != null && tn != null && gn === tn ? "correct" : "wrong", direction: dir(gn, tn), noOfficialNumber: gn == null },
    ];
  }
  var isWin = function (s) { return s.every(function (x) { return x.state === "correct"; }); };

  // --- État de partie (mock, en mémoire) ---
  var guesses = []; // {guess_player_id, states, is_win}
  var hintRevealed = false, status = "active";

  function reset() { guesses = []; hintRevealed = false; status = "active"; }

  // --- Profil fictif (créé côté "serveur" simulé : public_ref jamais fabriqué par identity.js) ---
  var MOCK_PROFILE = null;
  var RESERVED = /^(tomsofoot|admin|administrateur|moderateur|modérateur|mod|root|staff|support|officiel|jogadle)$/i;

  var api = {
    async getDailyPuzzle() { return { edition: 100, seasonName: "Août 2026", seasonEnd: Date.now() + ((22 * 24 + 5) * 3600 + 43 * 60 + 9) * 1000 }; },
    async ensureSession() {
      var answer = (status === "won" || status === "revealed") ? { name: TARGET.short_name || TARGET.name } : null;
      return { status: status, hint_revealed: hintRevealed, answer: answer, guesses: guesses.map(function (g) { return { guess_player_id: g.guess_player_id, states: g.states, is_win: g.is_win }; }) };
    },
    // Profil serveur (simulé) : renvoie null tant qu'aucun pseudo n'a été créé.
    async getMyProfile() { return MOCK_PROFILE; },
    async getOrCreateProfile(pseudo) {
      pseudo = String(pseudo || "").trim();
      if (RESERVED.test(pseudo) || /admin|tomsofoot|jogadle/i.test(pseudo)) return { error: "pseudo_reserved" };
      if (pseudo.toLowerCase() === "kingcarlos") return { error: "pseudo_taken" }; // démontre l'erreur d'unicité
      MOCK_PROFILE = { public_ref: "pubref-" + Date.now().toString(16), display_name: pseudo, league: "pro", rank: 15, points: 1523 };
      return MOCK_PROFILE;
    },
    // Attributs publics des joueurs déjà proposés (reprise) — jamais la cible.
    async getPlayersByIds(ids) { return (ids || []).map(function (id) { return byId[id]; }).filter(Boolean); },
    async submitGuess(id) {
      if (status !== "active") return { error: "already_finished", status: status };
      if (guesses.some(function (g) { return g.guess_player_id === id; })) return { error: "duplicate" };
      var g = byId[id]; if (!g) return { error: "unknown_player" };
      var states = matchStates(g, TARGET); var win = isWin(states);
      guesses.push({ guess_player_id: id, states: states, is_win: win });
      if (win) status = "won";
      return { position: guesses.length, states: states, isWin: win, status: status };
    },
    async revealHint() {
      var wrong = guesses.filter(function (g) { return !g.is_win && g.states.some(function (s) { return s.state === "wrong"; }); }).length;
      if (wrong < 5) return { locked: true, wrong: wrong, needed: 5 };
      hintRevealed = true;
      return { hint_revealed: true, letter: (TARGET.short_name || TARGET.name).trim().charAt(0).toUpperCase() };
    },
    async revealAnswer() {
      status = "revealed";
      var attemptsMade = guesses.length; var penalty = attemptsMade < 7 ? -10 : -5;
      return { status: "revealed", penalty: penalty, answer: { name: TARGET.short_name || TARGET.name } };
    },
    async searchPlayers(q) {
      q = (q || "").trim().toLowerCase(); if (q.length < 2) return [];
      return P.filter(function (p) { return p.name.toLowerCase().includes(q) || p.short_name.toLowerCase().includes(q); })
              .filter(function (p) { return !guesses.some(function (g) { return g.guess_player_id === p.id; }); })
              .slice(0, 6);
    },
    isGuest() { return !global.__JOGADLE_ME; },
    _reset: reset,
    hintRevealed() { return hintRevealed; },
  };

  // --- Classement fictif (pour FLIP + onglets), interface JogadleLeaderboardAPI ---
  var SEASON_END = Date.now() + ((22 * 24 + 5) * 3600 + 43 * 60 + 9) * 1000;
  var POOL = {
    ultimate: ["KingCarlos","XaviMaster","TikiGod","EliteTen","NueveReal","GentoLegend","MidVision","BernabeuBoy","CapitanoX","ProdigyR9","FalcaoFan","GoldenBoot","Maestro7","BlaugranaZ","SamouraiJP","IroncladDF","VisionPlay","LaMasiaKid","CatenaccioX","GegenLord"],
    pro: ["GoalHunter7","TikiTaka_92","BenjiDribble","Lucio_10","PasseDecisive","Footix_18","MbappeEnjoyer","VorteX_9","MidfieldMaestro","ZidaneLegacy","NeyMagic","Playmaker","DemiStyle","SkillzZ","VOUS","RookieBen","NoLuckJustPass","TacticMan","LowBlockKing","CornerFlag"],
    rookie: ["FirstTouch","GreenBoots","AcademyKid","RawTalent","BenchWarmer","CounterAtk","LongBall","ParkTheBus","SundayLeague","NutmegNoob","WingerWish","SoloRun","OffsideOops","ThrowInPro","KeeperTom","SliderTackle","HalfVolley","LateBloom","FreshLegs","TrialistX"],
    noob: ["JustStarted","OwnGoalOops","LostTheBall","AirShot","WrongWay","SlowStart","MissTheOpen","FumbleFeet","BrickWall","PanicPass","ClumsyClaude","RustyBoots","BlindPass","SnailPace","ButterHands","WhiffKing","BenchGlue","ConfusedRef","TripOver","LuckyTouch"],
  };
  var BADGES = { ultimate: { 0: "CHAMPION EN TITRE", 2: "CHAMPION LIGUE PRO", 5: "PROMU", 8: "PROMU", 11: "PROMU", 14: "PROMU" },
                 pro: { 0: "CHAMPION LIGUE ROOKIE", 4: "PROMU", 16: "RÉTROGRADÉ" },
                 rookie: { 0: "CHAMPION LIGUE NOOB", 3: "PROMU", 18: "RÉTROGRADÉ" },
                 noob: { 2: "PROMU", 9: "PROMU", 17: "RÉTROGRADÉ" } };
  var BASE = { ultimate: 2650, pro: 1842, rookie: 1180, noob: 640 };
  var STATE = {};
  Object.keys(POOL).forEach(function (lg) {
    STATE[lg] = POOL[lg].map(function (name, i) {
      return { user_id: lg + "-" + i, public_ref: lg + "-ref-" + i, display_name: name, points: BASE[lg] - i * 34 - (i % 4) * 7, prevRank: i + 1, evolution: 0, active_badge_label: (BADGES[lg] && BADGES[lg][i]) || null, isMe: (lg === "pro" && name === "VOUS") };
    });
  });
  function snapshot(lg) {
    var rows = STATE[lg].slice().sort(function (a, b) { return b.points - a.points; });
    return rows.map(function (r) { return { user_id: r.user_id, public_ref: r.public_ref, display_name: r.display_name, points: r.points, evolution: r.evolution, active_badge_label: r.active_badge_label, isMe: r.isMe }; });
  }
  global.JogadleLeaderboardAPI = {
    getLeague: function (lg) {
      var rows = snapshot(lg);
      var me = rows.find(function (r) { return r.isMe; });
      return Promise.resolve({ rows: rows, myUserId: me ? me.user_id : null, seasonName: "Août 2026", seasonEnd: SEASON_END, seasonLeft: "22 j 05 h", unranked: { rank: 37, points: 890, gapToTop20: 62 } });
    },
    subscribe: function (onChange) {
      var t = setInterval(function () {
        Object.keys(POOL).forEach(function (lg) {
          var arr = STATE[lg]; var before = arr.slice().sort(function (a, b) { return b.points - a.points; });
          before.forEach(function (r, i) { r.prevRank = i + 1; });
          for (var k = 0; k < 3; k++) { var idx = Math.floor(Math.random() * arr.length); arr[idx].points += Math.round((Math.random() - 0.45) * 40); if (arr[idx].points < 0) arr[idx].points = 0; }
          var after = arr.slice().sort(function (a, b) { return b.points - a.points; });
          after.forEach(function (r, i) { r.evolution = (r.prevRank || i + 1) - (i + 1); });
        });
        onChange();
      }, 2600);
      return function () { clearInterval(t); };
    },
  };

  global.JogadleMock = api;
})(window);
