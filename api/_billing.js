const positiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const billingLimits = () => ({
  rpm: positiveInteger(process.env.EVA_REQUESTS_PER_MINUTE, 30, 600),
  concurrent: positiveInteger(process.env.EVA_MAX_CONCURRENT_REQUESTS, 1, 20)
});

export function estimateMaximumCharge(payload, inputRetailPerToken, outputRetailPerToken, maxOutputTokens, minimumCharge = 0.0001) {
  const serialized = JSON.stringify(payload ?? {});
  const inputByteCeiling = Buffer.byteLength(serialized, 'utf8') + 4096;
  const raw = inputByteCeiling * Number(inputRetailPerToken || 0) + Number(maxOutputTokens || 0) * Number(outputRetailPerToken || 0);
  return Math.max(minimumCharge, Number((raw * 1.05).toFixed(6)));
}

const rpc = async (serviceFetch, env, name, body) => {
  const response = await serviceFetch(env, `rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  return { response, result };
};

export async function reserveApiUsage(serviceFetch, env, { userId, apiKeyId, provider, model, maxCostUsd, requestId }) {
  const limits = billingLimits();
  return rpc(serviceFetch, env, 'reserve_api_usage', {
    p_user_id: userId,
    p_api_key_id: apiKeyId,
    p_provider: provider,
    p_model: model,
    p_max_cost_usd: maxCostUsd,
    p_request_id: requestId,
    p_requests_per_minute: limits.rpm,
    p_max_concurrent: limits.concurrent
  });
}

export async function finalizeApiUsage(serviceFetch, env, { requestId, inputTokens, outputTokens, actualCostUsd }) {
  return rpc(serviceFetch, env, 'finalize_api_usage', {
    p_request_id: requestId,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_actual_cost_usd: actualCostUsd
  });
}

export async function releaseApiUsage(serviceFetch, env, requestId) {
  return rpc(serviceFetch, env, 'release_api_usage', { p_request_id: requestId });
}

export function reservationErrorStatus(result) {
  const message = String(result?.message || result?.error || '').toLowerCase();
  if (message.includes('rate limit') || message.includes('concurrent')) return 429;
  if (message.includes('insufficient balance')) return 402;
  if (message.includes('api key')) return 401;
  return 502;
}
