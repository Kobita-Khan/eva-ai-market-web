import { json, requireAdmin, serviceRequest } from '../_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const response = await serviceRequest(ctx, 'deposits?select=id,user_id,amount_usdt,network,transaction_id,status,admin_note,created_at,reviewed_at&order=created_at.desc&limit=100');
  if (!response.ok) return json(res, 502, { error: 'Could not load deposits.' });
  const deposits = await response.json();
  const ids = [...new Set(deposits.map(item => item.user_id))];
  let profiles = [];
  if (ids.length) {
    const encoded = encodeURIComponent(`(${ids.join(',')})`);
    const profileResponse = await serviceRequest(ctx, `profiles?select=id,email,telegram_username&id=in.${encoded}`);
    if (profileResponse.ok) profiles = await profileResponse.json();
  }
  const profileMap = Object.fromEntries(profiles.map(profile => [profile.id, profile]));
  return json(res, 200, { deposits: deposits.map(item => ({ ...item, profile: profileMap[item.user_id] || null })) });
}
