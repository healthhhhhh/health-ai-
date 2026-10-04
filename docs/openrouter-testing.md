# Testing AI features with OpenRouter free models (development only)

OpenRouter is an **additional provider** behind the existing AI Gateway, for trying real model answers during
development at no cost. It's never chosen by default, and the API **refuses to start in production** with it,
because free models may log or train on what they receive. Use **synthetic data only**. Consent, age checks,
emergency handling, usage accounting and answer validation apply exactly as for every other provider. Bedrock
and Anthropic stay in the code and are used only when selected.

## Settings

| Variable | Value | Notes |
|---|---|---|
| `AI_PROVIDER` | `openrouter` | Selects it. `development` goes back to offline scripted answers. |
| `OPENROUTER_API_KEY` | your key | **Secret.** Set it as an environment variable (below), not in a file in the repo. |
| `OPENROUTER_MODEL` | `openrouter/free` (default) | Or one `:free` model, e.g. a vision-capable one for photo tests. |
| `OPENROUTER_ALLOW_PAID` | unset | Paid models are refused unless this is `true`, and then they also need an `AI_PRICES` entry. |

Free-only means: the model must be `openrouter/free` or end in `:free`. The provider also refuses to send a
request for any other model, and logs an error if OpenRouter ever reports a non-zero cost.

### Where to put the key

**Cloud workspace with an API credential (recommended there):** keep `OPENROUTER_API_KEY` only under the
environment's **API credentials**, scoped to `openrouter.ai`, and not under Environment variables. The workspace
proxy then adds the `Authorization` header to requests to that host. Verified behaviour: for `openrouter.ai` the
proxy removes any `Authorization` header a program sends, and other hosts are unaffected. Credentials apply to
**new sessions** only. Run the API with:

```bash
AI_PROVIDER=openrouter OPENROUTER_AUTH=proxy NODE_USE_ENV_PROXY=1 npm run start -w @healthmate/api
```

HealthMate then holds no key and sends no `Authorization` header. It refuses to start if `OPENROUTER_API_KEY` is
also set, or if its requests wouldn't go through the proxy (`HTTPS_PROXY` unset or `NODE_USE_ENV_PROXY` not `1`).
To confirm the proxy adds the key, use one free request that returns only the key's limits:
`curl -s https://openrouter.ai/api/v1/key -o /dev/null -w "%{http_code}\n"` should print `200`, not `401`.
Don't print the response body: its `label` field can contain part of the key.

**Otherwise:**

- **A cloud workspace without API credentials:** open the environment settings (the cloud environment menu in the session's title bar,
  then **Edit**), add an environment variable `OPENROUTER_API_KEY` with your key, and allow network access to
  `openrouter.ai` (Network access → Custom → add `openrouter.ai` to Allowed domains, keeping the package-manager
  defaults). Start a new session so both take effect.
- **Your own computer:** `export OPENROUTER_API_KEY=…` in the shell that starts the API, or put it in the root
  `.env` (ignored by Git). An environment variable that's already set wins over `.env`.

Never paste the key into chat, commit it, or put it in `apps/web` or iOS settings.

## Start the app

```bash
# root .env (Git-ignored): AI_PROVIDER=openrouter, PGLITE_DIR=.data/pglite, AGE_ENFORCEMENT=enforce
npm run build -w @healthmate/safety && npm run build -w @healthmate/api
npm run start -w @healthmate/api            # log: "ai: openrouter"
# apps/web/.env.local: HEALTHMATE_DATA_SOURCE=api and HEALTHMATE_API_URL=http://localhost:4000/v1
npm run build -w @healthmate/web && npm run start -w @healthmate/web   # http://localhost:3000
```

Create an account with a made-up name and an adult date of birth, then turn on the AI permissions in setup.
The consent screens name **OpenRouter** as the AI provider.

## What each feature needs from the model

| Feature | Sent as | Needs |
|---|---|---|
| Chat, symptom questions | text | JSON output (`response_format: json_schema`) |
| Photo check, JPG/PNG reports | `image_url` data URL | a vision model **and** JSON output |
| PDF reports | `file` part + OpenRouter's `file-parser` plugin (`pdf-text` engine: text extraction, not OCR) | JSON output. Scanned PDFs without a text layer won't work with `pdf-text`. Upload a photo of the page instead. |

`openrouter/free` picks among whatever free models are available at the time, and not every free model supports
JSON schemas or images. If a request fails with 400 or 404 in the API log, choose a specific `:free` model that
lists both *structured outputs* and *image* input on its OpenRouter model page, and set `OPENROUTER_MODEL`.

## Limits and cost

Free models cost $0, but OpenRouter limits them per minute and per day (higher daily limits after buying credits).
Check the current figures on OpenRouter's "Limits" documentation page. A rate-limited request shows the app's
normal "AI unavailable right now" state, and the API log says `429 … rate limited`. HealthMate records each
request's token usage and the model OpenRouter actually used in `ai_usage`, at $0.

## Switching back

Set `AI_PROVIDER=development` (or remove it) and restart the API. Remove the workspace variable and revoke the key
on openrouter.ai when you're done.
