# AI and Third-Party Data-Sharing Disclosure — DRAFT

> **Unpublished draft for counsel review. Not legal advice. Not in force.** See `README.md`.
> Must be shown **before** the permission screens that turn on AI, report/photo analysis and Apple
> Health, and be linked from them. [[OWNER: the client screens don't show this yet — launch blocker.]]

## 1. Who the AI provider is

HealthMate's AI Health Assistant uses **[[OWNER: provider legal name, e.g. "Anthropic, PBC (Claude)" —
only if enabled in production]]**. All AI requests go from HealthMate's servers; the apps never talk to
the provider directly and hold no AI keys.

[[COUNSEL/OWNER: before publishing, state from the signed contract: whether the provider keeps
requests and for how long; whether it may use them for training (expected: no); where it processes
data; its subprocessors; whether zero-data-retention applies; its terms on minors' data.]]

## 2. What is sent, and when

Only while you have given the matching permission. Permission is checked again when the work runs;
withdrawing it stops work that is still waiting.

| Feature | Permission | Sent to the AI provider |
|---|---|---|
| AI Health Assistant chat | AI processing | Your message; up to the last 20 messages of the conversation; a profile summary (**age in whole years — never your date of birth**; sex; current and past conditions; allergies; medications with their instructions); health memories selected as relevant; summaries of relevant daily data. **Apple Health–derived summaries only while Apple Health permission is also on.** If you're 13–17, a fixed instruction asking for age-appropriate answers. |
| Report explanation | Report and photo analysis | The whole file you upload (it may contain identifiers printed on it, such as your name or date of birth) |
| Photo check | Report and photo analysis | The photo (location data is removed on your device first) and the note you add |
| Memory suggestions | AI processing | Text from your conversation, to suggest facts you can save |

Not sent: your email, password, exact date of birth (from your account or profile), device tokens,
location, or other people's data.

**Emergencies never go to the AI.** Messages that match emergency rules get fixed guidance from
HealthMate itself, on your device and on the server.

**Can't be recalled.** Once a request has been sent to the provider it can't be withdrawn; if you
withdraw permission while it's running, the answer is thrown away and not stored.

## 3. Other recipients

| Recipient | Receives | When |
|---|---|---|
| [[DEPLOY: Supabase — database, sign-in, file storage; region]] | Everything stored in HealthMate | Always (processor) |
| [[DEPLOY: API/web hosting provider; region]] | All traffic to our servers | Always (processor) |
| [[DEPLOY: Redis provider, if used]] | Job ids only (no health content) | Background work |
| Apple Push Notification service | Device token; notification text (generic unless you turn on "show details") | If you allow notifications |
| Apple Maps (iOS) | The care type you search for and your area | When you use the care finder |
| Apple speech recognition (iOS) | Your voice, when on-device recognition isn't available | When you use voice input |
| Google | Your Google sign-in token is checked against Google's public keys | If you sign in with Google |

No analytics, advertising or data-broker services receive your data.
