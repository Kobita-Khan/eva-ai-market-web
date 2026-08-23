import { json, requireAdmin, serviceRequest } from '../_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'Enter a valid customer email.' });
  }

  let customer = null;
  for (let page = 1; page <= 5 && !customer; page += 1) {
    const authResponse = await fetch(`${ctx.url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: {
        apikey: ctx.service,
        authorization: `Bearer ${ctx.service}`
      }
    });
    const authBody = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok) return json(res, 502, { error: 'Could not search registered customers.' });
    const users = Array.isArray(authBody.users) ? authBody.users : [];
    customer = users.find(user => user.email?.toLowerCase() === email) || null;
    if (users.length < 200) break;
  }

  if (!customer) return json(res, 404, { error: 'Registered customer account not found.' });

  const creditResponse = await serviceRequest(ctx, 'rpc/grant_trial_credit', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: customer.id })
  });
  const result = await creditResponse.json().catch(() => ({}));
  if (!creditResponse.ok) {
    return json(res, 400, { error: result.message || 'Trial credit could not be granted.' });
  }

  return json(res, 200, {
    granted: true,
    email: customer.email,
    amount: Number(result.amount),
    balance: Number(result.balance)
  });
}
