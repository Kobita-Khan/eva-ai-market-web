import { createHash, randomUUID } from 'node:crypto';
import { acquireRelayGate, applyRelayCors, fetchWithTimeout, relayClientIdentity } from '../_security.js';

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
  if (!env.url || !env.service || !env.gemini) {
    return send(res, 503, { error: 'Gemini service is not configured.' });
  }

  const customerKey = String(req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '').trim();
  if (!/^eva_live_[A-Za-z0-9_-]{20,}$/.test(customerKey)) {
    return send(res, 401, { error: 'A valid EVA API key is required.' });
  }

  const keyHash = createHash('sha256').update(customerKey).digest('hex');
  const keyResponse = await serviceFetch(env, 'rpc/resolve_api_key_for_relay', {
    method: 'POST',
    body: JSON.stringify({ p_key_hash: keyHash })
  });
  const keys = await keyResponse.json().catch(() => []);
  if (!keyResponse.ok) {
    return send(res, 502, { error: keys?.message || 'API key verification failed.' });
  }
  if (!Array.isArray(keys) || !keys[0]) {
    return send(res, 401, { error: 'API key is invalid or inactive.' });
  }
  const apiKey = {
    id: keys[0].api_key_id,
    user_id: keys[0].customer_user_id
  };
  if (Number(keys[0].balance_usd) < MINIMUM_BALANCE) {
    return send(res, 402, { error: 'Insufficient balance. Deposit credits to continue.' });
  }

  const suppliedContents = Array.isArray(req.body?.contents) ? req.body.contents : null;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const contents = suppliedContents || (prompt ? [{ role: 'user', parts: [{ text: prompt }] }] : null);
  if (!contents) return send(res, 400, { error: 'Provide a prompt or Gemini contents array.' });

  const textLength = JSON.stringify(contents).length;
  if (textLength > 20000) return send(res, 413, { error: 'Request is too large. Maximum 20,000 characters.' });

  const gate = acquireRelayGate(req, res, keyHash);
  if (!gate.ok) return send(res, gate.status, { error: gate.error });

  const providerResponse = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.gemini },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: Math.min(Number(req.body?.generationConfig?.maxOutputTokens) || 512, 1024),
          temperature: Math.min(Math.max(Number(req.body?.generationConfig?.temperature) || 0.7, 0), 2)
        }
      })
    }
  );

  const providerBody = await providerResponse.json().catch(() => ({}));
  gate.release();
  if (!providerResponse.ok) {
    const providerMessage = providerBody?.error?.message || 'Gemini request failed.';
    return send(res, providerResponse.status === 429 ? 429 : 502, { error: providerMessage });
  }

  const inputTokens = Number(providerBody.usageMetadata?.promptTokenCount || 0);
  const outputTokens = Number(providerBody.usageMetadata?.candidatesTokenCount || 0);
  const charge = Math.max(
    MINIMUM_CHARGE,
    Number((inputTokens * INPUT_RETAIL_PER_TOKEN + outputTokens * OUTPUT_RETAIL_PER_TOKEN).toFixed(6))
  );
  const requestId = randomUUID();

  const billingResponse = await serviceFetch(env, 'rpc/record_gemini_usage', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: apiKey.user_id,
      p_api_key_id: apiKey.id,
      p_model: MODEL,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_cost_usd: charge,
      p_request_id: requestId
    })
  });
  const billing = await billingResponse.json().catch(() => ({}));
  if (!billingResponse.ok) {
    return send(res, 402, { error: billing.message || 'Usage could not be charged. Add credits and retry.' });
  }

  return send(res, 200, {
    ...providerBody,
    eva_usage: {
      request_id: requestId,
      charged_usd: charge,
      balance_usd: Number(billing.balance),
      model: MODEL
    }
  });
}
