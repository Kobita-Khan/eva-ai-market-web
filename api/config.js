export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return res.status(503).json({ error: 'Supabase is not configured.' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    url,
    anonKey,
    signupUrl: `${String(url).replace(/\/$/, '')}/functions/v1/direct-signup`
  });
}
