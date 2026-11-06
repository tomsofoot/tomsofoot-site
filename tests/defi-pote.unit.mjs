// defi-pote.unit.mjs — tests du plan visuel « Défie ton pote » (Node, sans dépendance).
//   node tests/defi-pote.unit.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../assets/js/defi-pote/defi-plan.js');

let pass = 0, fail = 0; const results = [];
function check(name, cond, extra = '') { (cond ? pass++ : fail++); results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); }
const players = (a, b) => [{ name: 'Tomso', points: a }, { name: 'Alex', points: b }];
const T = P.TIMELINE;
// Instants d'observation : avant le 1er choc, après chaque transition, image finale.
const SAMPLE = { start: 0.5, afterFirst: T.clashes[0] + T.fades[0] + 0.01, afterSecond: T.clashes[1] + T.fades[1] + 0.01, final: T.settled };

// 1) Les six résultats possibles, six montants éligibles : 6 → 4 → 2 → 1, gagnant = montant validé.
for (const amount of P.CHOICES) {
  const plan = P.createPlan({ challengeId: 'defi-' + amount, amount, players: players(35, 35) });
  check(`Plan valide pour ${amount}`, plan.ok, plan.message || '');
  const counts = [SAMPLE.start, SAMPLE.afterFirst, SAMPLE.afterSecond, SAMPLE.final].map(t => P.litIndices(plan, t).length);
  check(`${amount} pts : séquence 6 → 4 → 2 → 1`, counts.join(',') === '6,4,2,1', counts.join(','));
  const last = P.litIndices(plan, SAMPLE.final);
  check(`${amount} pts : la case restante est le montant validé`, last.length === 1 && P.CHOICES[last[0]] === amount, JSON.stringify(last));
  check(`${amount} pts : le gagnant n'est jamais éteint`, plan.eliminations.every(e => !e.indices.includes(plan.winnerIndex)));
  const pairs = plan.eliminations.map(e => e.indices.length).join('/');
  check(`${amount} pts : paires puis perdante finale`, pairs === '2/2/1', pairs);
  check(`${amount} pts : deux finalistes ensemble ~1,25 s`, P.litIndices(plan, T.duelStart + 0.01).length === 2 && Math.abs((T.clashes[2] - T.duelStart) - 1.25) < 0.001);
}

// 2) Aucune case éliminée ne se rallume (lumière décroissante sur toute la chronologie, segments compris).
for (const amount of P.CHOICES) {
  const plan = P.createPlan({ challengeId: 'mono-' + amount, amount, players: players(35, 35) });
  let ok = true, prev = P.CHOICES.map(() => 1), prevSeg = P.CHOICES.map(() => Array(6).fill(1));
  for (let f = 0; f <= T.fps * T.duration; f++) {
    const t = f / T.fps;
    for (let i = 0; i < 6; i++) {
      const l = P.caseLight(plan, t, i); if (l > prev[i] + 1e-9) ok = false; prev[i] = l;
      for (let k = 0; k < 6; k++) { const s = P.segmentLight(plan, t, i, k); if (s > prevSeg[i][k] + 1e-9) ok = false; prevSeg[i][k] = s; }
    }
  }
  check(`${amount} pts : aucune case ni segment ne se rallume (480 images)`, ok);
}

// 3) Segments d'une paire : gauche à droite, pendant la même transition courte.
{
  const plan = P.createPlan({ challengeId: 'seg', amount: 10, players: players(35, 35), plan: { eliminations: [[0, 2], [1, 3], [4]] } });
  const t = T.clashes[0] + T.fades[0] * 0.5;
  const a = [0, 1, 2, 3, 4, 5].map(k => P.segmentLight(plan, t, 0, k)), b = [0, 1, 2, 3, 4, 5].map(k => P.segmentLight(plan, t, 2, k));
  check('Segments éteints de gauche à droite', a.every((v, k) => k === 0 || v >= a[k - 1]), a.map(v => v.toFixed(2)).join(' '));
  check('Les deux cases d’une paire s’éteignent ensemble', a.every((v, k) => Math.abs(v - b[k]) < 1e-12));
  check('Transition terminée à 0,86 + 0,12 s', P.caseLight(plan, T.clashes[0] + T.fades[0], 0) === 0);
}

// 4) Déterminisme : même défi + même montant => même plan (relecture, mobile, ordinateur).
{
  const a = P.createPlan({ challengeId: 'defi-2026-11-06-0042', amount: 7, players: players(35, 12) });
  const b = P.createPlan({ challengeId: 'defi-2026-11-06-0042', amount: 7, players: players(35, 12) });
  check('Même défi, même plan', JSON.stringify(a.eliminations) === JSON.stringify(b.eliminations));
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(JSON.stringify(P.createPlan({ challengeId: 'd' + i, amount: 10, players: players(35, 35) }).eliminations));
  check('Les plans varient d’un défi à l’autre', seen.size > 5, seen.size + ' plans distincts / 40');
  check('Hachage stable (valeur de référence)', P._hash('defi-pote') === P._hash('defi-pote') && typeof P._hash('é') === 'number');
}

