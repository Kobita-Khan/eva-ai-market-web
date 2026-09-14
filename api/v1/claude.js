import { createHash, createHmac, randomUUID } from 'node:crypto';
import { acquireRelayGate, applyRelayCors, fetchWithTimeout, relayClientIdentity } from '../../_security.js';
import { estimateMaximumCharge, finalizeApiUsage, releaseApiUsage, reservationErrorStatus, reserveApiUsage } from '../_billing.js';

const MINIMUM_CHARGE = 0.0001;
const MINIMUM_BALANCE = 0.015;

const isAnthropicCompat = req => req.query?.compat === 'anthropic' || Boolean(req.headers['anthropic-version']);

const send = (req, res, status, body) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization, Anthropic-Version, Anthropic-Beta');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (status >= 400 && isAnthropicCompat(req)) {
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message || 'Request failed.';
    return res.status(status).json({
      type: 'error',
      error: {
        type: status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : 'api_error',
        message
      },
      ...(body?.request_id ? { request_id: body.request_id } : {})
    });
  }
  return res.status(status).json(body);
};

const serviceEnv = () => ({
  url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  model: process.env.AWS_BEDROCK_MODEL_ID,
  inputRetailPerToken: Number(process.env.BEDROCK_INPUT_RETAIL_PER_TOKEN || 0.00000135),
  outputRetailPerToken: Number(process.env.BEDROCK_OUTPUT_RETAIL_PER_TOKEN || 0.00000675)
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

const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => createHmac('sha256', key).update(value).digest(encoding);

function awsSignedHeaders(env, host, path, body) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = {
    'content-type': 'application/json',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  if (env.sessionToken) headers['x-amz-security-token'] = env.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map(name => `${name}:${String(headers[name]).trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${env.region}/bedrock/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, env.region);
  const kService = hmac(kRegion, 'bedrock');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');

  return {
    'content-type': headers['content-type'],
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(env.sessionToken ? { 'x-amz-security-token': env.sessionToken } : {}),
    authorization: `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

function normalizeContent(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (Array.isArray(content)) {
    const blocks = content
      .map(item => typeof item === 'string' ? { text: item } : item?.text ? { text: String(item.text) } : null)
      .filter(Boolean);
    return blocks.length ? blocks : [{ text: '' }];
  }
  return [{ text: String(content ?? '') }];
}

function anthropicResponse(providerBody, env, requestId, charge, balance) {
  const content = (providerBody.output?.message?.content || [])
    .map(block => block?.text ? { type: 'text', text: String(block.text) } : null)
    .filter(Boolean);
  return {
    id: `msg_${requestId.replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model: env.model,
    content: content.length ? content : [{ type: 'text', text: '' }],
    stop_reason: providerBody.stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: Number(providerBody.usage?.inputTokens || 0),
      output_tokens: Number(providerBody.usage?.outputTokens || 0)
    },
    eva_usage: {
      request_id: requestId,
      charged_usd: charge,
      balance_usd: Number(balance),
      model: env.model
    }
  };
}

export default async function handler(req, res) {
  if (!applyRelayCors(req, res)) return send(req, res, 403, { error: 'This browser origin is not allowed.' });
  if (req.method === 'OPTIONS') return send(req, res, 204, {});
  if (req.method !== 'POST') return send(req, res, 405, { error: 'Method not allowed.' });

  const clientGate = acquireRelayGate(req, res, `ip:${relayClientIdentity(req)}`);
  if (!clientGate.ok) return send(req, res, clientGate.status, { error: clientGate.error });
  clientGate.release();

  const env = serviceEnv();
  if (!env.url || !env.service || !env.accessKeyId || !env.secretAccessKey || !env.model) {
    return send(req, res, 503, { error: 'Amazon Bedrock Claude service is not configured.' });
  }

  const customerKey = String(req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '').trim();
  if (!/^eva_live_[A-Za-z0-9_-]{20,}$/.test(customerKey)) {
    return send(req, res, 401, { error: 'A valid EVA API key is required.' });
  }

  const keyHash = createHash('sha256').update(customerKey).digest('hex');
  const keyResponse = await serviceFetch(env, 'rpc/resolve_api_key_for_relay', {
    method: 'POST',
    body: JSON.stringify({ p_key_hash: keyHash })
  });
  const keys = await keyResponse.json().catch(() => []);
  if (!keyResponse.ok) return send(req, res, 502, { error: keys?.message || 'API key verification failed.' });
  if (!Array.isArray(keys) || !keys[0]) return send(req, res, 401, { error: 'API key is invalid or inactive.' });

  const apiKey = { id: keys[0].api_key_id, user_id: keys[0].customer_user_id };
  if (Number(keys[0].balance_usd) < MINIMUM_BALANCE) {
    return send(req, res, 402, { error: 'Insufficient balance. Deposit credits to continue.' });
  }

  const suppliedMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const sourceMessages = suppliedMessages || (prompt ? [{ role: 'user', content: prompt }] : null);
  if (!sourceMessages) return send(req, res, 400, { error: 'Provide a prompt or Claude messages array.' });
  if (JSON.stringify(sourceMessages).length > 20000) return send(req, res, 413, { error: 'Request is too large. Maximum 20,000 characters.' });

  const messages = sourceMessages.map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: normalizeContent(message.content)
  }));
  const maxTokens = Math.min(Math.max(Number(req.body?.max_tokens) || 512, 1), 4096);
  const requestedTemperature = Number(req.body?.temperature);
  const temperature = Number.isFinite(requestedTemperature) ? Math.min(Math.max(requestedTemperature, 0), 1) : 0.7;
  const providerRequest = { messages, inferenceConfig: { maxTokens, temperature } };
  if (typeof req.body?.system === 'string' && req.body.system.trim()) {
    providerRequest.system = [{ text: req.body.system.trim().slice(0, 5000) }];
  }

  const requestId = randomUUID();
  const maxCostUsd = estimateMaximumCharge(providerRequest, env.inputRetailPerToken, env.outputRetailPerToken, maxTokens, MINIMUM_CHARGE);
  const reservation = await reserveApiUsage(serviceFetch, env, {
    userId: apiKey.user_id,
    apiKeyId: apiKey.id,
    provider: 'claude',
    model: env.model,
    maxCostUsd,
    requestId
  });
  if (!reservation.response.ok) {
    return send(req, res, reservationErrorStatus(reservation.result), { error: reservation.result?.message || 'Usage reservation failed.' });
  }

  const body = JSON.stringify(providerRequest);
  const host = `bedrock-runtime.${env.region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(env.model)}/converse`;
  const headers = awsSignedHeaders(env, host, path, body);
  const gate = acquireRelayGate(req, res, keyHash);
  if (!gate.ok) {
    await releaseApiUsage(serviceFetch, env, requestId).catch(() => null);
    return send(req, res, gate.status, { error: gate.error });
  }

  let providerResponse;
  try {
    providerResponse = await fetchWithTimeout(`https://${host}${path}`, { method: 'POST', headers, body });
  } finally {
    gate.release();
  }

  const providerBody = await providerResponse.json().catch(() => ({}));
  if (!providerResponse.ok) {
    await releaseApiUsage(serviceFetch, env, requestId).catch(() => null);
    const providerMessage = providerBody?.message || providerBody?.error?.message || 'Amazon Bedrock Claude request failed.';
    return send(req, res, providerResponse.status === 429 ? 429 : providerResponse.status === 504 ? 504 : 502, { error: providerMessage });
  }

  const inputTokens = Number(providerBody.usage?.inputTokens || 0);
  const outputTokens = Number(providerBody.usage?.outputTokens || 0);
  const charge = Math.max(MINIMUM_CHARGE, Number((inputTokens * env.inputRetailPerToken + outputTokens * env.outputRetailPerToken).toFixed(6)));
  const billing = await finalizeApiUsage(serviceFetch, env, {
    requestId,
    inputTokens,
    outputTokens,
    actualCostUsd: charge
  });
  if (!billing.response.ok) {
    return send(req, res, 500, {
      error: 'The model completed the request, but billing finalization is pending. Contact support with the request ID instead of retrying.',
      request_id: requestId
    });
  }

  if (isAnthropicCompat(req)) {
    return send(req, res, 200, anthropicResponse(providerBody, env, requestId, charge, billing.result.balance));
  }

  return send(req, res, 200, {
    ...providerBody,
    provider: 'amazon-bedrock',
    eva_usage: {
      request_id: requestId,
      charged_usd: charge,
      balance_usd: Number(billing.result.balance),
      model: env.model
    }
  });
}
