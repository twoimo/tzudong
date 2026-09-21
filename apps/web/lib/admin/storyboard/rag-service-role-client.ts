/**
 * Bounded structural view of the Supabase service-role client used by the storyboard
 * RAG routes.
 *
 * The `documents` table and the hybrid-search RPC are worker-owned schema objects that
 * are intentionally absent from the generated `Database` types. Both routes therefore
 * narrow the privileged client to exactly the surface they call, so a schema or argument
 * rename fails at the call site instead of silently widening to `any`.
 *
 * The privileged client itself remains server-only: this module only describes shape and
 * imports nothing from `@/lib/supabase/service-role`.
 */

export type StoryboardRagDocumentUpsertRow = {
  user_id: string;
  external_id: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: string;
  sparse_lexical_weights: Record<string, number>;
};

export type StoryboardRagServiceError = { message?: string } | null;

export type StoryboardRagUpsertSelection = {
  data: { id: string }[] | null;
  error: StoryboardRagServiceError;
};

export type StoryboardRagDocumentsClient = {
  from: (table: string) => {
    upsert: (
      rows: StoryboardRagDocumentUpsertRow[],
      options: { onConflict: string },
    ) => {
      select: (columns: string) => Promise<StoryboardRagUpsertSelection>;
    };
  };
};

export type StoryboardRagHybridSearchArgs = {
  p_user_id: string;
  p_query_embedding: string;
  p_query_sparse: Record<string, number>;
  p_dense_weight: number;
  p_match_count: number;
  p_candidate_count: number;
  p_metadata_filter: Record<string, unknown>;
};

export type StoryboardRagRpcClient<TRow> = {
  rpc: (
    fn: string,
    args: StoryboardRagHybridSearchArgs,
  ) => Promise<{ data: TRow[] | null; error: StoryboardRagServiceError }>;
};
