const env = () => ({
  url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
});

export function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

async function authenticatedContext(req, res) {
  const { url, anon, service } = env();
  if (!url || !anon || !service) {
    json(res, 503, { error: 'Account service is not configured.' });
    return null;
  }
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    json(res, 401, { error: 'Sign in required.' });
    return null;
  }
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization } });
  if (!response.ok) {
    json(res, 401, { error: 'Invalid or expired session.' });
    return null;
  }
  return { url, service, user: await response.json() };
}

export async function requireUser(req, res) {
  return authenticatedContext(req, res);
}

export async function requireAdmin(req, res) {
  const ctx = await authenticatedContext(req, res);
  if (!ctx) return null;
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    json(res, 503, { error: 'Admin service is not configured.' });
    return null;
  }
  if (ctx.user.email?.toLowerCase() !== adminEmail) {
    json(res, 403, { error: 'Admin access denied.' });
    return null;
  }
  return ctx;
}

export async function serviceRequest(ctx, path, options = {}) {
  return fetch(`${ctx.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: ctx.service,
      authorization: `Bearer ${ctx.service}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
}
