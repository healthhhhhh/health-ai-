# Testing real AI answers with Amazon Bedrock (development only)

Bedrock is an **additional provider** behind the existing AI Gateway, for trying real model answers during
development with your own AWS key. It is never chosen by default and the API **refuses to start in
production** with it. Production keeps the provider you configure for launch. Nothing about the gateway changes:
consent, age checks, emergency handling, cost limits, usage accounting and answer validation all apply
as they do for every other provider.

## 1. What you need from AWS

1. **A Bedrock API key.** In the AWS console open *Amazon Bedrock → API keys* and generate a key.
   Short-term keys expire after a few hours; long-term keys have the expiry you choose. Treat it like a
   password.
2. **A Region** where you use Bedrock, for example `us-east-1` or `us-west-2`.
3. **A model ID that your account can invoke in that Region.** One API key doesn't give access to every model:
   - *Bedrock → Model catalog*: open the model and copy its **model ID**. Check which Regions list it.
   - Many newer models are invoked through an **inference profile** (an ID starting with `us.`, `eu.`,
     `apac.` or `global.`). Find these under *Bedrock → Cross-region inference*. If calling the plain
     model ID fails with `ValidationException`, use the profile ID instead.
   - Some providers ask for a one-time use-case form, or access approval, before their models can be
     invoked. The console tells you when that applies.
   - Pick a model that supports **tool use** in the Converse API (see AWS's "Supported models and model
     features" table). HealthMate asks for structured answers through a forced tool.
4. **The model's price** from the [Amazon Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/),
   for your Region (on-demand). HealthMate has **no built-in Bedrock prices**, and without a price the API
   refuses to start rather than guess (the gateway fails closed).

## 2. Configure it locally

Put the settings in the **repository root `.env`**. The API loads it (`--env-file-if-exists=../../.env`), and
`.gitignore` excludes `.env` and `.env.*`, so the file is never committed. Copy `.env.example` to `.env` if you
haven't already. Never put these in `apps/web/.env*`, iOS settings or anything shipped to clients.

```dotenv
AI_PROVIDER=bedrock
AWS_BEARER_TOKEN_BEDROCK=        # your key — only here
AWS_REGION=us-east-1             # your Region
BEDROCK_MODEL_ID=                # model ID or inference profile ID
# USD per MILLION tokens: model=input/output[/cacheRead/cacheWrite]. AWS often lists prices per
# 1,000 tokens — multiply by 1,000. Use the exact BEDROCK_MODEL_ID as the name.
AI_PRICES=<your model id>=<input>/<output>
# Keep test spending small (internal limit per test account per month, USD):
AI_MONTHLY_USER_BUDGET_USD=0.50
```

The gateway reserves the worst case before each call and settles at the token counts Bedrock reports. If
Bedrock reports no usage, or a call times out, it charges the full reservation. The figures are only as
accurate as the prices you enter: treat them as **estimates, not your AWS bill**.

**Change the model** by editing `BEDROCK_MODEL_ID` (and its `AI_PRICES` entry) and restarting the API. No code
changes are needed.

**Route only some tasks to Bedrock** (optional), keeping another default:
`AI_PROVIDER=development` with `AI_ROUTES=summarization=bedrock`. The routed task uses `BEDROCK_MODEL_ID`.
(`AI_ROUTES` can't name a Bedrock model directly, because model IDs contain `:`, the route separator.)

**Go back** to the free, offline development provider: set `AI_PROVIDER=development` (or delete the line to have
no AI) and restart. You can leave the AWS settings in `.env`; they're ignored unless Bedrock is selected.

## 3. Check the settings before testing

```sh
npm run bedrock:check -w @healthmate/api
```

This **sends nothing**. It validates the configuration, shows the Region and model (never the key), warns if
the price is missing, and prints free AWS CLI checks, for example
`aws bedrock get-foundation-model-availability --region <region> --model-id <model id>`, which use your AWS CLI
credentials, not the Bedrock key.

To confirm the key, Region and model work together, send **one small billable request** (a short synthetic
prompt asking for the word "ok"). It goes through the AI Gateway like any other request, and its usage and
estimated cost are recorded in `ai_usage` as system work:

```sh
npm run bedrock:check -w @healthmate/api -- --yes-make-a-billable-request
```

When it fails, the server log names the AWS error and the likely cause, never the key or any message text:

| Log | Meaning |
|---|---|
| `UnrecognizedClientException` / `AccessDeniedException` (key) | Key wrong or expired |
| `AccessDeniedException` (model access) | The account can't use this model in this Region yet |
| `ResourceNotFoundException` | Model ID not found in this Region |
| `ValidationException` | Wrong ID type (try the inference profile ID), or the model doesn't support tool use |
| `ThrottlingException` | Quota reached; wait, or request a quota increase |
| `…not authorized to perform: bedrock:CallWithBearerToken … explicit deny in a service control policy` | Your AWS Organization blocks Bedrock API keys for this account. Only an Organization administrator can allow it; until then the key can't be used, even for free calls |

## 4. A safe test with synthetic data

1. `npm run build -w @healthmate/api && npm start -w @healthmate/api` (development mode, with the `.env` above).
2. Point the web app at it: in `apps/web/.env.local` set `HEALTHMATE_DATA_SOURCE=api` and
   `HEALTHMATE_API_URL=http://localhost:4000/v1` (no AWS settings there), then `npm run dev -w @healthmate/web`.
3. Create a **new test account** with a made-up name and an adult date of birth. In setup, the consent screen
   now says data goes to *our AI provider, Amazon Web Services*. Turn on AI Health Assistant.
4. Ask general, made-up questions ("How much sleep do adults usually need?"). **Never enter real health
   information, real documents or real people's details** while testing with a personal key.
5. Also check the safety paths: an emergency message ("I have crushing chest pain") must show emergency
   guidance with no model call. With AI Health Assistant off, chat must ask for permission and send nothing.
6. When you're done, set `AI_PROVIDER=development`, restart, and revoke or let the key expire in the AWS console.

## What's different from the Anthropic provider

- Structured answers come from one forced tool (Converse has no provider-neutral JSON mode). The gateway
  validates them exactly as before.
- Not used with Bedrock: prompt-cache markers, the `effort` setting and Anthropic's server-side refusal
  fallback. Guardrail or content-filter blocks count as "declined".
- There's no streaming, as with every provider: the gateway works with complete, validated answers.

The provider lives in `services/api/src/modules/ai/bedrock.provider.ts`; its tests (mocked AWS responses only,
nothing billed) are in `services/api/test/bedrock.test.ts`.
