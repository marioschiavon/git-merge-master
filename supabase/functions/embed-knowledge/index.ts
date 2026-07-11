// Embeds company_knowledge documents into knowledge_chunks via pgvector.
// Modes:
//  - { knowledge_id: "..." }  -> re-embed a single document
//  - { company_id: "..." }    -> re-embed all docs of a company
//  - { all: true }            -> re-embed every company (admin/cron)

import { createClient } from "npm:@supabase/supabase-js@2";
import { createEmbedding } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_SIZE) return [clean];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + CHUNK_SIZE, clean.length);
    let slice = clean.slice(i, end);
    // try to break on paragraph/sentence boundary near the end
    if (end < clean.length) {
      const lastBreak = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
      );
      if (lastBreak > CHUNK_SIZE * 0.5) {
        slice = slice.slice(0, lastBreak + 1);
      }
    }
    chunks.push(slice.trim());
    i += slice.length - CHUNK_OVERLAP;
    if (i <= 0) i = slice.length;
  }
  return chunks.filter((c) => c.length > 20);
}

async function embedDocument(doc: {
  id: string;
  company_id: string;
  title: string;
  content: string;
  type: string;
  source_url: string | null;
}) {
  // Delete existing chunks for this knowledge_id
  await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("knowledge_id", doc.id);

  const text = `# ${doc.title}\n\n${doc.content}`;
  const chunks = chunkText(text);
  if (chunks.length === 0) return { knowledge_id: doc.id, chunks: 0 };

  // Embed and insert per-batch to keep memory usage low
  const batchSize = 8;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const emb = await createEmbedding({ input: batch });
    const insertRows = batch.map((chunk, j) => {
      const e = emb.data[j].embedding as unknown as number[];
      return {
        company_id: doc.company_id,
        knowledge_id: doc.id,
        chunk,
        embedding: `[${(e as number[]).join(",")}]`,
        metadata: {
          title: doc.title,
          type: doc.type,
          source_url: doc.source_url,
          chunk_index: i + j,
        },
        token_count: Math.ceil(chunk.length / 4),
      };
    });
    const { error } = await supabase.from("knowledge_chunks").insert(insertRows);
    if (error) throw error;
  }

  await supabase
    .from("company_knowledge")
    .update({ needs_embedding: false, embedded_at: new Date().toISOString() })
    .eq("id", doc.id);

  return { knowledge_id: doc.id, chunks: chunks.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { knowledge_id, company_id, all } = body as {
      knowledge_id?: string;
      company_id?: string;
      all?: boolean;
    };

    let q = supabase
      .from("company_knowledge")
      .select("id, company_id, title, content, type, source_url");

    if (knowledge_id) q = q.eq("id", knowledge_id);
    else if (company_id) q = q.eq("company_id", company_id);
    else if (!all) {
      return new Response(
        JSON.stringify({ error: "Provide knowledge_id, company_id, or all=true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: docs, error } = await q;
    if (error) throw error;

    const results = [];
    for (const doc of docs ?? []) {
      try {
        results.push(await embedDocument(doc));
      } catch (e) {
        results.push({ knowledge_id: doc.id, error: String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("embed-knowledge error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
