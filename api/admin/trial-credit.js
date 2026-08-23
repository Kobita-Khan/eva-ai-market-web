import { json, requireAdmin, serviceRequest } from '../_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'Enter a valid customer email.' });
  }

  const encodedEmail = encodeURIComponent(email);
  const profileResponse = await serviceRequest(ctx, `profiles?email=eq.${encodedEmail}&select=id,email&limit=1`);
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok) return json(res, 502, { error: 'Could not find customer.' });
  if (!profiles[0]) return json(res, 404, { error: 'Customer account not found.' });

  const creditResponse = await serviceRequest(ctx, 'rpc/grant_trial_credit', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: profiles[0].id })
  });
  const result = await creditResponse.json().catch(() => ({}));
  if (!creditResponse.ok) {
    return json(res, 400, { error: result.message || 'Trial credit could not be granted.' });
  }

  return json(res, 200, {
    granted: true,
    email: profiles[0].email,
    amount: Number(result.amount),
    balance: Number(result.balance)
  });
}
