// Supabase Edge Function: text → 384-dim embeddings with Supabase's built-in
// gte-small model. Called only by the HealthMate API (shared secret), so
// health text never leaves the Supabase project. Deploy: `supabase functions deploy embed`.
//
// deno-lint-ignore-file no-explicit-any
declare const Supabase: any;
declare const Deno: any;

const session = new Supabase.ai.Session("gte-small");
const MAX_INPUTS = 64;
const MAX_CHARS = 2000;

Deno.serve(async (req: Request) => {
  // Only the HealthMate API may call this function: it sends a shared secret
  // set with `supabase secrets set EMBED_FUNCTION_SECRET=…` (never in clients).
  const expected = Deno.env.get("EMBED_FUNCTION_SECRET");
  if (!expected || req.headers.get("x-healthmate-secret") !== expected) return new Response("Forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let input: unknown;
  try {
    input = (await req.json()).input;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_INPUTS || input.some((t) => typeof t !== "string")) {
    return new Response("`input` must be 1–64 strings", { status: 400 });
  }
  const embeddings: number[][] = [];
  for (const text of input as string[]) {
    embeddings.push(Array.from(await session.run(text.slice(0, MAX_CHARS), { mean_pool: true, normalize: true })));
  }
  return Response.json({ model: "gte-small", embeddings });
});
