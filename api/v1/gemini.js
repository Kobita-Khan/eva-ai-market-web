import { createHash, randomUUID } from 'node:crypto';
import { acquireRelayGate, applyRelayCors, fetchWithTimeout, relayClientIdentity } from '../../_security.js';
import { estimateMaximumCharge, finalizeApiUsage, releaseApiUsage, reservationErrorStatus, reserveApiUsage } from '../_billing.js';

const MODEL = 'gemini-3.5-flash-lite';
const INPUT_RETAIL_PER_TOKEN = 0.000000405;
const OUTPUT_RETAIL_PER_TOKEN = 0.000003375;
const MINIMUM_CHARGE = 0.0001;
const MINIMUM_BALANCE = 0.01;

const send = (res, status, body) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return res.status(status).json(body);
};

const serviceEnv = () => ({
  url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  gemini: process.env.GEMINI_API_KEY
});

const serviceFetch = (env, path, options = {}) => fetch(`${env.url}/rest/v1/${path}`, {
  ...options,
  headers: {
    apikey: env.service,
    authorization: `Bearer ${env.service}`,
    'content-type': 'application/json',
    ...(options.headers || {})
  }
});

export default async function handler(req, res) {
  if (!applyRelayCors(req, res)) return send(res, 403, { error: 'This browser origin is not allowed.' });
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

  const clientGate = acquireRelayGate(req, res, `ip:${relayClientIdentity(req)}`);
  if (!clientGate.ok) return send(res, clientGate.status, { error: clientGate.error });
  clientGate.release();

  const env = serviceEnv();
  if (!env.url || !env.service || !env.gemini) return send(res, 503, { error: 'Gemini service is not configured.' });

  const customerKey = String(req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '').trim();
  if (!/^eva_live_[A-Za-z0-9_-]{20,}$/.test(customerKey)) return send(res, 401, { error: 'A valid EVA API key is required.' });

  const keyHash = createHash('sha256').update(customerKey).digest('hex');
  const keyResponse = await serviceFetch(env, 'rpc/resolve_api_key_for_relay', {
    method: 'POST',
    body: JSON.stringify({ p_key_hash: keyHash })
  });
  const keys = await keyResponse.json().catch(() => []);
  if (!keyResponse.ok) return send(res, 502, { error: keys?.message || 'API key verification failed.' });
  if (!Array.isArray(keys) || !keys[0]) return send(res, 401, { error: 'API key is invalid or inactive.' });

  const apiKey = { id: keys[0].api_key_id, user_id: keys[0].customer_user_id };
  if (Number(keys[0].balance_usd) < MINIMUM_BALANCE) return send(res, 402, { error: 'Insufficient balance. Deposit credits to continue.' });

  const suppliedContents = Array.isArray(req.body?.contents) ? req.body.contents : null;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const contents = suppliedContents || (prompt ? [{ role: 'user', parts: [{ text: prompt }] }] : null);
  if (!contents) return send(res, 400, { error: 'Provide a prompt or Gemini contents array.' });
  if (JSON.stringify(contents).length > 20000) return send(res, 413, { error: 'Request is too large. Maximum 20,000 characters.' });

  const maxOutputTokens = Math.min(Math.max(Number(req.body?.generationConfig?.maxOutputTokens) || 512, 1), 1024);
  const requestedTemperature = Number(req.body?.generationConfig?.temperature);
  const temperature = Number.isFinite(requestedTemperature) ? Math.min(Math.max(requestedTemperature, 0), 2) : 0.7;
  const providerRequest = { contents, generationConfig: { maxOutputTokens, temperature } };

  const requestId = randomUUID();
  const maxCostUsd = estimateMaximumCharge(providerRequest, INPUT_RETAIL_PER_TOKEN, OUTPUT_RETAIL_PER_TOKEN, maxOutputTokens, MINIMUM_CHARGE);
  const reservation = await reserveApiUsage(serviceFetch, env, {
    userId: apiKey.user_id,
    apiKeyId: apiKey.id,
    provider: 'gemini',
    model: MODEL,
    maxCostUsd,
    requestId
  });
  if (!reservation.response.ok) {
    return send(res, reservationErrorStatus(reservation.result), { error: reservation.result?.message || 'Usage reservation failed.' });
  }

  const gate = acquireRelayGate(req, res, keyHash);
  if (!gate.ok) {
    await releaseApiUsage(serviceFetch, env, requestId).catch(() => null);
    return send(res, gate.status, { error: gate.error });
  }

  let providerResponse;
  try {
    providerResponse = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.gemini },
      body: JSON.stringify(providerRequest)
    });
  } finally {
    gate.release();
  }

  const providerBody = await providerResponse.json().catch(() => ({}));
  if (!providerResponse.ok) {
    await releaseApiUsage(serviceFetch, env, requestId).catch(() => null);
    const providerMessage = providerBody?.error?.message || 'Gemini request failed.';
    return send(res, providerResponse.status === 429 ? 429 : providerResponse.status === 504 ? 504 : 502, { error: providerMessage });
  }

  const inputTokens = Number(providerBody.usageMetadata?.promptTokenCount || 0);
  const outputTokens = Number(providerBody.usageMetadata?.candidatesTokenCount || 0);
  const charge = Math.max(MINIMUM_CHARGE, Number((inputTokens * INPUT_RETAIL_PER_TOKEN + outputTokens * OUTPUT_RETAIL_PER_TOKEN).toFixed(6)));
  const billing = await finalizeApiUsage(serviceFetch, env, {
    requestId,
    inputTokens,
    outputTokens,
    actualCostUsd: charge
  });
  if (!billing.response.ok) {
    return send(res, 500, {
      error: 'The model completed the request, but billing finalization is pending. Contact support with the request ID instead of retrying.',
      request_id: requestId
    });
  }

  return send(res, 200, {
    ...providerBody,
    eva_usage: { request_id: requestId, charged_usd: charge, balance_usd: Number(billing.result.balance), model: MODEL }
  });
}
