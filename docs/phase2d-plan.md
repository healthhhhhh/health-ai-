# Phase 2D (free-only) — Google sign-in and push infrastructure

Scope agreed for this phase: everything that works **without paid services**. Nothing here needs
a paid AI key, the paid Apple Developer Program, Apple entitlements or APNs credentials, and the
iOS project still builds and runs with a free Apple ID ("Personal Team") signing. The UI is
unchanged. Rules: [`CLAUDE.md`](../CLAUDE.md).

| | Free (built and tested now) | Needs the Apple Developer Program (deferred) |
|---|---|---|
| Google sign-in | Server-side ID-token verification, account creation/linking, Supabase path, tests | — |
| Apple sign-in | Provider abstraction, `auth_identities` (`provider = 'apple'`), `AppleIdTokenVerifier` (2026-10-03) | Sign in with Apple capability, Services ID, client flow, token revocation key |
| Push | Device registry (encrypted tokens), dispatch honouring preferences, log adapter, APNs adapter (off) | APNs key (.p8), Push Notifications capability, `registerForRemoteNotifications` in the app |

## 1. Google sign-in

**Flow.** The app gets a Google **ID token** on the device (Google Sign-In) and sends it to
`POST /v1/auth/oauth` `{ provider: "google", idToken, nonce?, timeZone, firstName?, lastName? }`.
The API verifies it (`GoogleIdTokenVerifier`, `services/api/src/modules/auth/oauth.ts`):

- RS256 signature against Google's published keys (`https://www.googleapis.com/oauth2/v3/certs`,
  cached for an hour) — no Google API call, no client secret;
- issuer `https://accounts.google.com` / `accounts.google.com`;
- audience = one of `GOOGLE_CLIENT_IDS`;
- expiry (30 s clock tolerance), `sub` present;
- the nonce, when the app sent one.

Anything else → `401 invalid_token`; Google's key server unreachable → `503`. The response is the
usual session plus `isNewUser`.

**Account model.** `auth_identities (user_id, provider, subject, email, created_at,
last_sign_in_at)`, unique on `(provider, subject)` and `(user_id, provider)`; RLS: owner can read.