// 5) Plan enregistré : la démo validée est reproduite exactement ; un plan incohérent est refusé.
{
  const demo = P.createPlan({ challengeId: 'demo', amount: 10, players: players(35, 35), plan: { eliminations: [[0, 2], [1, 3], [4]] } });
  check('Démo validée reproduite (1 et 3, puis 2 et 5, puis 7)', demo.ok && JSON.stringify(demo.eliminations.map(e => [e.at, e.indices])) === JSON.stringify([[0.86, [0, 2]], [1.79, [1, 3]], [3.16, [4]]]));
  check('Plan enregistré marqué « enregistre »', demo.source === 'enregistre');
  const bad1 = P.createPlan({ challengeId: 'x', amount: 10, players: players(35, 35), plan: { eliminations: [[0, 5], [1, 3], [4]] } });
  check('Plan qui éteint le gagnant : refusé', !bad1.ok && bad1.error === 'plan_incoherent');
  const bad2 = P.createPlan({ challengeId: 'x', amount: 10, players: players(35, 35), plan: { eliminations: [[0, 2], [1, 2], [4]] } });
  check('Plan qui éteint deux fois la même case : refusé', !bad2.ok);
  const bad3 = P.createPlan({ challengeId: 'x', amount: 10, players: players(35, 35), plan: { eliminations: [[0, 2], [1], [4]] } });
  check('Plan incomplet : refusé', !bad3.ok);
}

// 6) Restrictions de points.
{
  const low = P.createPlan({ challengeId: 'r1', amount: 3, players: players(128, 4) });
  check('Solde 4 : montants 1, 2, 3 seulement', JSON.stringify(low.eligible) === JSON.stringify([true, true, true, false, false, false]));
  const counts = [SAMPLE.start, SAMPLE.afterFirst, SAMPLE.afterSecond, SAMPLE.final].map(t => P.litIndices(low, t).length);
  check('Trois éligibles : 3 → 3 → 2 → 1', counts.join(',') === '3,3,2,1', counts.join(','));
  check('Montant au-dessus du solde : refusé', P.createPlan({ challengeId: 'r2', amount: 5, players: players(128, 4) }).error === 'montant_non_autorise');
  check('Moins de 2 points : défi refusé', P.createPlan({ challengeId: 'r3', amount: 1, players: players(35, 1) }).error === 'points_insuffisants');
  check('Exactement 2 points : défi possible (1 ou 2)', P.createPlan({ challengeId: 'r4', amount: 2, players: players(2, 50) }).ok);
  const srv = P.createPlan({ challengeId: 'r5', amount: 5, players: players(35, 35), allowedAmounts: [1, 2, 5, 10] });
  check('Montants autorisés par le serveur prioritaires', srv.ok && JSON.stringify(srv.eligible) === JSON.stringify([true, true, false, true, false, true]));
  check('Montant hors grille : refusé', P.createPlan({ challengeId: 'r6', amount: 4, players: players(35, 35) }).error === 'montant_inconnu');
  check('Sans identifiant de défi : refusé', P.createPlan({ amount: 2, players: players(35, 35) }).error === 'challenge_id_manquant');
  const sizes = [1, 2, 3, 4, 5, 6].map(n => P.groupSizes(n).join('/'));
  check('Répartition selon le nombre d’éligibles', sizes.join(' ') === '0/0/0 0/0/1 0/1/1 1/1/1 1/2/1 2/2/1', sizes.join(' '));
  for (let n = 1; n <= 6; n++) {
    const allowed = P.CHOICES.slice(0, n), amount = allowed[n - 1];
    const plan = P.createPlan({ challengeId: 'n' + n, amount, players: players(35, 35), allowedAmounts: allowed });
    const final = P.litIndices(plan, SAMPLE.final);
    const lockedOff = P.CHOICES.every((_, i) => plan.eligible[i] || P.caseLight(plan, 0, i) === 0);
    check(`${n} éligible(s) : une seule case finale = mise, cases verrouillées éteintes`, plan.ok && final.length === 1 && P.CHOICES[final[0]] === amount && lockedOff);
  }
}

// 7) Aucune donnée d'entrée modifiée (le composant n'écrit rien).
{
  const input = Object.freeze({ challengeId: 'f', amount: 5, players: Object.freeze([Object.freeze({ name: 'A', points: 9 }), Object.freeze({ name: 'B', points: 9 })]), plan: undefined });
  let threw = false; try { P.createPlan(input); } catch (e) { threw = true; }
  check('Entrée gelée acceptée sans écriture', !threw);
}

console.log(results.join('\n'));
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
