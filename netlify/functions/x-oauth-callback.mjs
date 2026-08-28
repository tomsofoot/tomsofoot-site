// netlify/functions/x-oauth-callback.mjs
// Retour de X après autorisation OAuth 2.0. Échange le code contre les jetons,
// les CHIFFRE, enregistre le compte, puis redirige vers la régie.
// Les jetons ne transitent jamais par le navigateur.

import { sbAdmin, encrypt, redirect, json, X_CLIENT_ID, X_CLIENT_SECRET } from './lib/x-core.mjs';

const back = (origin, params) => redirect(origin + '/regie-x.html?' + new URLSearchParams(params).toString());

export default async (req) => {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  if (err) return back(origin, { x: 'error', reason: err });
  if (!code || !state) return back(origin, { x: 'error', reason: 'missing_code' });

  try {
    // Récupère et consomme l'état PKCE (une seule fois)
    const rows = await sbAdmin('x_oauth_state?state=eq.' + encodeURIComponent(state) + '&select=*');
    const st = Array.isArray(rows) && rows[0];
    if (!st) return back(origin, { x: 'error', reason: 'state' });
    await sbAdmin('x_oauth_state?state=eq.' + encodeURIComponent(state), { method: 'DELETE' });

    // Échange code → jetons
    const basic = Buffer.from(X_CLIENT_ID + ':' + X_CLIENT_SECRET).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: st.redirect_uri,
      code_verifier: st.code_verifier,
      client_id: X_CLIENT_ID,
    });
    const tr = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + basic },
      body,
    });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) return back(origin, { x: 'error', reason: 'token_exchange' });

    // Profil du compte connecté
    let me = {};
    try {
      const ur = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name', {
        headers: { authorization: 'Bearer ' + tok.access_token },
      });
      const uj = await ur.json().catch(() => ({}));
      me = (uj && uj.data) || {};
    } catch { /* profil facultatif */ }

    const expiresAt = tok.expires_in ? new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString() : null;

    await sbAdmin('x_account?id=eq.true', {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        x_user_id: me.id || null,
        username: me.username || null,
        name: me.name || null,
        avatar_url: me.profile_image_url || null,
        scopes: tok.scope || null,
        access_token_enc: encrypt(tok.access_token),
        refresh_token_enc: tok.refresh_token ? encrypt(tok.refresh_token) : null,
        token_expires_at: expiresAt,
        status: 'connected',
        connected_at: new Date().toISOString(),
      },
    });

    return back(origin, { x: 'connected' });
  } catch (e) {
    return back(origin, { x: 'error', reason: 'server' });
  }
};
