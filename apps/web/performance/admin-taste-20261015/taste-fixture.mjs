import { z } from 'zod';
import {
  KNOWLEDGE_KINDS,
  isKnowledgeGraphPage,
} from '../../types/knowledge-graph.ts';
import {
  PIPELINE_FLOW_STAGES,
  parsePipelineManifest,
  parsePipelineStatus,
} from '../../lib/admin/pipeline-flow-view-model.ts';
import {
  FEATURE_DATABASE_HELD,
  FEATURE_DATABASE_READY,
  parseFeatureDatabaseReadiness,
} from '../../lib/runtime-feature-readiness-contract.ts';
import {
  STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL,
  STORYBOARD_GEMINI_TEXT_MODEL,
  storyboardGeminiDeclaredModels,
} from '../../lib/admin/storyboard/gemini-models.ts';
import { storyboardWorkerSupportsPair } from '../../lib/admin/storyboard/production-model-catalog.ts';

const revision = 'a'.repeat(64);
const observedAt = '2026-10-15T00:00:00.000Z';
const workerId = '00000000-0000-4000-8000-000000000001';
const integrationSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  reachable: z.boolean(),
  checkedAt: z.iso.datetime({ offset: true }),
}).passthrough();
const providerReadinessSchema = z.object({
  provider: z.string().min(1),
  status: z.enum(['ready', 'degraded', 'unavailable', 'unknown']),
  reasonCode: z.string().min(1),
  checkedAt: z.iso.datetime({ offset: true }),
  remediation: z.string(),
  diagnostics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();
const systemStatusSchema = z.object({
  asOf: z.iso.datetime({ offset: true }),
  keys: z.object({
    supabaseUrl: z.boolean(),
    supabaseServiceRoleKey: z.boolean(),
    geminiServerKey: z.boolean(),
    openaiServerKey: z.boolean(),
    anthropicServerKey: z.boolean(),
    nanoBanana2Key: z.boolean(),
  }).strict(),
  storyboardAgent: integrationSchema,
  bgeEmbedding: integrationSchema,
  frameCaption: z.object({
    configured: z.boolean(),
    localPathConfigured: z.boolean(),
    localPathAvailable: z.boolean(),
    gdrivePathConfigured: z.boolean(),
    reachable: z.boolean(),
    checkedAt: z.iso.datetime({ offset: true }),
  }).passthrough(),
  runDaily: z.object({
    executable: z.boolean(),
    manifestStatus: z.enum(['available', 'missing', 'unreadable']),
    finalStatus: z.enum(['OK', 'WARN', 'ERROR', 'UNKNOWN']),
    latestManifestPath: z.string().min(1),
    latestLogPath: z.string().min(1),
    stepEvents: z.array(z.object({
      name: z.string().min(1),
      status: z.enum(['completed', 'failed', 'optional_skipped', 'downstream_skipped']),
      durationSeconds: z.number().nonnegative(),
    }).strict()),
    stale: z.boolean(),
    checkedAt: z.iso.datetime({ offset: true }),
  }).passthrough(),
  providerReadiness: z.object({
    'naver-directions': providerReadinessSchema,
    'youtube-thumbnail-durable-release': providerReadinessSchema,
  }).strict(),
  checklist: z.array(z.unknown()),
  pipelineControl: z.object({
    reachable: z.boolean(),
    source: z.enum(['job_api', 'manifest', 'none']),
  }).strict(),
}).passthrough();
const modelSchema = z.object({
  id: z.string().min(1).max(200),
  owned_by: z.enum(['gemini-api', 'mlx-serve']).optional(),
  capabilities: z.array(z.string().min(1).max(80)).max(32),
  loaded: z.boolean(),
  bytes_on_disk: z.number().int().nonnegative(),
  bytes_resident: z.number().int().nonnegative(),
}).strict();
const storyboardCatalogSchema = z.object({
  ok: z.literal(true),
  projects: z.array(z.object({
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    status: z.enum(['waiting_worker', 'generating', 'awaiting_import', 'partial', 'ready', 'failed', 'cancelled']),
    title: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  }).strict()).max(50),
  readiness: z.object({
    schemaVersion: z.literal(1),
    status: z.enum(['ready', 'held']),
    code: z.enum(['FEATURE_DATABASE_READY', 'FEATURE_DATABASE_HELD']),
  }).strict(),
  workers: z.array(z.object({
    id: z.uuid(),
    online: z.boolean(),
    lastHeartbeat: z.iso.datetime({ offset: true }).nullable(),
    models: z.array(modelSchema).max(64),
  }).strict()).max(64),
}).strict();

const knowledgeNodes = [
  { id: 'hub:tzudong', label: '쯔동 지식 허브', kind: 'hub', summary: '합성 지식 그래프의 프로젝트 루트입니다.', evidence: [] },
  { id: 'video:fixture-one', label: '합성 영상 기록', displayTitle: '합성 영상 기록', displayStage: 'caption-first-pass', kind: 'video', summary: '브라우저 상호작용 검증용 합성 영상입니다.', evidence: [] },
  { id: 'restaurant:fixture-one', label: '합성 맛집', kind: 'restaurant', summary: '필터와 상세 패널 검증용 합성 맛집입니다.', evidence: [{ videoId: 'abcdefghijk', startSeconds: 0, endSeconds: 30, url: 'https://www.youtube.com/watch?v=abcdefghijk', status: 'verified' }] },
  { id: 'menu:fixture-one', label: '합성 대표 메뉴', kind: 'menu', summary: '범주 구분 검증용 합성 메뉴입니다.', evidence: [] },
  { id: 'claim:fixture-one', label: '합성 분석 근거', kind: 'claim', summary: '근거 상세 패널 검증용 합성 분석입니다.', evidence: [] },
];
const knowledgeEdges = [
  { id: 'edge:hub-video', source: 'hub:tzudong', target: 'video:fixture-one', relation: 'references' },
  { id: 'edge:video-restaurant', source: 'video:fixture-one', target: 'restaurant:fixture-one', relation: 'references' },
  { id: 'edge:restaurant-menu', source: 'restaurant:fixture-one', target: 'menu:fixture-one', relation: 'references' },
  { id: 'edge:video-claim', source: 'video:fixture-one', target: 'claim:fixture-one', relation: 'derived-from' },
];
const knowledgeCoverage = {
  inventoryCount: 5,
  eligibleCount: 5,
  analyzedCount: 5,
  pendingCount: 0,
  failedCount: 0,
  excludedShortsCount: 0,
  asOf: observedAt,
};

function knowledgePage(url) {
  const parsed = new URL(url);
  const kind = parsed.searchParams.get('kind');
  const query = parsed.searchParams.get('q')?.normalize('NFKC').trim().toLocaleLowerCase('ko-KR') ?? '';
  const filtered = knowledgeNodes.filter(node => (!kind || node.kind === kind)
    && (!query || `${node.label} ${node.summary}`.normalize('NFKC').toLocaleLowerCase('ko-KR').includes(query)));
  const ids = new Set(filtered.map(node => node.id));
  const edges = knowledgeEdges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const page = {
    revision,
    generatedAt: observedAt,
    coverage: knowledgeCoverage,
    nodes: filtered,
    edges,
    selected: null,
    totalNodes: knowledgeNodes.length,
    totalEdges: knowledgeEdges.length,
    filteredTotal: filtered.length,
    omittedEdges: knowledgeEdges.length - edges.length,
    nextCursor: null,
  };
  if (!isKnowledgeGraphPage(page)) throw new Error('INVALID_KNOWLEDGE_FIXTURE');
  return page;
}

const pipelineStatus = {
  source: 'job_api',
  jobs: [{
    id: '00000000-0000-4000-8000-000000000010',
    target: 'tzuyang',
    profile: 'heavy_local',
    status: 'Succeeded',
    dry_run: true,
    adapter_index: 7,
  }],
  failures: [],
  targets: [{ id: 'tzuyang', status: 'Idle' }],
  gauges: {
    tzudong_pipeline_kafka_lag: 0,
    tzudong_pipeline_es_rows_per_sec: 12,
    tzudong_pipeline_process_cpu_ratio: 0.18,
    tzudong_pipeline_process_rss_bytes: 268435456,
  },
  dataEnv: 'local_db',
  hardware: 'macbook_m5_max',
};
const stepEvents = PIPELINE_FLOW_STAGES.flatMap((stage, stageIndex) => stage.steps.map((name, stepIndex) => ({
  name,
  status: 'completed',
  durationSeconds: stageIndex + stepIndex + 1,
})));
const providerReady = provider => ({
  provider,
  status: 'ready',
  reasonCode: 'SYNTHETIC_READY',
  checkedAt: observedAt,
  remediation: '',
  diagnostics: { synthetic: true },
});
const systemStatus = {
  asOf: observedAt,
  keys: {
    supabaseUrl: true,
    supabaseServiceRoleKey: true,
    geminiServerKey: true,
    openaiServerKey: false,
    anthropicServerKey: false,
    nanoBanana2Key: true,
  },
  storyboardAgent: { enabled: true, configured: true, reachable: true, checkedAt: observedAt },
  bgeEmbedding: { enabled: true, configured: true, reachable: true, checkedAt: observedAt },
  frameCaption: {
    configured: true,
    localPathConfigured: true,
    localPathAvailable: true,
    gdrivePathConfigured: true,
    reachable: true,
    checkedAt: observedAt,
  },
  runDaily: {
    executable: true,
    latestLogPath: '/synthetic/run-daily.log',
    latestManifestPath: '/synthetic/run-daily.json',
    manifestStatus: 'available',
    finalStatus: 'OK',
    stepEvents,
    stale: false,
    checkedAt: observedAt,
  },
  providerReadiness: {
    'naver-directions': providerReady('naver-directions'),
    'youtube-thumbnail-durable-release': providerReady('youtube-thumbnail-durable-release'),
  },
  checklist: [],
  pipelineControl: { reachable: true, source: 'job_api' },
};
const declaredModels = storyboardGeminiDeclaredModels();
const storyboardReady = {
  ok: true,
  projects: [],
  readiness: FEATURE_DATABASE_READY,
  workers: [{ id: workerId, online: true, lastHeartbeat: observedAt, models: declaredModels }],
};
const storyboardHeld = {
  ...storyboardReady,
  readiness: FEATURE_DATABASE_HELD,
};

export function validateTasteFixtures() {
  for (const kind of ['', ...KNOWLEDGE_KINDS]) {
    knowledgePage(`${originForValidation()}/api/admin/knowledge-graph${kind ? `?kind=${kind}` : ''}`);
  }
  const parsedPipeline = parsePipelineStatus(pipelineStatus);
  if (parsedPipeline.source !== 'job_api' || parsedPipeline.partial || parsedPipeline.jobs.length !== 1) {
    throw new Error('INVALID_PIPELINE_FIXTURE');
  }
  const parsedManifest = parsePipelineManifest(systemStatus);
  if (parsedManifest.availability !== 'available' || parsedManifest.invalidEvents !== 0
    || parsedManifest.events.length !== stepEvents.length) throw new Error('INVALID_SYSTEM_STATUS_FIXTURE');
  systemStatusSchema.parse(systemStatus);
  for (const fixture of [storyboardReady, storyboardHeld]) storyboardCatalogSchema.parse(fixture);
  if (parseFeatureDatabaseReadiness(storyboardReady.readiness).status !== 'ready'
    || parseFeatureDatabaseReadiness(storyboardHeld.readiness).status !== 'held') {
    throw new Error('INVALID_STORYBOARD_READINESS_FIXTURE');
  }
  if (!storyboardWorkerSupportsPair(
    storyboardReady.workers,
    STORYBOARD_GEMINI_TEXT_MODEL,
    STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL,
  )) throw new Error('INVALID_STORYBOARD_WORKER_FIXTURE');
  return {
    knowledgeKinds: KNOWLEDGE_KINDS.length,
    pipelineJobs: parsedPipeline.jobs.length,
    pipelineEvents: parsedManifest.events.length,
    storyboardWorkers: storyboardReady.workers.length,
    storyboardModels: declaredModels.length,
    states: ['success', 'error', 'held'],
  };
}

function originForValidation() {
  return 'http://127.0.0.1:18822';
}

const validated = validateTasteFixtures();

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: {
      'cache-control': 'no-store',
      'x-tzudong-local-fixture': 'admin-taste-20261015-v2',
    },
    body: JSON.stringify(body),
  });
}

