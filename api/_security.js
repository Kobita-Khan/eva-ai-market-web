const WINDOW_MS = 60_000;
const DEFAULT_REQUESTS_PER_MINUTE = 30;
const DEFAULT_CONCURRENT_REQUESTS = 3;
const MAX_TRACKED_IDENTITIES = 5_000;

const state = globalThis.__evaRelaySecurityState || {
  windows: new Map(),
  concurrent: new Map()
};
globalThis.__evaRelaySecurityState = state;

const positiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const requestLimit = () => positiveInteger(
  process.env.EVA_REQUESTS_PER_MINUTE,
  DEFAULT_REQUESTS_PER_MINUTE,
  600
);

const concurrentLimit = () => positiveInteger(
  process.env.EVA_MAX_CONCURRENT_REQUESTS,
  DEFAULT_CONCURRENT_REQUESTS,
  20
);

const cleanExpiredWindows = (now) => {
  if (state.windows.size < MAX_TRACKED_IDENTITIES) return;
  for (const [identity, entry] of state.windows) {
    if (entry.resetAt <= now) state.windows.delete(identity);
  }
  while (state.windows.size >= MAX_TRACKED_IDENTITIES) {
    state.windows.delete(state.windows.keys().next().value);
  }
};

const allowedOrigins = (req) => {
  const configured = String(process.env.EVA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const host = String(req.headers.host || '').trim();
  if (host) {
    configured.push(`https://${host}`);
    if (host.startsWith('localhost:')) configured.push(`http://${host}`);
  }
  configured.push('https://eva-ai-market.vercel.app');
  return new Set(configured);
};

export function applyRelayCors(req, res) {
  const origin = String(req.headers.origin || '').trim();
  res.setHeader('Vary', 'Origin');
  if (!origin) return true;
  if (!allowedOrigins(req).has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}

export function acquireRelayGate(req, res, identity) {
  if (!applyRelayCors(req, res)) {
    return { ok: false, status: 403, error: 'This browser origin is not allowed.' };
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (req.method === 'POST' && !contentType.includes('application/json')) {
    return { ok: false, status: 415, error: 'Content-Type must be application/json.' };
  }

  const now = Date.now();
  cleanExpiredWindows(now);
  const limit = requestLimit();
  let window = state.windows.get(identity);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + WINDOW_MS };
  }

  const resetSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  if (window.count >= limit) {
    res.setHeader('Retry-After', String(resetSeconds));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(window.resetAt / 1000)));
    return { ok: false, status: 429, error: 'Rate limit exceeded. Wait briefly and retry.' };
  }

  const active = state.concurrent.get(identity) || 0;
  const maxConcurrent = concurrentLimit();
  if (active >= maxConcurrent) {
    res.setHeader('Retry-After', '1');
    return { ok: false, status: 429, error: 'Too many concurrent requests for this API key.' };
  }

  window.count += 1;
  state.windows.set(identity, window);
  state.concurrent.set(identity, active + 1);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - window.count)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(window.resetAt / 1000)));

  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      const current = state.concurrent.get(identity) || 1;
      if (current <= 1) state.concurrent.delete(identity);
      else state.concurrent.set(identity, current - 1);
    }
  };
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return new Response(JSON.stringify({
        error: { message: 'The upstream AI provider timed out. Please retry.' }
      }), {
        status: 504,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
