import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStoryboardPlannerOutput, generateLocalStoryboard } from '../lib/admin/storyboard/generator';
import { evaluateStoryboardRagExperiment } from '../lib/admin/storyboard/rag-evaluation';
import {
  buildStoryboardRagFailureStatus,
  formatStoryboardRagFailureTraceDetail,
} from '../lib/admin/storyboard/rag-error-status';
import {
  buildStoryboardRagDocuments,
  buildStoryboardRagModelStackDiagnostics,
  buildStoryboardRagProfileTraceDetail,
  getStoryboardRagExecutionProfiles,
  resolveStoryboardRagExecutionProfile,
  runStoryboardLocalRag,
} from '../lib/admin/storyboard/rag';
import type {
  StoryboardGenerateRequest,
  StoryboardGenerationResult,
  StoryboardHeatmapSource,
} from '../lib/admin/storyboard/types';

function request(prompt: string): StoryboardGenerateRequest {
  return {
    prompt,
    tone: 'warm',
    targetLengthMinutes: 18,
    sourceLimit: 20,
    segmentCount: 8,
    includeProductionNotes: true,
    generationMode: 'local_heatmap',
  };
}

function sources(): StoryboardHeatmapSource[] {
  return [
    {
      videoId: 'irrelevant-spicy-001',
      youtubeLink: 'https://www.youtube.com/watch?v=irrelevant-spicy-001',
      durationSeconds: 900,
      collectedAt: '2026-01-01T00:00:00.000Z',
      replayPeakScore: 1,
      markers: [
        {
          startMillis: 60_000,
          endMillis: 75_000,
          peakMillis: 66_000,
          label: '매운 떡볶이 폭발 리액션',
          peakTime: '01:06',
          replayScore: 1,
        },
      ],
    },
    {
      videoId: 'convenience-combo-001',
      youtubeLink: 'https://www.youtube.com/watch?v=convenience-combo-001',
      durationSeconds: 900,
      collectedAt: '2026-01-01T00:00:00.000Z',
      replayPeakScore: 0.92,
      markers: [
        {
          startMillis: 120_000,
          endMillis: 135_000,
          peakMillis: 126_000,
          label: '삼각김밥 치즈 컵라면 조합 피크',
          peakTime: '02:06',
          replayScore: 0.92,
        },
      ],
    },
  ];
}

function withRelevantHeatmapFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tzudong-storyboard-rag-eval-'));
  for (let index = 0; index < 10; index += 1) {
    const videoId = `rag-eval-${String(index).padStart(3, '0')}`;
    const peakMillis = 120_000 + index * 10_000;
    writeFileSync(
      path.join(dir, `${videoId}.jsonl`),
      `${JSON.stringify({
        youtube_link: `https://www.youtube.com/watch?v=${videoId}`,
        channel_name: 'tzuyang',
        video_id: videoId,
        duration: 900,
        interaction_data: [
          { startMillis: String(peakMillis), durationMillis: '10000', intensityScoreNormalized: 0.96, formatted_time: '02:00' },
        ],
        most_replayed_markers: [
          {
            startMillis: peakMillis - 5_000,
            endMillis: peakMillis + 10_000,
            peakMillis,
            label: '삼각김밥 치즈 컵라면 조합 피크',
          },
        ],
        status: 'success',
        collected_at: '2026-01-01T00:00:00.000Z',
      })}\n`,
      'utf8',
    );
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
function withRelevantHeatmapResult<T>(callback: (result: StoryboardGenerationResult) => T) {
  const fixture = withRelevantHeatmapFixture();
  const previous = process.env.TZUYANG_HEATMAP_DIR;
  process.env.TZUYANG_HEATMAP_DIR = fixture.dir;
  try {
    return callback(
      generateLocalStoryboard({
        prompt: '편의점 삼각김밥 치즈 컵라면 조합 먹방 스토리보드',
        tone: 'warm',
        targetLengthMinutes: 16,
        sourceLimit: 10,
        segmentCount: 8,
        includeProductionNotes: true,
      }),
    );
  } finally {
    if (previous === undefined) {
      delete process.env.TZUYANG_HEATMAP_DIR;
    } else {
      process.env.TZUYANG_HEATMAP_DIR = previous;
    }
    fixture.cleanup();
  }
}

function tamperLocalRag(
  result: StoryboardGenerationResult,
  patch: Record<string, unknown>,
): StoryboardGenerationResult {
  const localRag = result.backendAnalysis.localRag;
  if (!localRag) throw new Error('Expected local RAG diagnostics for tamper test');
  return {
    ...result,
    backendAnalysis: {
      ...result.backendAnalysis,
      localRag: {
        ...localRag,
        ...patch,
      } as NonNullable<StoryboardGenerationResult['backendAnalysis']['localRag']>,
    },
  };
}


describe('storyboard local RAG layer', () => {
  test('builds typed prompt, topic, scene, and heatmap documents from local storyboard evidence', () => {
    const baseRequest = request('편의점 라면, 삼각김밥, 치즈 조합 먹방 스토리보드');
    const planner = createStoryboardPlannerOutput(baseRequest, {
      dataModeLabel: '로컬 히트맵 모드',
      isFallbackData: false,
      mode: 'local_heatmap_fixture',
    });

    const documents = buildStoryboardRagDocuments({
      request: baseRequest,
      planner,
      sources: sources(),
    });

    expect(documents.some((document) => document.source === 'prompt')).toBe(true);
    expect(documents.some((document) => document.source === 'topic_profile')).toBe(true);
    expect(documents.filter((document) => document.source === 'scene_draft')).toHaveLength(8);
    expect(documents.filter((document) => document.source === 'heatmap_marker')).toHaveLength(2);
    expect(JSON.stringify(documents)).toContain('편의점 조합 먹방');
    expect(JSON.stringify(documents)).toContain('삼각김밥 치즈 컵라면 조합 피크');
  });

  test('reports required BGE providers while marking local unit RAG as fixture-only', () => {
    const baseRequest = request('편의점 삼각김밥 치즈 컵라면 조합으로 만들기');
    const planner = createStoryboardPlannerOutput(baseRequest, {
      dataModeLabel: '로컬 히트맵 모드',
      isFallbackData: false,
      mode: 'local_heatmap_fixture',
    });

    const diagnostics = runStoryboardLocalRag({
      request: baseRequest,
      planner,
      sources: sources(),
      topK: 4,
      candidateLimit: 10,
    });

    expect(diagnostics.status).toBe('fixture_only');
    expect(diagnostics.providerUnavailableReason).toBe('local_fixture_only');
    expect(diagnostics.providers.embedding.id).toBe('BAAI/bge-m3');
    expect(diagnostics.providers.reranker.id).toBe('BAAI/bge-reranker-v2-m3');
    expect(diagnostics.providers.embedding.kind).toBe('required_model_provider');
    expect(diagnostics.operations.embedding).toBe('test_fixture_embedding');
    expect(diagnostics.operations.reranking).toBe('test_fixture_reranker');
    expect(diagnostics.operations.mmrApplied).toBe(true);
    expect(diagnostics.matches.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.matches[0].contentPreview).toContain('삼각김밥');
    expect(JSON.stringify(diagnostics.matches.slice(0, 3))).toContain('convenience-combo-001');
    expect(diagnostics.modelStack.policy).toBe('required_live_model_stack_fail_closed');
    expect(diagnostics.modelStack.providerUnavailableBehavior).toBe('fail_closed');
    expect(diagnostics.modelStack.ciProviderMode).toBe('mock_required_providers_only');
  });
  test('registers every screenshot model as a required live RAG stack capability', () => {
    const stack = buildStoryboardRagModelStackDiagnostics();
    const modelIds = stack.models.map((model) => model.id);
    const roles = new Set(stack.models.map((model) => model.role));

    expect(stack.allScreenshotModelsRegistered).toBe(true);
    expect(stack.providerUnavailableBehavior).toBe('fail_closed');
    expect(stack.ciProviderMode).toBe('mock_required_providers_only');
    expect(modelIds).toContain('a.x-4.0-light-imatrix:Q8_0');
    expect(modelIds.filter((id) => id === 'bge-m3')).toHaveLength(2);
    expect(modelIds).toContain('bge-reranker-v2-m3');
    expect(modelIds).toContain('LLaVA-NeXT-Video-7B-hf');
    expect(modelIds).toContain('gemini-cli');
    expect(modelIds).toContain('openai-api');
    expect(modelIds).toContain('exaone3.5:7.8b');
    expect(modelIds).toContain('EEVE-Korean-Instruct-10.8B');
    expect(modelIds).toContain('qwen3:8b');
    expect(modelIds).toContain('solar:10.7b-instruct-v1-q5_0');
    expect(roles).toEqual(new Set([
      'contextual_retrieval',
      'dense_embedding',
      'sparse_embedding',
      'reranker',
      'video_captioning',
      'llm_judge',
    ]));
    expect(stack.models.every((model) => model.execution === 'required_live_provider')).toBe(true);
    expect(stack.models.every((model) => model.providerRequired)).toBe(true);
    expect(stack.models.every((model) => model.unavailableBehavior === 'fail_closed')).toBe(true);
    expect(stack.models.every((model) => model.ciProviderMode === 'mock_required_provider')).toBe(true);
    expect(stack.models.every((model) => model.requiredEnv)).toBe(true);
    expect(
      stack.models.find((model) => model.id === 'a.x-4.0-light-imatrix:Q8_0')?.localPullId,
    ).toBe('cookieshake/a.x-4.0-light-imatrix:Q8_0');
    expect(
      stack.models.find((model) => model.id === 'EEVE-Korean-Instruct-10.8B')?.localPullId,
    ).toBe('bnksys/eeve:10.8b-korean-instruct-q8-v1');
    expect(stack.executionPlan.embeddings.requiredDenseModels).toContain('bge-m3');
    expect(stack.executionPlan.embeddings.requiredSparseModels).toContain('bge-m3');
    expect(stack.executionPlan.reranking.requiredModels).toContain('bge-reranker-v2-m3');
    expect(stack.executionPlan.videoCaptioning.providerUnavailableBehavior).toBe('fail_closed');
    expect(stack.executionPlan.judging.providerUnavailableBehavior).toBe('fail_closed');
  });

  test('wires storyboard document hybrid v2 RPC with rollback and index migration', () => {
    const searchRoute = readFileSync(
      new URL('../app/api/admin/storyboard/rag/search/route.ts', import.meta.url),
      'utf8',
    );
    const migration = readFileSync(
      new URL('../../../backend/supabase/migrations/20260627153000_storyboard_documents_hybrid_v2_indexes.sql', import.meta.url),
      'utf8',
    );

    expect(searchRoute).toContain('resolveStoryboardRagSearchRpcName');
    expect(searchRoute).toContain("STORYBOARD_RAG_SEARCH_RPC_VERSION === 'v1'");
    expect(searchRoute).toContain('match_storyboard_documents_hybrid_v2');
    expect(searchRoute).toContain('supabase.rpc(rpcName');
    expect(searchRoute).not.toContain("supabase.rpc('match_storyboard_documents_hybrid'");
    expect(migration).toContain('match_storyboard_documents_hybrid_v2');
    expect(migration).toContain('documents_sparse_lexical_weights_keys_gin_idx');
    expect(migration).toContain('d.sparse_lexical_weights ?| qt.keys');
    expect(migration).toContain('grant execute on function public.match_storyboard_documents_hybrid_v2');
    expect(migration).toContain('to authenticated, service_role');
    expect(migration).toContain('revoke all on function public.match_storyboard_documents_hybrid(uuid');
  });

  test('instruments storyboard route payloads and preserves cache boundaries', () => {
    const statusRoute = readFileSync(
      new URL('../app/api/admin/storyboard/route.ts', import.meta.url),
      'utf8',
    );
    const chatRoute = readFileSync(
      new URL('../app/api/admin/storyboard/chat/route.ts', import.meta.url),
      'utf8',
    );
    const imageRoute = readFileSync(
      new URL('../app/api/admin/storyboard/images/route.ts', import.meta.url),
      'utf8',
    );
    const documentsRoute = readFileSync(
      new URL('../app/api/admin/storyboard/rag/documents/route.ts', import.meta.url),
      'utf8',
    );
    const searchRoute = readFileSync(
      new URL('../app/api/admin/storyboard/rag/search/route.ts', import.meta.url),
      'utf8',
    );
    const telemetrySource = readFileSync(
      new URL('../lib/admin/storyboard/route-telemetry.ts', import.meta.url),
      'utf8',
    );
    const generatorSource = readFileSync(
      new URL('../components/admin/storyboard/AdminStoryboardGenerator.tsx', import.meta.url),
      'utf8',
    );

    expect(telemetrySource).toContain('X-Storyboard-Request-Bytes');
    expect(telemetrySource).toContain('X-Storyboard-Response-Bytes');
    expect(telemetrySource).toContain('STORYBOARD_ROUTE_STATUS_CACHE_CONTROL');
    expect(statusRoute).toContain("buildStoryboardRouteFreshness('storyboard_status'");
    expect(statusRoute).toContain('STORYBOARD_ROUTE_STATUS_CACHE_CONTROL');
    expect(statusRoute).toContain("Vary: 'Cookie, Authorization'");
    expect(chatRoute).toContain('STORYBOARD_ROUTE_SSE_HEADERS');
    expect(chatRoute).toContain('readStoryboardRouteJson(request, telemetry)');
    expect(chatRoute).toContain('route-payload');
    expect(chatRoute).toContain("send('patch', publicResult)");
    expect(chatRoute).toContain('duplicateResultOmitted: true');
    expect(chatRoute).not.toContain("send('done', publicResult)");
    expect(imageRoute).toContain('STORYBOARD_ROUTE_PRIVATE_NO_STORE_CACHE_CONTROL');
    expect(imageRoute).toContain("buildStoryboardRouteFreshness('storyboard_image_provider_status'");
    expect(imageRoute).toContain('readStoryboardRouteJson(request, telemetry)');
    expect(documentsRoute).toContain('readStoryboardRouteJson(request, telemetry)');
    expect(searchRoute).toContain('readStoryboardRouteJson(request, telemetry)');
    expect(generatorSource).toContain('stripStoryboardGeneratedImagesForTransport(result)');
    expect(generatorSource).toContain('stripStoryboardGeneratedImagesFromScenes(scenes)');
    expect(generatorSource).toContain('cache: "no-store"');
    expect(generatorSource).toContain('credentials: "omit"');
  });

  test('selects operating profiles without credentials, network, or GPU execution', () => {
    const profiles = getStoryboardRagExecutionProfiles();
    const profileIds = profiles.map((profile) => profile.id);

    expect(profileIds).toEqual(expect.arrayContaining([
      'xps_9550_local_dev',
      'vps_6c_12gb',
      'gpu_cloud_worker',
      'macbook_pro_m5_max',
      'ci_exception_only',
    ]));

    const xps = resolveStoryboardRagExecutionProfile({
      STORYBOARD_RAG_EXECUTION_PROFILE: 'xps_9550_local_dev',
    });
    expect(xps.label).toContain('XPS 9550');
    expect(xps.stages.find((stage) => stage.component === 'llava_caption')?.location).toBe('remote_worker');
    expect(xps.stages.find((stage) => stage.component === 'bge_embed')?.actions).toContain('queue');

    const gpu = resolveStoryboardRagExecutionProfile({
      STORYBOARD_RAG_EXECUTION_PROFILE: 'gpu_cloud_worker',
    });
    expect(gpu.stages.every((stage) => stage.actions.includes('queue'))).toBe(true);
    expect(gpu.stages.find((stage) => stage.component === 'llava_caption')?.endpointEnv).toBe('STORYBOARD_RAG_GPU_WORKER_URL');

    const ci = resolveStoryboardRagExecutionProfile({ CI: 'true' });
    expect(ci.id).toBe('ci_exception_only');
    expect(ci.ciSafe).toBe(true);
    expect(ci.stages.every((stage) => stage.location === 'not_invoked_in_ci')).toBe(true);
    expect(ci.stages.every((stage) => stage.actions.includes('fail_closed_exception_only'))).toBe(true);
  });

  test('formats profile trace with current profile, provider location, queue, timeout, and missing-model actions', () => {
    const profile = resolveStoryboardRagExecutionProfile({
      STORYBOARD_RAG_EXECUTION_PROFILE: 'vps_6c_12gb',
    });
    const detail = buildStoryboardRagProfileTraceDetail(profile);

    expect(detail).toContain('현재 실행 프로파일: 6c/12GB VPS');
    expect(detail).toContain('원격/로컬 provider 위치');
    expect(detail).toContain('remote_worker');
    expect(detail).toContain('대기열/타임아웃');
    expect(detail).toContain('모델 미설치 조치');
    expect(detail).toContain('GPU caption worker endpoint 설정');
  });

  test('maps required RAG failures to Korean fail-closed status without raw technical details', () => {
    const cases = [
      ['required_storyboard_rag_worker_failed:500:OPENAI_API_KEY=sk-secret stack', 'worker 연결'],
      ['required_storyboard_rag_worker_embed_contract_invalid: raw vector dump', 'BGE 임베딩'],
      ['storyboard_rag_search_rpc_failed: relation documents missing', 'Supabase 검색'],
      ['required_storyboard_rag_worker_rerank_results_invalid: duplicate ids', 'reranker'],
      ['required_llava_caption_failed: CUDA out of memory', 'LLaVA caption'],
      ['required_gemini_oauth_missing: token path', 'judge'],
      ['OPENAI_API_KEY=sk-secret stack dump', 'judge'],
      ['CUDA out of memory vector [0.1,0.2] db password', 'BGE 임베딩'],
      ['unauthorized bearer sk-secret token', 'judge'],
      ['session cookie secret=abc123', 'judge'],
      ['oauth token sk-secret at C:/Users/me/.codex/auth.json', 'judge'],
    ] as const;

    for (const [causeCode, stageLabel] of cases) {
      const status = buildStoryboardRagFailureStatus({ causeCode, traceId: 'trace-test' });
      const serialized = JSON.stringify(status);
      expect(status.stageLabel).toBe(stageLabel);
      expect(status.message).toContain('중단');
      expect(status.nextActions.length).toBeGreaterThanOrEqual(3);
      expect(formatStoryboardRagFailureTraceDetail(status)).toContain('원인 코드:');
      expect(formatStoryboardRagFailureTraceDetail(status)).toContain('설명:');
      expect(serialized).not.toContain('sk-secret');
      expect(serialized).not.toContain('raw vector dump');
      expect(serialized).not.toContain('CUDA out of memory');
      expect(serialized).not.toContain('db_password');
      expect(serialized).not.toContain('[0.1,0.2]');
      expect(serialized).not.toContain('OPENAI_API_KEY');
      expect(serialized).not.toContain('abc123');
      expect(serialized).not.toContain('.codex');
      expect(serialized).not.toContain('bearer');
    }
  });



  test('fails closed with explicit provider unavailable reason when no evidence documents exist', () => {
    const baseRequest = request('');
    const planner = createStoryboardPlannerOutput(baseRequest, {
      dataModeLabel: '로컬 히트맵 모드',
      isFallbackData: false,
      mode: 'local_heatmap_fixture',
    });
    const emptyPlanner = {
      ...planner,
      topicProfile: {
        ...planner.topicProfile,
        label: '',
        keywords: [],
        visualMotifs: [],
        audioMotifs: [],
        subtitleMotifs: [],
        sensoryWords: [],
      },
      sceneDrafts: [],
    };

    const diagnostics = runStoryboardLocalRag({
      request: { ...baseRequest, prompt: '' },
      planner: emptyPlanner,
      sources: [],
      topK: 4,
      candidateLimit: 10,
    });

    expect(diagnostics.status).toBe('not_used');
    expect(diagnostics.providerUnavailableReason).toBe('no_query');
    expect(diagnostics.documentCount).toBe(0);
    expect(diagnostics.matches).toEqual([]);
    expect(diagnostics.providers.embedding.evidenceBound).toBe(true);
  });

  test('does not treat prompt-only context as independent retrieval evidence', () => {
    const baseRequest = request('편의점 삼각김밥 치즈 컵라면 조합');
    const planner = createStoryboardPlannerOutput(baseRequest, {
      dataModeLabel: '로컬 히트맵 모드',
      isFallbackData: false,
      mode: 'local_heatmap_fixture',
    });
    const promptOnlyPlanner = {
      ...planner,
      topicProfile: {
        ...planner.topicProfile,
        label: '',
        keywords: [],
        visualMotifs: [],
        audioMotifs: [],
        subtitleMotifs: [],
        sensoryWords: [],
      },
      sceneDrafts: [],
    };

    const diagnostics = runStoryboardLocalRag({
      request: baseRequest,
      planner: promptOnlyPlanner,
      sources: [],
      topK: 4,
      candidateLimit: 10,
    });

    expect(diagnostics.status).toBe('not_used');
    expect(diagnostics.providerUnavailableReason).toBe('no_documents');
    expect(diagnostics.documentCount).toBe(1);
    expect(diagnostics.matches).toEqual([]);
  });

  test('does not count planner-derived scene drafts as independent retrieval evidence', () => {
    const baseRequest = request('편의점 삼각김밥 치즈 컵라면 조합');
    const planner = createStoryboardPlannerOutput(baseRequest, {
      dataModeLabel: '로컬 히트맵 모드',
      isFallbackData: false,
      mode: 'local_heatmap_fixture',
    });

    const diagnostics = runStoryboardLocalRag({
      request: baseRequest,
      planner,
      sources: [],
      topK: 4,
      candidateLimit: 10,
    });

    expect(diagnostics.status).toBe('not_used');
    expect(diagnostics.providerUnavailableReason).toBe('no_documents');
    expect(diagnostics.documentCount).toBeGreaterThan(1);
    expect(diagnostics.matches).toEqual([]);
  });

  test('fails closed when available local documents are unrelated to the user intent', () => {
    const baseRequest = request('편의점 삼각김밥 치즈 컵라면 조합');
    const planner = createStoryboardPlannerOutput(baseRequest, {
      dataModeLabel: '로컬 히트맵 모드',
      isFallbackData: false,
      mode: 'local_heatmap_fixture',
    });
    const unrelatedPlanner = {
      ...planner,
      topicProfile: {
        ...planner.topicProfile,
        label: '',
        keywords: [],
        visualMotifs: [],
        audioMotifs: [],
        subtitleMotifs: [],
        sensoryWords: [],
      },
      sceneDrafts: [],
    };

    const diagnostics = runStoryboardLocalRag({
      request: baseRequest,
      planner: unrelatedPlanner,
      sources: [sources()[0]],
      topK: 4,
      candidateLimit: 10,
    });

    expect(diagnostics.status).toBe('not_used');
    expect(diagnostics.providerUnavailableReason).toBe('no_relevant_documents');
    expect(diagnostics.matches).toEqual([]);
  });
  test('scores a RAG fixture experiment with the full explainable rubric', () => {
    const fixture = withRelevantHeatmapFixture();
    const previous = process.env.TZUYANG_HEATMAP_DIR;
    process.env.TZUYANG_HEATMAP_DIR = fixture.dir;
    try {
      const result = generateLocalStoryboard({
        prompt: '편의점 삼각김밥 치즈 컵라면 조합 먹방 스토리보드',
        tone: 'warm',
        targetLengthMinutes: 16,
        sourceLimit: 10,
        segmentCount: 8,
        includeProductionNotes: true,
      });
      const report = evaluateStoryboardRagExperiment(result, {
        experimentId: 'unit-rag-relevant-convenience',
      });

      expect(report.schemaVersion).toBe(1);
      expect(report.testMode).toBe('deterministic_fixtures');
      expect(report.providerPolicy).toBe('required_live_model_stack_fail_closed');
      expect(report.criteria.map((item) => item.id)).toEqual([
        'intent_alignment',
        'evidence_grounding',
        'retrieval_relevance',
        'rerank_usefulness',
        'diversity_coverage',
        'temporal_pacing',
        'storyboard_actionability',
        'visual_specificity',
        'safety_fail_closed',
      ]);
      expect(report.sourceSummary.isFallbackData).toBe(false);
      expect(report.criteria.every((item) => item.evidence.trim().length > 12)).toBe(true);
      expect(report.criteria.find((item) => item.id === 'evidence_grounding')?.evidence).toContain('sourceTrusted=true');
      expect(report.criteria.find((item) => item.id === 'safety_fail_closed')?.evidence).toContain('providerDescriptorsValid=true');
      expect(report.score).toBeGreaterThanOrEqual(82);
      expect(report.status).toBe('needs_iteration');
      expect(report.blockers.join('\n')).toContain('검색 관련성');
    } finally {
      if (previous === undefined) {
        delete process.env.TZUYANG_HEATMAP_DIR;
      } else {
        process.env.TZUYANG_HEATMAP_DIR = previous;
      }
      fixture.cleanup();
    }
  });

  test('records explainable backlog when RAG relevance fails closed', () => {
    const previous = process.env.TZUYANG_HEATMAP_DIR;
    process.env.TZUYANG_HEATMAP_DIR = path.join(os.tmpdir(), `missing-rag-eval-${Date.now()}`);
    try {
      const result = generateLocalStoryboard({
        prompt: '백엔드 구조만 설명해줘',
        tone: 'documentary',
        targetLengthMinutes: 12,
        sourceLimit: 10,
        segmentCount: 8,
        includeProductionNotes: true,
      });
      const report = evaluateStoryboardRagExperiment(result, {
        experimentId: 'unit-rag-fail-closed-backlog',
      });
      const retrieval = report.criteria.find((item) => item.id === 'retrieval_relevance');

      expect(result.backendAnalysis.localRag?.status).toBe('not_used');
      expect(retrieval?.evidence).toContain('fail-closed');
      expect(report.status).toBe('needs_iteration');
      expect(report.blockers.join('\n')).toContain('검색 관련성');
      expect(report.iterationBacklog.join('\n')).toContain('다음 RAG 실험에서 개선');
    } finally {
      if (previous === undefined) {
        delete process.env.TZUYANG_HEATMAP_DIR;
      } else {
        process.env.TZUYANG_HEATMAP_DIR = previous;
      }
    }
  });
  test('blocks pass when demo sources overlap the prompt', () => {
    const previous = process.env.TZUYANG_HEATMAP_DIR;
    process.env.TZUYANG_HEATMAP_DIR = path.join(os.tmpdir(), `missing-rag-overlap-${Date.now()}`);
    try {
      const result = generateLocalStoryboard({
        prompt: '편의점 삼각김밥 치즈 컵라면 조합 먹방 스토리보드',
        tone: 'warm',
        targetLengthMinutes: 16,
        sourceLimit: 10,
        segmentCount: 8,
        includeProductionNotes: true,
      });
      const report = evaluateStoryboardRagExperiment(result, {
        experimentId: 'unit-rag-demo-source-provenance',
      });

      expect(result.sourceSummary.isFallbackData).toBe(true);
      expect(report.sourceSummary.isFallbackData).toBe(true);
      expect(report.status).toBe('needs_iteration');
      expect(report.blockers.join('\n')).toContain('sourceTrusted=false');
      expect(report.iterationBacklog.join('\n')).toContain('demo source');
    } finally {
      if (previous === undefined) {
        delete process.env.TZUYANG_HEATMAP_DIR;
      } else {
        process.env.TZUYANG_HEATMAP_DIR = previous;
      }
    }
  });
  test('blocks pass when provenance flags are forged on demo-mode sources', () => {
    withRelevantHeatmapResult((result) => {
      const forgedResult: StoryboardGenerationResult = {
        ...result,
        mode: 'local_demo_fallback',
        sourceSummary: {
          ...result.sourceSummary,
          heatmapDirectory: 'local-demo://storyboard-fallback',
          dataModeLabel: '데모 샘플 모드',
          isFallbackData: false,
          fallbackReason: null,
          usableSources: 8,
          selectedSources: 8,
          totalMarkers: 8,
        },
      };
      const report = evaluateStoryboardRagExperiment(forgedResult, {
        experimentId: 'unit-rag-forged-demo-provenance-flags',
      });

      expect(report.sourceSummary.mode).toBe('local_demo_fallback');
      expect(report.sourceSummary.isFallbackData).toBe(false);
      expect(report.status).toBe('needs_iteration');
      expect(report.blockers.join('\n')).toContain('sourceTrusted=false');
      expect(report.blockers.join('\n')).toContain('local-demo://storyboard-fallback');
    });
  });
  test('blocks pass when local-demo heatmap URI casing is forged', () => {
    withRelevantHeatmapResult((result) => {
      const forgedResult: StoryboardGenerationResult = {
        ...result,
        mode: 'local_heatmap_fixture',
        sourceSummary: {
          ...result.sourceSummary,
          heatmapDirectory: 'LOCAL-DEMO://storyboard-fallback',
          dataModeLabel: '로컬 히트맵 모드',
          isFallbackData: false,
          fallbackReason: null,
          usableSources: 8,
          selectedSources: 8,
          totalMarkers: 8,
        },
      };
      const report = evaluateStoryboardRagExperiment(forgedResult, {
        experimentId: 'unit-rag-uppercase-demo-uri',
      });

      expect(report.status).toBe('needs_iteration');
      expect(report.blockers.join('\n')).toContain('sourceTrusted=false');
      expect(report.blockers.join('\n')).toContain('LOCAL-DEMO://storyboard-fallback');
    });
  });



  test('fails the rubric when local RAG provider descriptors are missing', () => {
    withRelevantHeatmapResult((result) => {
      const report = evaluateStoryboardRagExperiment(
        tamperLocalRag(result, { providers: {} }),
        { experimentId: 'unit-rag-provider-missing' },
      );
      const safety = report.criteria.find((item) => item.id === 'safety_fail_closed');

      expect(report.status).toBe('needs_iteration');
      expect(safety?.score).toBeLessThan(70);
      expect(safety?.evidence).toContain('providerDescriptorsValid=false');
      expect(report.blockers.join('\n')).toContain('안전/Fail-closed');
    });
  });

  test('fails the rubric when required BGE provider descriptors are downgraded', () => {
    withRelevantHeatmapResult((result) => {
      const report = evaluateStoryboardRagExperiment(
        tamperLocalRag(result, {
          providers: {
            embedding: {
              id: 'BAAI/bge-m3',
              kind: 'test_mode_fixture',
              modelLabel: 'Required BGE-M3 embedding provider',
              evidenceBound: true,
            },
            reranker: {
              id: 'BAAI/bge-reranker-v2-m3',
              kind: 'test_mode_fixture',
              modelLabel: 'Required BGE reranker v2 M3 provider',
              evidenceBound: true,
            },
          },
        }),
        { experimentId: 'unit-rag-provider-downgraded' },
      );
      const safety = report.criteria.find((item) => item.id === 'safety_fail_closed');

      expect(report.status).toBe('needs_iteration');
      expect(safety?.score).toBeLessThan(70);
      expect(safety?.evidence).toContain('providerDescriptorsValid=false');
      expect(safety?.evidence).toContain('requiredBgeClaimPresent=true');
    });
  });
  test('fails the rubric when required BGE model labels are hidden', () => {
    withRelevantHeatmapResult((result) => {
      const report = evaluateStoryboardRagExperiment(
        tamperLocalRag(result, {
          providers: {
            embedding: {
              id: 'BAAI/bge-m3',
              kind: 'required_model_provider',
              modelLabel: 'Required embedding provider',
              evidenceBound: true,
            },
            reranker: {
              id: 'BAAI/bge-reranker-v2-m3',
              kind: 'required_model_provider',
              modelLabel: 'Required reranker provider',
              evidenceBound: true,
            },
          },
        }),
        { experimentId: 'unit-rag-provider-required-label-hidden' },
      );
      const safety = report.criteria.find((item) => item.id === 'safety_fail_closed');

      expect(report.status).toBe('needs_iteration');
      expect(safety?.score).toBeLessThan(70);
      expect(safety?.evidence).toContain('providerDescriptorsValid=false');
      expect(safety?.evidence).toContain('requiredBgeClaimPresent=true');
    });
  });
  test('fails each missing required provider field independently', () => {
    const patches = [
      {
        embedding: {
          id: 'BAAI/bge-m3',
          kind: 'required_model_provider',
          modelLabel: 'Required BGE-M3 embedding provider',
          evidenceBound: false,
        },
      },
      {
        reranker: {
          id: 'BAAI/bge-reranker-v2-m3',
          kind: 'required_model_provider',
          modelLabel: 'Required BGE reranker v2 M3 provider',
          evidenceBound: false,
        },
      },
    ];

    withRelevantHeatmapResult((result) => {
      for (const [index, patch] of patches.entries()) {
        const localRag = result.backendAnalysis.localRag;
        if (!localRag) {
          throw new Error('Expected local RAG diagnostics for provider field test');
        }
        const report = evaluateStoryboardRagExperiment(
          tamperLocalRag(result, {
            providers: {
              ...localRag.providers,
              ...patch,
            },
          }),
          { experimentId: `unit-rag-provider-required-field-${index}` },
        );
        const safety = report.criteria.find((item) => item.id === 'safety_fail_closed');

        expect(report.status).toBe('needs_iteration');
        expect(safety?.score).toBeLessThan(70);
        expect(safety?.evidence).toContain('providerDescriptorsValid=false');
      }
    });
  });
  test('fails the rubric when status is used but no matches are present', () => {
    withRelevantHeatmapResult((result) => {
      const localRag = result.backendAnalysis.localRag;
      if (!localRag) {
        throw new Error('Expected local RAG diagnostics for empty match test');
      }
      const report = evaluateStoryboardRagExperiment(
        tamperLocalRag(result, {
          status: 'used',
          matches: [],
          operations: {
            ...localRag.operations,
            mmrApplied: true,
          },
        }),
        { experimentId: 'unit-rag-used-empty-matches' },
      );
      const retrieval = report.criteria.find((item) => item.id === 'retrieval_relevance');
      const rerank = report.criteria.find((item) => item.id === 'rerank_usefulness');

      expect(report.status).toBe('needs_iteration');
      expect(retrieval?.score).toBe(0);
      expect(retrieval?.evidence).toContain('match가 없음');
      expect(rerank?.score).toBe(0);
      expect(rerank?.evidence).toContain('rerank 대상 match가 없음');
    });
  });

  test('fails the rubric when RAG match metrics are non-finite', () => {
    withRelevantHeatmapResult((result) => {
      const localRag = result.backendAnalysis.localRag;
      if (!localRag || !localRag.matches.length) {
        throw new Error('Expected local RAG matches for non-finite metric test');
      }
      const report = evaluateStoryboardRagExperiment(
        tamperLocalRag(result, {
          status: 'used',
          matches: [
            {
              ...localRag.matches[0],
              score: Number.NaN,
            },
            ...localRag.matches.slice(1),
          ],
        }),
        { experimentId: 'unit-rag-non-finite-match-score' },
      );
      const retrieval = report.criteria.find((item) => item.id === 'retrieval_relevance');
      const rerank = report.criteria.find((item) => item.id === 'rerank_usefulness');

      expect(report.status).toBe('needs_iteration');
      expect(retrieval?.score).toBe(0);
      expect(rerank?.score).toBe(0);
      expect(report.blockers.join('\n')).toContain('유한한 숫자가 아님');
      expect(report.iterationBacklog.join('\n')).toContain('유한한 숫자가 아님');
    });
  });
});