- A returning person is found by the **linked identity** (`provider` + Google's `sub`), never by
  email alone.
- First sign-in with an unknown identity creates a normal HealthMate account (profile name from
  the token, email marked verified, **no password**). Google must report the email as verified.
- If a password account with the same email already exists, sign-in is refused (`409`): the
  person signs in with their password and connects Google from there
  (`POST /v1/me/identities`). This prevents account pre-hijacking (someone registering your
  address with a password, then waiting for you to use Google).
- `DELETE /v1/me/identities/google` disconnects it, unless it's the only way left to sign in.
- `GET /v1/me/account` → `signInMethods`, e.g. `["password", "google"]` or `["google"]`.
- Password sign-in for a Google-only account fails exactly like a wrong password.
- Account deletion (`POST /v1/me/delete`) accepts the password **or** a fresh Google ID token for
  an identity linked to the account.
- Export includes `signInIdentities` (provider, email, dates).

**Supabase Auth (production).** The API still verifies the token itself, then calls Supabase's
`/token?grant_type=id_token`; Supabase creates or links the user by its own rules, and the API
records the identity in `auth_identities`. Linking/unlinking from settings uses Supabase's own
OAuth flow and answers `501` from this API for now.

**Email/password** sign-up, sign-in, reset and change are unchanged.

**What the apps do today.** Nothing changed in the UI. The "Continue with Google" buttons still
call `POST /v1/auth/oauth` *without* a token, so they keep showing "isn't available on this server
yet" until the app obtains Google ID tokens (below). `HealthMateCore` already has
`signIn(with:idToken:nonce:)`.

### Set up Google sign-in (free)

1. [Google Cloud console](https://console.cloud.google.com/) → create a project (no billing
   needed) → *APIs & Services → OAuth consent screen*: External, app name, support email; add
   your test Google accounts as test users.
2. *Credentials → Create credentials → OAuth client ID*:
   - **iOS**: bundle ID `com.healthmate.app` (`PRODUCT_BUNDLE_IDENTIFIER` in `apps/ios/project.yml`, or your own). Note the client ID and its "iOS URL scheme"
     (reversed client ID).
   - **Web application** (for the web app later, and required by Supabase): add
     `http://localhost:3000` as an authorised JavaScript origin.
3. API `.env`: `GOOGLE_CLIENT_IDS=<ios client id>,<web client id>` (public identifiers, not
   secrets). Restart the API.
4. Supabase only: *Authentication → Providers → Google*: enable, add the same client IDs under
   *Authorized Client IDs* (and the web client's secret for Supabase's own web flow).

### Next steps for the apps (not done; no UI change needed)

- iOS: add the GoogleSignIn Swift package (or `ASWebAuthenticationSession` + PKCE), put the
  reversed client ID in `CFBundleURLTypes` (`project.yml` — an Info.plist entry, **not** an
  entitlement, so free signing keeps working), and have the existing button call
  `signIn(with: "google", idToken:, nonce:)`.
- Web: Google Identity Services returns an ID token in the browser; post it to the existing
  server action.

### Status check (2026-10-02)

Re-checked what can be done without credentials:

- **Done and tested:** server-side verification (`GoogleIdTokenVerifier`, `test/google-auth.test.ts`
  with locally signed tokens), linking/unlinking, Google-only sign-in methods, and deletion for
  accounts without a password (typed `DELETE` on web and iOS, or a fresh ID token through the API).
  Age setup runs after sign-in, so Google accounts get the same date-of-birth check as email accounts.
- **Blocked on credentials:** the client side needs real OAuth client IDs (steps 1–3 above). Without
  them the SDK can't return a token, so nothing can be tested end-to-end and the buttons rightly say
  "isn't available on this server yet". Adding the GoogleSignIn package or the Google Identity
  Services script before then would ship code that never runs in CI. Do it when the client IDs exist.
- **Apple (updated 2026-10-03):** the server side now exists — `AppleIdTokenVerifier` (issuer
  `https://appleid.apple.com`, audience = bundle ID or Services ID, nonce compared as the SHA-256 of the
  raw nonce), turned on by `APPLE_CLIENT_IDS`, tested in `test/apple-auth.test.ts` with locally signed
  tokens. The app side still needs the paid Apple Developer Program (the capability isn't available with
  free signing), and account deletion must then also revoke the Apple token (needs the .p8 key).
- **Buttons:** until the apps can get tokens, web and iOS show Continue with Apple / Google only in
  Preview mode (`socialSignInAvailable`, `SocialSignIn.isAvailable`), so a real server never shows a
  button that can only fail. The exact credentials needed are listed in
  `docs/legal/policies/LAUNCH_CHECKLIST.md` (C1, C2).
- **Real-device checks still needed** once wired: Google sign-in on an iPhone (URL scheme callback),
  first sign-in creating an account that then goes through age setup, and deleting a Google-only
  account from Settings.

## 2. Push notifications

**Registry.** `push_devices (user_id, platform 'ios', environment sandbox|production,
token_hash, token_ciphertext, app_version, created_at, last_registered_at, disabled_at,
disabled_reason)`. The APNs token is stored **encrypted** (AES-256-GCM, `PUSH_TOKEN_KEY`, a
server-only key) with a SHA-256 hash for lookups. It is never returned, logged or exported. RLS:
server-only (no policies), like refresh tokens. A token belongs to whoever signed in on the device
last.

| Route | |
|---|---|
| `POST /v1/me/devices` `{ platform: "ios", token, environment, appVersion? }` | Register (idempotent; re-enables a disabled device) |
| `GET /v1/me/devices` | List (no tokens) |
| `DELETE /v1/me/devices` `{ token }` | Unregister this device (sign-out) |
| `DELETE /v1/me/devices/:id` | Remove one device |

**Dispatch.** Server-written notifications (`NotificationsService.notify`) stay the source of
truth. After the transaction that created one commits, `deliver()` queues a `push-notification`
job (ids only). `PushService.dispatch`:

1. skips when push is off, the notification is gone or already read;
2. re-checks the category switch;
3. skips during **quiet hours** in the person's time zone (the notification waits in the app);
4. sends the text only if **"show details"** is on (it's off by default); otherwise
   "HealthMate — You have a new notification. Open HealthMate to see it.";
5. sends to every active device through the `PushProvider`; a token the push service rejects
   (`410`, `BadDeviceToken`, `Unregistered`, …) disables that device until it registers again.

**Adapters** (`services/api/src/modules/notifications/push.ts`), chosen by `PUSH_PROVIDER`:

| `PUSH_PROVIDER` | Default in | Behaviour |
|---|---|---|
| `log` | development, test | Logs "[log adapter, not sent] notification <id> (<category>) → device <id>" — no text, no token. Sends nothing. |
| `none` | production | Push off; devices can still register when `PUSH_TOKEN_KEY` is set. |
| `apns` | never by default | `ApnsPushProvider`: HTTP/2, ES256 token auth from a .p8 key, sandbox/production host per device. Refused at startup unless every `APNS_*` value and `PUSH_TOKEN_KEY` are set. |

The APNs adapter is tested against a fake transport only; no real notification has been sent.

## 3. Enabling Apple later (requires the Apple Developer Program)

**Sign in with Apple**
1. Enrol in the Apple Developer Program. In *Certificates, Identifiers & Profiles*, enable
   *Sign in with Apple* for the App ID; for web, create a Services ID with the return URL.
2. iOS: add the *Sign in with Apple* capability (`com.apple.developer.applesignin` entitlement)
   in `project.yml` and use `ASAuthorizationAppleIDProvider` with a SHA-256 nonce; send
   `identityToken` + raw nonce to `POST /v1/auth/oauth` with `provider: "apple"`.
3. ~~API: add `AppleIdTokenVerifier`~~ **Done (2026-10-03).** It implements `IdTokenVerifier` (issuer
   `https://appleid.apple.com`, keys `https://appleid.apple.com/auth/keys`, audience = bundle ID /
   Services ID, nonce = SHA-256 of the raw nonce) and is registered in `idTokenVerifiersFor` behind the
   `APPLE_CLIENT_IDS` setting. The app must send the name on the first sign-in (it isn't in the
   token); the email may be a private relay address.
   Still to do with the program: revoke the Apple token when an account is deleted (App Store rule
   5.1.1(v)), using the Sign in with Apple key (.p8).
4. Supabase: enable the Apple provider with the same identifiers.
5. App Store rule: apps offering Google sign-in must also offer Sign in with Apple (or an
   equivalent privacy-focused option) before release.

**APNs**
1. In the developer account, create an APNs **key** (.p8) → note Key ID and Team ID.
2. iOS: add the *Push Notifications* capability (`aps-environment` entitlement), call
   `UIApplication.registerForRemoteNotifications()` after notification permission, and send the
   hex token with `registerPushDevice(token:environment:appVersion:)` (`sandbox` for debug
   builds); call `unregisterPushDevice(token:)` before sign-out.
3. API: `PUSH_PROVIDER=apns`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`,
   `APNS_PRIVATE_KEY` (the .p8 contents; `\n` escapes allowed), `PUSH_TOKEN_KEY`
   (`openssl rand -base64 32`). All server-side secrets — never in the app or web code.
4. Test on a real device with a debug build (sandbox) before production.

## 4. Configuration summary

| Variable | Free dev | Production |
|---|---|---|
| `GOOGLE_CLIENT_IDS` | optional (Google sign-in off without it) | set |
| `APPLE_CLIENT_IDS` | optional (Apple sign-in off without it) | set once the Apple program exists |
| `PUSH_PROVIDER` | unset → `log` | unset → `none`; `apns` when configured |
| `PUSH_TOKEN_KEY` | unset → random per process (tokens from earlier runs are dropped and re-registered) | required to store tokens |
| `APNS_*` | unset | only with `PUSH_PROVIDER=apns` |

## 5. Tests

- `test/google-auth.test.ts`: verification (valid, bad signature, expired, wrong audience/issuer,
  nonce mismatch/missing, `alg: none`, unverified email, config); sign-up/sign-in, no takeover of
  password accounts, linking/unlinking rules, deletion confirmed by Google, 501 when not configured.
- `test/supabase-adapters.test.ts`: Supabase ID-token grant, identity recording, rejection and
  outage handling.
- `test/push.test.ts`: token encryption, quiet hours, config defaults, APNs disabled unless fully
  configured, APNs request/JWT/error mapping (fake transport), registration, ownership moves,
  unregistering, dispatch with preferences, dead-token handling, push off.
- `test/rls.test.ts`: RLS on both new tables (identities owner-readable, devices server-only).
- `HealthMateCore`: `PushDeviceTests` (models).
