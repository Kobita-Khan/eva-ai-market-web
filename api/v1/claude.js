import { createHash, randomUUID } from 'node:crypto';
import { acquireRelayGate, applyRelayCors, fetchWithTimeout } from '../_security.js';

const MODEL = 'claude-haiku-4-5-20251001';
const INPUT_RETAIL_PER_TOKEN = 0.00000135;
const OUTPUT_RETAIL_PER_TOKEN = 0.00000675;
const MINIMUM_CHARGE = 0.0001;
const MINIMUM_BALANCE = 0.015;

const send = (res, status, body) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return res.status(status).json(body);
};

const serviceEnv = () => ({
  url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY
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

  const env = serviceEnv();
  if (!env.url || !env.service || !env.anthropic) {
    return send(res, 503, { error: 'Claude service is not configured.' });
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

  const suppliedMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const messages = suppliedMessages || (prompt ? [{ role: 'user', content: prompt }] : null);
  if (!messages) return send(res, 400, { error: 'Provide a prompt or Claude messages array.' });

  const textLength = JSON.stringify(messages).length;
  if (textLength > 20000) {
    return send(res, 413, { error: 'Request is too large. Maximum 20,000 characters.' });
  }

  const maxTokens = Math.min(Math.max(Number(req.body?.max_tokens) || 512, 1), 1024);
  const requestedTemperature = Number(req.body?.temperature);
  const temperature = Number.isFinite(requestedTemperature)
    ? Math.min(Math.max(requestedTemperature, 0), 1)
    : 0.7;
  const providerRequest = {
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    messages
  };
  if (typeof req.body?.system === 'string' && req.body.system.trim()) {
    providerRequest.system = req.body.system.trim().slice(0, 5000);
  }

  const gate = acquireRelayGate(req, res, keyHash);
  if (!gate.ok) return send(res, gate.status, { error: gate.error });

  const providerResponse = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.anthropic,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(providerRequest)
  });

  const providerBody = await providerResponse.json().catch(() => ({}));
  gate.release();
  if (!providerResponse.ok) {
    const providerMessage = providerBody?.error?.message || 'Claude request failed.';
    return send(res, providerResponse.status === 429 ? 429 : 502, { error: providerMessage });
  }

  const inputTokens = Number(providerBody.usage?.input_tokens || 0);
  const outputTokens = Number(providerBody.usage?.output_tokens || 0);
  const charge = Math.max(
    MINIMUM_CHARGE,
    Number((inputTokens * INPUT_RETAIL_PER_TOKEN + outputTokens * OUTPUT_RETAIL_PER_TOKEN).toFixed(6))
  );
  const requestId = randomUUID();

  const billingResponse = await serviceFetch(env, 'rpc/record_claude_usage', {
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
