import { json, requireUser, serviceRequest } from '../_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const response = await serviceRequest(
    ctx,
    `api_keys?user_id=eq.${ctx.user.id}&status=eq.active`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'revoked' })
    }
  );
  const keys = await response.json().catch(() => []);
  if (!response.ok) return json(res, 400, { error: keys.message || 'Could not reset API keys.' });

  return json(res, 200, { revoked: Array.isArray(keys) ? keys.length : 0 });
}
