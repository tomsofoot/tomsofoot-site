// netlify/lib/x-worker.mjs
// Moteur de l'automatisation X : réconciliation + envoi des tâches dues.
// Séparé nettement : lecture de l'article → génération du texte → média → post → résultat.
// DRY RUN par défaut : aucune publication réelle, aucun crédit consommé.

import {
  sbAdmin, decrypt, encrypt, buildPost, canonicalUrl, FALLBACK_SOCIAL_IMAGE,
  DRY_RUN, weightedLength,
  xRefreshToken, xUploadMedia, xCreatePost,
} from './x-core.mjs';

const nowISO = () => new Date().toISOString();
const BACKOFF_MIN = [2, 5];   // délai progressif entre tentatives (minutes) ; 3 tentatives max
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Réconciliation : enqueue les articles DEVENUS publiés récemment sans tâche.
// Fenêtre courte (25 min) → ne « rattrape » jamais l'archive, uniquement le neuf.
// (Le trigger DB couvre la publication directe ; ceci couvre la publication programmée.)
// ---------------------------------------------------------------------------
export async function reconcile() {
  const since = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const arts = await sbAdmin(
    'articles?status=eq.published&published_at=gte.' + since +
    '&published_at=lte.' + nowISO() + '&select=id,published_at&order=published_at.desc&limit=50'
  );
  if (!Array.isArray(arts) || !arts.length) return { enqueued: 0 };
  const settings = await getSettings();
  let n = 0;
  for (const a of arts) {
    const exists = await sbAdmin('social_posts?article_id=eq.' + a.id + '&platform=eq.x&select=id&limit=1');
    if (Array.isArray(exists) && exists.length) continue;
    const scheduledAt = new Date(new Date(a.published_at).getTime() + settings.delay_minutes * 60000).toISOString();
    try {
      await sbAdmin('social_posts', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
        body: { article_id: a.id, platform: 'x', status: 'scheduled', scheduled_at: scheduledAt },
      });
      n++;
    } catch { /* doublon → ignoré (contrainte d'unicité) */ }
  }
  return { enqueued: n };
}

async function getSettings() {
  const rows = await sbAdmin('social_settings?id=eq.true&select=x_enabled,delay_minutes');
  return (Array.isArray(rows) && rows[0]) || { x_enabled: false, delay_minutes: 10 };
}
async function getAccount() {
  const rows = await sbAdmin('x_account?id=eq.true&select=*');
  return (Array.isArray(rows) && rows[0]) || null;
}

// ---------------------------------------------------------------------------
// Traite toutes les tâches dues (scheduled & scheduled_at <= now)
// ---------------------------------------------------------------------------
export async function processDue(limit = 5) {
  const due = await sbAdmin(
    'social_posts?status=eq.scheduled&scheduled_at=lte.' + nowISO() +
    '&select=id&order=scheduled_at.asc&limit=' + limit
  );
  const results = [];
  if (Array.isArray(due)) for (const row of due) results.push(await processOne(row.id));
  return results;
}