export async function installTasteFixture(page, options = {}) {
  const states = {
    knowledgeGraph: options.knowledgeGraph ?? 'success',
    pipeline: options.pipeline ?? 'success',
    systemStatus: options.systemStatus ?? 'success',
    storyboard: options.storyboard ?? 'ready',
  };
  if (!['success', 'error'].includes(states.knowledgeGraph)
    || !['success', 'error'].includes(states.pipeline)
    || !['success', 'error'].includes(states.systemStatus)
    || !['ready', 'held', 'error'].includes(states.storyboard)) throw new Error('INVALID_TASTE_FIXTURE_STATE');

  await page.route('**/api/admin/knowledge-graph**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (states.knowledgeGraph === 'error') return json(route, { error: 'synthetic_unavailable' }, 503);
    return json(route, knowledgePage(route.request().url()));
  });
  await page.route('**/api/admin/pipeline**', async route => {
    const parsed = new URL(route.request().url());
    if (route.request().method() !== 'GET' || parsed.pathname !== '/api/admin/pipeline') return route.fallback();
    if (states.pipeline === 'error') return json(route, { error: 'synthetic_unavailable' }, 503);
    return json(route, pipelineStatus);
  });
  await page.route('**/api/admin/system-status**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (states.systemStatus === 'error') return json(route, { error: 'synthetic_unavailable' }, 503);
    return json(route, systemStatus);
  });
  await page.route('**/api/admin/storyboard/production**', async route => {
    const parsed = new URL(route.request().url());
    if (route.request().method() !== 'GET' || parsed.pathname !== '/api/admin/storyboard/production') return route.fallback();
    if (states.storyboard === 'error') return json(route, { errorCode: 'persistence_unavailable' }, 503);
    return json(route, states.storyboard === 'held' ? storyboardHeld : storyboardReady);
  });
  return { ...validated, installedStates: states };
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(validated)}\n`);
