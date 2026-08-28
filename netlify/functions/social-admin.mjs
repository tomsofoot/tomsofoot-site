// netlify/functions/social-admin.mjs
// Historique + actions par article (annuler, réessayer, publier maintenant). ADMIN uniquement.

import { requireAdmin, sbAdmin, json, DRY_RUN } from './lib/x-core.mjs';
import { processOne, reconcile, processDue } from './lib/x-worker.mjs';

const nowISO = () => new Date().toISOString();

export default async (req) => {
  try { await requireAdmin(req); }
  catch (e) { return json(e.status || 401, { ok: false, error: e.message }); }

  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      const articleId = url.searchParams.get('article_id');
      if (articleId) {
        const rows = await sbAdmin('social_posts?article_id=eq.' + articleId + '&platform=eq.x&select=*&limit=1');
        return json(200, { ok: true, post: (Array.isArray(rows) && rows[0]) || null });
      }
      // Historique : tâches + titre/slug de l'article
      const rows = await sbAdmin('social_posts?select=*,articles(title,slug)&order=created_at.desc&limit=100');
      return json(200, { ok: true, posts: Array.isArray(rows) ? rows : [] });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));

      if (body.action === 'run_worker') {
        // Déclencheur admin du worker (utile en Deploy Preview où le planificateur ne tourne pas).
        const reconciled = await reconcile();
        const processed = await processDue(20);
        return json(200, { ok: true, dry_run: DRY_RUN, reconciled, processed });
      }

      const id = body.id;
      if (!id) return json(400, { ok: false, error: 'missing_id' });

      if (body.action === 'cancel') {
        const r = await sbAdmin('social_posts?id=eq.' + id + '&status=in.(scheduled,failed)',
          { method: 'PATCH', prefer: 'return=representation', body: { status: 'cancelled', last_error: 'Annulé manuellement' } });
        return json(200, { ok: true, post: Array.isArray(r) ? r[0] : null });
      }

      if (body.action === 'retry') {
        const r = await sbAdmin('social_posts?id=eq.' + id + '&status=in.(failed,cancelled)',
          { method: 'PATCH', prefer: 'return=representation',
            body: { status: 'scheduled', scheduled_at: nowISO(), last_error: null } });
        return json(200, { ok: true, post: Array.isArray(r) ? r[0] : null });
      }

      if (body.action === 'publish_now') {
        // Réservé admin : force l'échéance à maintenant puis traite immédiatement.
        await sbAdmin('social_posts?id=eq.' + id + '&status=in.(scheduled,failed,cancelled)',
          { method: 'PATCH', prefer: 'return=minimal', body: { status: 'scheduled', scheduled_at: nowISO(), last_error: null } });
        const result = await processOne(id);
        const rows = await sbAdmin('social_posts?id=eq.' + id + '&select=*&limit=1');
        return json(200, { ok: true, result, post: (Array.isArray(rows) && rows[0]) || null });
      }

      return json(400, { ok: false, error: 'unknown_action' });
    }

    return json(405, { ok: false, error: 'method' });
  } catch (e) {
    return json(500, { ok: false, error: 'server', message: e.message });
  }
};
