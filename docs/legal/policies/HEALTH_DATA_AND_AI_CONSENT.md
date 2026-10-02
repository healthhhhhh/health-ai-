# Health Data and AI Consent Notice — DRAFT

> Unpublished draft, not yet reviewed by a lawyer. See `README.md`. Show it (or link it) next to the
> in-app permission switches, before they're turned on.

HealthMate has three permissions, each off until you turn it on. You can turn any of them off at any time
in Settings. HealthMate checks the permission again whenever the work actually runs, so turning
one off also stops anything still waiting. A request that has **already been sent** to the AI provider
can't be recalled, but its answer is thrown away and not saved.

The AI provider is **[[OWNER: legal name, e.g. Anthropic, PBC]]**. All AI requests go through
HealthMate's servers; the apps never contact the provider directly. [[OWNER: from the provider's contract —
how long it keeps requests, whether it trains on them (expected: no), and where it processes data.]]

## 1. AI Health Assistant (`ai_processing`)

Lets you chat with the AI Health Assistant. With each question we send the provider:
- your message and up to the last 20 messages of the conversation;
- a summary of your profile: **age in whole years (never your date of birth)**, sex, conditions,
  allergies, and medications with their instructions;
- health memories relevant to the question;
- summaries of relevant daily data — **Apple Health summaries only while Apple Health sync is also on**;
- if you're 13–17, an instruction to keep answers age-appropriate.

**Never sent:** your email, password, date of birth, location or device details.
Messages that match emergency rules never go to the AI — you get fixed emergency guidance instead.

## 2. Report and photo analysis (`document_processing`)

Lets you get plain-language explanations of reports and photos. We send the provider the **whole file**
you upload (anything printed on it, such as your name, goes too) or the **photo** (location data removed
on your device first) plus any note you add.

## 3. Apple Health sync (`health_data_sync`, iPhone)

Stores the Apple Health measurements you choose (steps, heart rate, resting heart rate, active energy,
weight, sleep) in your HealthMate account as daily summaries. While AI Health Assistant is also on,
relevant summaries can be included in chat as described above. You can delete all Apple Health data
from HealthMate at any time.

## Voice input (`voice`)

Voice input on iPhone is turned into text by Apple's speech recognition, on your device when it supports
that and otherwise by Apple. HealthMate receives only the text. [[OWNER: confirm the in-app wording.]]
