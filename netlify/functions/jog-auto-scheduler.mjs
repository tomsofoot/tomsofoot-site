// netlify/functions/jog-auto-scheduler.mjs
// Régie automatisée — PLANIFICATEUR (Netlify Scheduled Function).
//
// À chaque tick (voir netlify.toml), lit jog_auto_schedules actifs dont next_run_at <= maintenant,
// crée le lot correspondant (planifie) + ses items depuis jog_clubs, puis calcule la prochaine
// exécution selon le type de répétition. Fuseau de référence : Europe/Paris (les horaires sont
// stockés en timestamptz ; le calcul de « prochaine exécution » gère l'heure locale).
//
// SÉCURITÉ : écritures via service_role (fail-closed : jamais en contexte ≠ production).
// Aucune analyse n'est appliquée : le planificateur ne fait que CRÉER des lots à analyser.

import { sbAdmin } from './lib/x-core.mjs';

export const config = { schedule: '@hourly' }; // tick horaire (Netlify Scheduled Function)

function addMonthsUTC(d, m) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; }
// Prochaine exécution selon le type de répétition (approximation robuste, recalculée à chaque tick).
function nextRun(sched, from) {
  const base = from || new Date();
  switch (sched.repeat_type) {
    case 'yearly': return addMonthsUTC(base, 12);
    case 'winter': { const y = base.getUTCFullYear() + (base.getUTCMonth() >= 1 ? 1 : 0); return new Date(Date.UTC(y, 1, 2, 9, 0)); } // ~2 févr.
    case 'summer': { const y = base.getUTCFullYear() + (base.getUTCMonth() >= 8 ? 1 : 0); return new Date(Date.UTC(y, 8, 2, 9, 0)); } // ~2 sept.
    case 'after_each_mercato': return null; // piloté par delay_hours + dates de mercato (config)
    case 'once': default: return null;      // une seule fois : pas de prochaine
  }
}

export default async () => {
  const now = new Date().toISOString();
  let due = [];
  try {
    due = await sbAdmin(`jog_auto_schedules?active=eq.true&next_run_at=lte.${now}&select=*`) || [];
  } catch (e) {
    return new Response(JSON.stringify({ error: 'db', message: String(e.message || e) }), { status: e.status || 502 });
  }

  const created = [];
  for (const s of due) {
    try {
      const season = (s.config && s.config.season) || new Date().getUTCFullYear();
      const inList = (s.leagues || []).map(l => encodeURIComponent(l)).join(',');
      if (!inList) continue;
      const clubs = await sbAdmin(`jog_clubs?active=eq.true&apisports_team_id=not.is.null&league=in.(${inList})&select=canonical_name,league,apisports_team_id`) || [];
      const idem = 'sched:' + s.id + ':' + new Date().toISOString().slice(0, 10);
      const exist = await sbAdmin(`jog_auto_batches?idem_key=eq.${encodeURIComponent(idem)}&select=id`);
      let batchId = exist && exist[0] && exist[0].id;
      if (!batchId && clubs.length) {
        const b = await sbAdmin('jog_auto_batches', { method: 'POST', prefer: 'return=representation',
          body: { name: s.name || 'Analyse planifiée', season, source: 'api-sports', leagues: s.leagues, status: 'planifie', idem_key: idem } });
        batchId = b && b[0] && b[0].id;
        if (batchId) {
          await sbAdmin('jog_auto_batch_items', { method: 'POST', prefer: 'return=minimal',
            body: clubs.map(c => ({ batch_id: batchId, apisports_team_id: c.apisports_team_id, club_name: c.canonical_name, league: c.league, status: 'planifie' })) });
        }
      }
      // avancer la planification
      const nr = nextRun(s, new Date());
      await sbAdmin(`jog_auto_schedules?id=eq.${s.id}`, { method: 'PATCH',
        body: { next_run_at: nr ? nr.toISOString() : null, active: nr ? true : false, updated_at: now } });
      created.push({ schedule: s.id, batch: batchId, clubs: clubs.length });
    } catch (e) { /* on continue les autres planifications */ }
  }
  return new Response(JSON.stringify({ ok: true, due: due.length, created }), { status: 200, headers: { 'content-type': 'application/json' } });
};
