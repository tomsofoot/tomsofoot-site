// netlify/functions/x-oauth-start.mjs
// Démarre la connexion OAuth 2.0 (PKCE) du compte X. ADMIN uniquement.
// Renvoie { url } : la régie redirige l'admin vers X. Aucun secret exposé.

import crypto from 'node:crypto';
import { requireAdmin, sbAdmin, json, X_CLIENT_ID, X_SCOPES } from './lib/x-core.mjs';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export default async (req) => {
  try {
    await requireAdmin(req);
    if (!X_CLIENT_ID) return json(500, { ok: false, error: 'config', message: 'X_CLIENT_ID non configuré côté serveur.' });

    const origin = new URL(req.url).origin;
    const redirectUri = origin + '/.netlify/functions/x-oauth-callback';

    const codeVerifier = b64url(crypto.randomBytes(48));
    const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = b64url(crypto.randomBytes(20));

    // On stocke l'état PKCE côté serveur (service_role, jamais exposé au navigateur).
    await sbAdmin('x_oauth_state', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { state, code_verifier: codeVerifier, redirect_uri: redirectUri },
    });

    const authorize = new URL('https://twitter.com/i/oauth2/authorize');
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', X_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('scope', X_SCOPES);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', codeChallenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    return json(200, { ok: true, url: authorize.toString(), redirect_uri: redirectUri });
  } catch (e) {
    const status = e.status || 500;
    return json(status, { ok: false, error: status === 403 ? 'not_admin' : status === 401 ? 'no_token' : 'error' });
  }
};
