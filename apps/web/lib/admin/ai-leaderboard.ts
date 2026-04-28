import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';
import type { AdminAiCandidateModel } from '@/lib/admin/ai-settings-store';

export const ARENA_LEADERBOARD_DATASET = 'lmarena-ai/leaderboard-dataset';
export const ARENA_LEADERBOARD_CONFIG = 'vision';
export const ARENA_LEADERBOARD_SPLIT = 'latest';

const ARENA_FIRST_ROWS_ENDPOINT = 'https://datasets-server.huggingface.co/first-rows';
const MAX_ROUTING_CANDIDATES = 8;

export type ArenaLeaderboardRow = {
  model_name?: string;
  organization?: string;
  rating?: number;
  vote_count?: number;
  rank?: number;
  category?: string;
  leaderboard_publish_date?: string;
};

export type AiLeaderboardCandidate = AdminAiCandidateModel & {
  source: 'arena_ai';
  arenaRank: number | null;
  arenaRating: number | null;
  voteCount: number | null;
  leaderboardConfig: string;
  publishedAt: string | null;
};

export type AiLeaderboardSnapshot = {
  id?: string;
  source: 'arena_ai';
  leaderboardConfig: string;
  fetchedAt: string;
  candidates: AiLeaderboardCandidate[];
  payload: Record<string, unknown>;
  createdByAdminId?: string | null;
};

type DatasetFirstRowsPayload = {
  rows?: Array<{ row?: ArenaLeaderboardRow }>;
  truncated?: boolean;
};

function serviceRoleConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function isMissingRelationError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === '42P01',
  );
}

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapArenaModelToNimModel(modelName: string): string | null {
  const normalized = modelName.toLowerCase().replace(/[_\s]+/g, '-');

  if (normalized.includes('glm-4.7') || normalized.includes('glm4.7')) {
    return 'z-ai/glm-4.7';
  }
  if (normalized.includes('kimi-k2-thinking')) {
    return 'moonshotai/kimi-k2-thinking';
  }
  if (normalized.includes('minimax-m2.7')) {
    return 'minimaxai/minimax-m2.7';
  }
  if (normalized.includes('minimax-m2.1')) {
    return 'minimaxai/minimax-m2.1-preview';
  }
  if (normalized.includes('nemotron') && normalized.includes('vl')) {
    return 'nvidia/nemotron-nano-12b-v2-vl';
  }

  return null;
}

export function buildArenaNimCandidates(rows: ArenaLeaderboardRow[]): AiLeaderboardCandidate[] {
  const seen = new Set<string>();
  const candidates: AiLeaderboardCandidate[] = [];

  for (const row of rows) {
    if (sanitizeText(row.category) !== 'overall') continue;

    const modelName = sanitizeText(row.model_name);
    if (!modelName) continue;

    const nimModel = mapArenaModelToNimModel(modelName);
    if (!nimModel) continue;

    const key = nimModel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      id: `arena_ai:nvidia_nim:${nimModel}`,
      provider: 'nvidia_nim',
      model: nimModel,
      label: `Arena.ai Vision #${row.rank ?? '?'} · ${modelName}`,
      source: 'arena_ai',
      arenaRank: toNumber(row.rank),
      arenaRating: toNumber(row.rating),
      voteCount: toNumber(row.vote_count),
      leaderboardConfig: ARENA_LEADERBOARD_CONFIG,
      publishedAt: sanitizeText(row.leaderboard_publish_date),
    });

    if (candidates.length >= MAX_ROUTING_CANDIDATES) break;
  }

  return candidates;
}

export async function fetchArenaLeaderboardSnapshot(params: {
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<AiLeaderboardSnapshot> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = new URL(ARENA_FIRST_ROWS_ENDPOINT);
  url.searchParams.set('dataset', ARENA_LEADERBOARD_DATASET);
  url.searchParams.set('config', ARENA_LEADERBOARD_CONFIG);
  url.searchParams.set('split', ARENA_LEADERBOARD_SPLIT);

  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Arena.ai leaderboard fetch failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as DatasetFirstRowsPayload;
  const rows = (payload.rows ?? [])
    .map((entry) => entry.row)
    .filter((row): row is ArenaLeaderboardRow => Boolean(row));

  return {
    source: 'arena_ai',
    leaderboardConfig: ARENA_LEADERBOARD_CONFIG,
    fetchedAt: (params.now ?? new Date()).toISOString(),
    candidates: buildArenaNimCandidates(rows),
    payload: {
      endpoint: url.toString(),
      dataset: ARENA_LEADERBOARD_DATASET,
      config: ARENA_LEADERBOARD_CONFIG,
      split: ARENA_LEADERBOARD_SPLIT,
      truncated: Boolean(payload.truncated),
      rows,
    },
  };
}

function rowToSnapshot(row: {
  id?: string;
  source?: string;
  leaderboard_config?: string;
  fetched_at?: string;
  candidate_models?: unknown;
  payload?: unknown;
  created_by_admin_id?: string | null;
} | null): AiLeaderboardSnapshot | null {
  if (!row || row.source !== 'arena_ai') return null;

  const rawCandidates = Array.isArray(row.candidate_models) ? row.candidate_models : [];
  const candidates = rawCandidates.filter((item): item is AiLeaderboardCandidate => {
    return Boolean(
      item
        && typeof item === 'object'
        && (item as { provider?: string }).provider === 'nvidia_nim'
        && typeof (item as { model?: unknown }).model === 'string',
    );
  });

  return {
    id: row.id,
    source: 'arena_ai',
    leaderboardConfig: row.leaderboard_config ?? ARENA_LEADERBOARD_CONFIG,
    fetchedAt: row.fetched_at ?? new Date(0).toISOString(),
    candidates,
    payload: row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {},
    createdByAdminId: row.created_by_admin_id ?? null,
  };
}

export async function getLatestAiLeaderboardSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AiLeaderboardSnapshot | null> {
  if (!serviceRoleConfigured(env)) return null;

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('admin_ai_leaderboard_snapshots' as never)
      .select('id, source, leaderboard_config, fetched_at, candidate_models, payload, created_by_admin_id')
      .eq('source', 'arena_ai')
      .eq('leaderboard_config', ARENA_LEADERBOARD_CONFIG)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }

    return rowToSnapshot(data as never);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

export async function getLatestOcrLeaderboardCandidateModels(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminAiCandidateModel[]> {
  const snapshot = await getLatestAiLeaderboardSnapshot(env);
  return snapshot?.candidates.map((candidate) => ({
    id: candidate.id,
    provider: candidate.provider,
    model: candidate.model,
    label: candidate.label,
  })) ?? [];
}

export async function syncArenaLeaderboardSnapshot(params: {
  adminUserId?: string | null;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<AiLeaderboardSnapshot> {
  const env = params.env ?? process.env;
  if (!serviceRoleConfigured(env)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY가 없어 Arena.ai 스냅샷을 저장할 수 없습니다.');
  }

  const snapshot = await fetchArenaLeaderboardSnapshot({ fetchImpl: params.fetchImpl });
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('admin_ai_leaderboard_snapshots' as never)
    .insert({
      source: snapshot.source,
      leaderboard_config: snapshot.leaderboardConfig,
      payload: snapshot.payload,
      candidate_models: snapshot.candidates,
      created_by_admin_id: params.adminUserId ?? null,
    } as never)
    .select('id, source, leaderboard_config, fetched_at, candidate_models, payload, created_by_admin_id')
    .single();

  if (error) {
    throw new Error(`Arena.ai 스냅샷 저장 실패: ${error.message}`);
  }

  return rowToSnapshot(data as never) ?? snapshot;
}
