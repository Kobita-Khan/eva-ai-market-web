# EVA AI MARKET

Production pay-as-you-go AI API gateway for Gemini, OpenAI, and Claude.

## Customer flow

1. A customer signs in and deposits credits.
2. An administrator verifies the payment.
3. The customer creates a private `eva_live_...` key.
4. Requests go through the EVA gateway and are metered against the customer's wallet.
5. Provider secrets remain server-side and are never returned to customers.

Developer documentation is available at `/api-docs`.

## Required server environment

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Never commit real provider keys or the Supabase service-role key.

## Relay security controls

- EVA key and IP rate limiting
- One concurrent provider request per identity by default
- Provider-specific minimum balance reserve
- 20,000-character request cap
- Provider timeout and network-failure handling
- Restricted browser origins; server-to-server requests remain supported
- Atomic wallet deductions and idempotent request IDs in Supabase

Optional configuration:

- `EVA_REQUESTS_PER_MINUTE` — default `30`, maximum `600`
- `EVA_MAX_CONCURRENT_REQUESTS` — default `1`, maximum `20`
- `EVA_ALLOWED_ORIGINS` — comma-separated trusted browser origins

## API routes

- `POST /api/v1/gemini`
- `POST /api/v1/openai`
- `POST /api/v1/claude`

Send the customer key in `X-API-Key` or `Authorization: Bearer`.
