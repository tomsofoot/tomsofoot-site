// netlify/functions/x-account.mjs
// État du compte X + réglages, pour la régie. ADMIN uniquement.
// Ne renvoie JAMAIS de jeton (lecture via la vue x_account_public, sans jetons).

import { requireAdmin, sbAdmin, json, DRY_RUN, X_CLIENT_ID, SERVICE_ROLE } from './lib/x-core.mjs';

export default async (req) => {
  let admin;
  try { admin = await requireAdmin(req); }
  catch (e) { return json(e.status || 401, { ok: false, error: e.message }); }

  try {
    if (req.method === 'GET') {
      const acc = await sbAdmin('x_account_public?select=*');
      const set = await sbAdmin('social_settings?id=eq.true&select=x_enabled,delay_minutes,last_enqueue_error,last_enqueue_error_at');
      return json(200, {
        ok: true,
        account: (Array.isArray(acc) && acc[0]) || { status: 'disconnected' },
        settings: (Array.isArray(set) && set[0]) || { x_enabled: false, delay_minutes: 10 },
        config: {
          dry_run: DRY_RUN,
          has_client_id: !!X_CLIENT_ID,
          has_service_role: !!SERVICE_ROLE,
          has_enc_key: !!process.env.X_TOKEN_ENC_KEY,
        },
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const action = body.action;

      if (action === 'toggle') {
        await sbAdmin('social_settings?id=eq.true', { method: 'PATCH', prefer: 'return=minimal',
          body: { x_enabled: !!body.enabled } });
        return json(200, { ok: true, x_enabled: !!body.enabled });
      }
      if (action === 'set_delay') {
        const d = Math.max(0, Math.min(1440, parseInt(body.delay_minutes, 10) || 10));
        await sbAdmin('social_settings?id=eq.true', { method: 'PATCH', prefer: 'return=minimal',
          body: { delay_minutes: d } });
        return json(200, { ok: true, delay_minutes: d });
      }
      if (action === 'disconnect') {
        await sbAdmin('x_account?id=eq.true', { method: 'PATCH', prefer: 'return=minimal', body: {
          access_token_enc: null, refresh_token_enc: null, token_expires_at: null,
          x_user_id: null, username: null, name: null, avatar_url: null, scopes: null,
          status: 'disconnected', connected_at: null,
        }});
        return json(200, { ok: true, status: 'disconnected' });
      }
      return json(400, { ok: false, error: 'unknown_action' });
    }

    return json(405, { ok: false, error: 'method' });
  } catch (e) {
    return json(500, { ok: false, error: 'server', message: e.message });
  }
};
