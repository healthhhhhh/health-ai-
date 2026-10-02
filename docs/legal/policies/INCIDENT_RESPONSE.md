# Incident response (internal) — DRAFT

Keep it short and act quickly. **Never copy health data into notes, chat or tickets** — use row ids and counts.

**Contacts:** lead [[OWNER: name, phone]] · lawyer [[OWNER]] · Supabase/hosting support [[OWNER]] ·
AI provider security contact [[OWNER]] · public security inbox [[OWNER: security@ address]]

1. **Record** (immediately): time found, who found it, what's known — in [[OWNER: location]].
2. **Contain** (first hours):
   - rotate any exposed secret: Supabase secret key, `JWT_SECRET`, `PUSH_TOKEN_KEY`,
     `EMBED_FUNCTION_SECRET`, the AI provider key, the APNs key;
   - sign out affected sessions (Supabase Auth);
   - switch off the affected feature by configuration (e.g. `AI_PROVIDER=none`);
   - save logs and `audit_logs` rows before retention removes them.
3. **Assess:** what data, whose, how many people, which states; whether teens are affected; whether a
   provider (Supabase, hosting, AI) is the source.
4. **Notify (with the lawyer):** affected people, and where required the FTC (Health Breach Notification
   Rule, if it applies), state attorneys general, Apple and Google. The FTC rule's outer limit for
   notifying people is 60 days after discovery — don't wait for it. Notices use plain language and no more
   health detail than needed.
5. **Fix and review:** fix the cause, add a regression test, write down what happened and update the
   privacy documents if anything they say changed.