// ---------------------------------------------------------------------------
// Traite UNE tâche. Verrou optimiste = idempotence (jamais deux envois).
// ---------------------------------------------------------------------------
export async function processOne(id) {
  // Verrou : passe scheduled → processing SEULEMENT si encore 'scheduled'.
  const locked = await sbAdmin(
    'social_posts?id=eq.' + id + '&status=eq.scheduled',
    { method: 'PATCH', prefer: 'return=representation', body: { status: 'processing' } }
  );
  if (!Array.isArray(locked) || !locked.length) return { id, skipped: 'not_lockable' }; // déjà pris/traité
  const post = locked[0];

  try {
    // Dernière version PUBLIÉE de l'article (jamais une copie figée)
    const arts = await sbAdmin('articles?id=eq.' + post.article_id +
      '&select=id,slug,title,deck,hero_image,og_image,status,published_at');
    const a = Array.isArray(arts) && arts[0];

    // Garde-fous : supprimé / dépublié / pas encore public
    if (!a) return await finalize(post, 'cancelled', { last_error: 'Article introuvable (supprimé)' });
    const isPublic = a.status === 'published' && a.published_at && new Date(a.published_at) <= new Date();
    if (!isPublic) return await finalize(post, 'cancelled', { last_error: 'Article non public au moment de l\'envoi (' + a.status + ')' });

    const settings = await getSettings();

    // Construit le texte (comptage pondéré) + choisit l'image publique réelle
    const url = canonicalUrl(a.slug);
    const built = buildPost({ title: a.title, deck: a.deck, url });
    const imageUrl = a.og_image || a.hero_image || FALLBACK_SOCIAL_IMAGE;
    const preview = { text: built.text, weighted: built.weighted, image: imageUrl, alt: a.title, url };

    // Interrupteur global coupé → on n'envoie pas (la tâche reste en attente)
    if (!settings.x_enabled) {
      await sbAdmin('social_posts?id=eq.' + id, { method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'scheduled', preview, last_error: 'Automatisation X désactivée — en attente' } });
      return { id, skipped: 'disabled' };
    }

    // ---- MODE SIMULATION : aucune publication réelle, aucun crédit ----
    const account = await getAccount();
    if (DRY_RUN || !account || account.status !== 'connected') {
      const reason = DRY_RUN ? 'DRY RUN' : 'compte X non connecté';
      return await finalize(post, 'published', {
        dry_run: true, published_at: nowISO(), x_post_id: 'SIMULATION',
        x_post_url: null, preview: { ...preview, simulated: true, reason },
        last_error: null,
      });
    }

    // ---- ENVOI RÉEL ----
    let accessToken = decrypt(account.access_token_enc);
    // Renouvellement si le jeton est (bientôt) expiré
    if (!account.token_expires_at || new Date(account.token_expires_at) <= new Date(Date.now() + 30000)) {
      const refresh = decrypt(account.refresh_token_enc);
      if (!refresh) return await failAccount(post, 'Reconnexion nécessaire (pas de refresh token)');
      let t;
      try { t = await xRefreshToken(refresh); }
      catch (e) { return await failAccount(post, 'Reconnexion nécessaire (refresh refusé)'); }
      accessToken = t.access_token;
      await sbAdmin('x_account?id=eq.true', { method: 'PATCH', prefer: 'return=minimal', body: {
        access_token_enc: encrypt(t.access_token),
        refresh_token_enc: t.refresh_token ? encrypt(t.refresh_token) : account.refresh_token_enc,
        token_expires_at: t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString() : null,
        status: 'connected',
      }});
    }

    // Média : image publique réelle (repli image sociale officielle si indisponible)
    let mediaId = null;
    try {
      let ir = await fetch(imageUrl);
      if (!ir.ok && imageUrl !== FALLBACK_SOCIAL_IMAGE) ir = await fetch(FALLBACK_SOCIAL_IMAGE);
      if (!ir.ok) throw new Error('image_unreachable');
      const mime = ir.headers.get('content-type') || 'image/jpeg';
      const bytes = Buffer.from(await ir.arrayBuffer());
      mediaId = await xUploadMedia(accessToken, bytes, mime);
    } catch (e) {
      return await retryOrFail(post, 'Image indisponible : ' + (e.message || 'inconnue'));
    }

    // Publication
    let created;
    try { created = await xCreatePost(accessToken, built.text, mediaId, a.title); }
    catch (e) {
      const st = e.status;
      if (st === 401 || st === 403) return await failAccount(post, 'Autorisation X invalide/révoquée');
      if (st === 402 || st === 429) return await retryOrFail(post, 'Crédit/limite X : ' + st);
      return await retryOrFail(post, 'Échec publication X (' + (st || '?') + ')');
    }

    const handle = account.username ? '@' + account.username : 'i';
    const xUrl = 'https://x.com/' + (account.username || 'i') + '/status/' + created.id;
    return await finalize(post, 'published', {
      dry_run: false, published_at: nowISO(), x_post_id: created.id, x_post_url: xUrl,
      preview: { ...preview, handle }, last_error: null,
    });
  } catch (e) {
    return await retryOrFail(post, 'Erreur interne : ' + (e.message || 'inconnue'));
  }
}

async function finalize(post, status, extra) {
  await sbAdmin('social_posts?id=eq.' + post.id, { method: 'PATCH', prefer: 'return=minimal',
    body: { status, ...extra } });
  return { id: post.id, status, ...(extra && extra.dry_run ? { dry_run: true } : {}) };
}

// Échec avec tentatives à délai progressif (max 3), puis 'failed'.
async function retryOrFail(post, message) {
  const attempts = (post.attempt_count || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return await finalize(post, 'failed', { attempt_count: attempts, last_error: message });
  }
  const delay = BACKOFF_MIN[attempts - 1] || 5;
  return await finalize(post, 'scheduled', {
    attempt_count: attempts, last_error: message,
    scheduled_at: new Date(Date.now() + delay * 60000).toISOString(),
  });
}

// Autorisation révoquée/expirée : on arrête (pas de retry) et on signale la reconnexion.
async function failAccount(post, message) {
  try { await sbAdmin('x_account?id=eq.true', { method: 'PATCH', prefer: 'return=minimal', body: { status: 'reconnect_needed' } }); } catch {}
  return await finalize(post, 'failed', { attempt_count: (post.attempt_count || 0) + 1, last_error: message });
}
