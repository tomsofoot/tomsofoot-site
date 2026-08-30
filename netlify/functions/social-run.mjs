// netlify/functions/social-run.mjs
// Déclencheur MANUEL sécurisé du worker (pour le Deploy Preview, où les fonctions
// planifiées ne s'exécutent pas). Protégé par SOCIAL_WORKER_SECRET. Aucun secret renvoyé.

import { reconcile, processDue } from './lib/x-worker.mjs';
import { json, DRY_RUN } from './lib/x-core.mjs';

export default async (req) => {
  const secret = process.env.SOCIAL_WORKER_SECRET || '';
  const key = new URL(req.url).searchParams.get('key') || req.headers.get('x-worker-key') || '';
  if (!secret || key !== secret) return json(401, { ok: false, error: 'unauthorized' });

  try {
    const reconciled = await reconcile();
    const processed = await processDue(20);
    return json(200, { ok: true, dry_run: DRY_RUN, reconciled, processed });
  } catch (e) {
    return json(500, { ok: false, error: 'run_failed', message: e.message });
  }
};
