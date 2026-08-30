// netlify/functions/social-worker.mjs
// Fonction PLANIFIÉE (chaque minute) : réconcilie puis envoie les tâches dues.
// En production, Netlify empêche l'invocation manuelle : seul le planificateur l'exécute.
// (Pour le Deploy Preview, utiliser social-run avec SOCIAL_WORKER_SECRET.)

import { reconcile, processDue } from './lib/x-worker.mjs';

export default async () => {
  try {
    await reconcile();
    await processDue(10);
  } catch (e) { /* jamais throw : le planificateur ne doit pas boucler en erreur */ }
  return new Response('ok');
};

export const config = { schedule: '* * * * *' };
