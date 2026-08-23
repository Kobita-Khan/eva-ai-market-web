import { createHash, randomBytes } from 'node:crypto';
import { json, requireUser, serviceRequest } from '../_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const walletResponse = await serviceRequest(ctx, `wallets?user_id=eq.${ctx.user.id}&select=balance_usd`);
  const wallets = await walletResponse.json().catch(() => []);
  if (!walletResponse.ok || !wallets[0]) return json(res, 400, { error: 'Customer wallet not found.' });
  if (Number(wallets[0].balance_usd) < 0.05) {
    return json(res, 402, { error: 'Add approved credits before creating an API key.' });
  }

  const countResponse = await serviceRequest(ctx, `api_keys?user_id=eq.${ctx.user.id}&status=eq.active&select=id`, {
    headers: { Prefer: 'count=exact' }
  });
  const activeKeys = await countResponse.json().catch(() => []);
  if (!countResponse.ok) return json(res, 502, { error: 'Could not check existing keys.' });
  if (activeKeys.length >= 3) return json(res, 409, { error: 'Maximum 3 active keys per account.' });

  const secret = `eva_live_${randomBytes(24).toString('base64url')}`;
  const keyHash = createHash('sha256').update(secret).digest('hex');
  const keyPrefix = secret.slice(0, 14);
  const name = String(req.body?.name || 'Gemini key').trim().slice(0, 60) || 'Gemini key';

  const response = await serviceRequest(ctx, 'api_keys', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: ctx.user.id,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name,
      status: 'active'
    })
  });
  const result = await response.json().catch(() => []);
  if (!response.ok) return json(res, 400, { error: result.message || 'Could not create API key.' });

  return json(res, 201, {
    apiKey: secret,
    id: result[0]?.id,
    prefix: keyPrefix,
    warning: 'Copy this key now. It will not be shown again.'
  });
}
