import { createHash } from "node:crypto";

/** Dimension of health_memories.embedding (gte-small). */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Turns text into vectors for finding related health memories. Similarity is
 * only used to pick context for the assistant — never as evidence that a
 * fact is true; every memory keeps its provenance.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly available: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDINGS = Symbol("EMBEDDINGS");

/**
 * Production: Supabase's built-in gte-small model, run by the `embed` Edge
 * Function in the same Supabase project (supabase/functions/embed), so health
 * text doesn't go to another company. Called server-side only (secret key +
 * EMBED_FUNCTION_SECRET).
 */
export class SupabaseEmbeddingProvider implements EmbeddingProvider {
  readonly name = "supabase/gte-small";
  readonly available = true;

  constructor(
    private readonly supabaseUrl: string,
    private readonly secretKey: string,
    private readonly functionSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.fetchImpl(`${this.supabaseUrl.replace(/\/$/, "")}/functions/v1/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.secretKey, "x-healthmate-secret": this.functionSecret },
      body: JSON.stringify({ input: texts }),
    });
    if (!res.ok) throw new Error(`embedding request failed (${res.status})`);
    const body = (await res.json()) as { embeddings?: number[][] };
    if (!body.embeddings || body.embeddings.length !== texts.length || body.embeddings.some((e) => e.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error("unexpected embedding response");
    }
    return body.embeddings;
  }
}

/**
 * Development/test only: deterministic hashed bag-of-words vectors. Similar
 * wording ⇒ similar vectors; no model, no network. Not for production.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "hash-dev";
  readonly available = true;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        const stem = token.length > 4 ? token.slice(0, token.length - 1) : token; // crude: "headaches" ≈ "headache"
        const h = createHash("sha256").update(stem).digest();
        v[h.readUInt16BE(0) % EMBEDDING_DIMENSIONS]! += h[2]! % 2 ? 1 : -1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/** No embeddings configured: retrieval falls back to full-text search. */
export class NoEmbeddingProvider implements EmbeddingProvider {
  readonly name = "none";
  readonly available = false;
  async embed(): Promise<number[][]> {
    throw new Error("embeddings are not configured");
  }
}

/** pgvector literal for a query parameter (`$1::vector`). */
export function toVectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v : 0)).join(",")}]`;
}
