import type {
  StoryboardGenerateRequest,
  StoryboardHeatmapSource,
  StoryboardPlannerOutput,
} from './types';

export type StoryboardRagDocumentSource =
  | 'prompt'
  | 'topic_profile'
  | 'scene_draft'
  | 'heatmap_marker';

export type StoryboardRagProviderKind = 'required_model_provider';

export type StoryboardRagEmbeddingProviderId = 'gemini-embedding-001' | 'BAAI/bge-m3';

export type StoryboardRagRerankerProviderId = 'gemini-embedding-001:cosine' | 'BAAI/bge-reranker-v2-m3';

export type StoryboardRagProviderDescriptor = {
  id: StoryboardRagEmbeddingProviderId | StoryboardRagRerankerProviderId;
  kind: StoryboardRagProviderKind;
  modelLabel: string;
  evidenceBound: boolean;
};

export type StoryboardRagModelRole =
  | 'contextual_retrieval'
  | 'dense_embedding'
  | 'sparse_embedding'
  | 'reranker'
  | 'video_captioning'
  | 'llm_judge';

export type StoryboardRagModelExecution = 'required_live_provider';

export type StoryboardRagModelDescriptor = {
  id: string;
  provider: 'gemini-api';
  role: StoryboardRagModelRole;
  modelLabel: string;
  execution: StoryboardRagModelExecution;
  unavailableBehavior: 'fail_closed';
  ciProviderMode: 'mock_required_provider';
  providerRequired: true;
  localPullId?: string;
  requiredEnv?: string;
};

export type StoryboardRagExecutionProfileId =
  | 'xps_9550_local_dev'
  | 'vps_6c_12gb'
  | 'gpu_cloud_worker'
  | 'macbook_pro_m5_max'
  | 'ci_exception_only';

export type StoryboardRagProviderLocation =
  | 'local_worker'
  | 'remote_worker'
  | 'oauth_provider'
  | 'local_ollama'
  | 'not_invoked_in_ci';

export type StoryboardRagProfileStageAction =
  | 'enable'
  | 'queue'
  | 'unload_after_request'
  | 'remote_required'
  | 'fail_closed_exception_only';

export type StoryboardRagProfileStage = {
  component: 'bge_embed' | 'bge_rerank' | 'llava_caption' | 'ollama_judge' | 'gemini_openai_judge';
  label: string;
  location: StoryboardRagProviderLocation;
  actions: StoryboardRagProfileStageAction[];
  queue: {
    concurrency: number;
    timeoutMs: number;
  };
  missingModelAction: string;
  endpointEnv?: string;
};

export type StoryboardRagExecutionProfile = {
  id: StoryboardRagExecutionProfileId;
  label: string;
  target: string;
  summary: string;
  ciSafe: boolean;
  stages: StoryboardRagProfileStage[];
  environment: {
    profileEnv: 'STORYBOARD_RAG_EXECUTION_PROFILE';
    workerUrlEnv: 'STORYBOARD_RAG_WORKER_URL';
    gpuWorkerUrlEnv: 'STORYBOARD_RAG_GPU_WORKER_URL';
  };
};

export type StoryboardRagModelStackDiagnostics = {
  schemaVersion: 1;
  policy: 'required_live_model_stack_fail_closed';
  allScreenshotModelsRegistered: boolean;
  providerUnavailableBehavior: 'fail_closed';
  ciProviderMode: 'mock_required_providers_only';
  executionProfile: StoryboardRagExecutionProfile;
  models: StoryboardRagModelDescriptor[];
  executionPlan: {
    contextualRetrieval: {
      requiredModels: string[];
      providerUnavailableBehavior: 'fail_closed';
    };
    embeddings: {
      requiredDenseModels: string[];
      requiredSparseModels: string[];
      providerUnavailableBehavior: 'fail_closed';
    };
    reranking: {
      requiredModels: string[];
      providerUnavailableBehavior: 'fail_closed';
    };
    videoCaptioning: {
      requiredModels: string[];
      providerUnavailableBehavior: 'fail_closed';
    };
    judging: {
      requiredModels: string[];
      providerUnavailableBehavior: 'fail_closed';
    };
  };
};


export type StoryboardRagDocument = {
  id: string;
  source: StoryboardRagDocumentSource;
  content: string;
  metadata: {
    sceneNo?: number;
    role?: string;
    videoId?: string;
    peakTime?: string;
    replayScore?: number;
    topicKeywords?: string[];
  };
};

export type StoryboardRagMatch = {
  documentId: string;
  source: StoryboardRagDocumentSource;
  contentPreview: string;
  score: number;
  similarityScore: number;
  rerankScore: number;
  diversityPenalty: number;
  metadata: StoryboardRagDocument['metadata'];
};

export type StoryboardRagDiagnostics = {
  status: 'used' | 'fixture_only' | 'not_used' | 'failed';
  query: string;
  providers: {
    embedding: StoryboardRagProviderDescriptor;
    reranker: StoryboardRagProviderDescriptor;
  };
  modelStack: StoryboardRagModelStackDiagnostics;
  operations: {
    documentBuild: 'local_storyboard_evidence';
    embedding: 'test_fixture_embedding';
    candidateRanking: 'fixture_similarity';
    mmrApplied: boolean;
    reranking: 'test_fixture_reranker';
  };
  documentCount: number;
  candidateCount: number;
  selectedCount: number;
  providerUnavailableReason?: 'no_query' | 'no_documents' | 'no_relevant_documents' | 'local_fixture_only';
  matches: StoryboardRagMatch[];
};

export type StoryboardRagInput = {
  request: StoryboardGenerateRequest;
  planner: StoryboardPlannerOutput;
  sources: StoryboardHeatmapSource[];
  topK?: number;
  candidateLimit?: number;
};

const HASH_DIMENSIONS = 48;
const MIN_RELEVANT_CANDIDATE_SCORE = 0.11;


const REQUIRED_EMBEDDING_PROVIDER: StoryboardRagProviderDescriptor = {
  id: 'BAAI/bge-m3',
  kind: 'required_model_provider',
  modelLabel: 'Historical BGE-M3 local fixture identity; no model execution',
  evidenceBound: true,
};

const REQUIRED_RERANKER_PROVIDER: StoryboardRagProviderDescriptor = {
  id: 'BAAI/bge-reranker-v2-m3',
  kind: 'required_model_provider',
  modelLabel: 'Historical BGE reranker v2 M3 local fixture identity; no model execution',
  evidenceBound: true,
};
// Historical screenshot stack is replaced by the supported Gemini execution contract.
const SCREENSHOT_RAG_MODEL_STACK: StoryboardRagModelDescriptor[] = [
  { id: 'gemini-embedding-001', provider: 'gemini-api', role: 'dense_embedding',
    modelLabel: 'Gemini 1024-dimension normalized retrieval embedding',
    execution: 'required_live_provider', unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider', providerRequired: true },
  { id: 'gemini-embedding-001:cosine', provider: 'gemini-api', role: 'reranker',
    modelLabel: 'Gemini embedding cosine candidate ranking',
    execution: 'required_live_provider', unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider', providerRequired: true },
  { id: 'gemini-3.8-flash', provider: 'gemini-api', role: 'video_captioning',
    modelLabel: 'Gemini frame captioning',
    execution: 'required_live_provider', unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider', providerRequired: true },
];

const GPU_WORKER_URL_ENV = 'STORYBOARD_RAG_GPU_WORKER_URL' as const;
const PROFILE_ENV = 'STORYBOARD_RAG_EXECUTION_PROFILE' as const;
const WORKER_URL_ENV = 'STORYBOARD_RAG_WORKER_URL' as const;

function profileStage(
  component: StoryboardRagProfileStage['component'],
  label: string,
  location: StoryboardRagProviderLocation,
  actions: StoryboardRagProfileStageAction[],
  timeoutMs: number,
  missingModelAction: string,
  endpointEnv?: string,
): StoryboardRagProfileStage {
  return {
    component,
    label,
    location,
    actions,
    queue: { concurrency: actions.includes('queue') ? 1 : 0, timeoutMs },
    missingModelAction,
    ...(endpointEnv ? { endpointEnv } : {}),
  };
}

function profile(
  id: StoryboardRagExecutionProfileId,
  label: string,
  target: string,
  summary: string,
  ciSafe: boolean,
  stages: StoryboardRagProfileStage[],
): StoryboardRagExecutionProfile {
  return {
    id,
    label,
    target,
    summary,
    ciSafe,
    stages,
    environment: {
      profileEnv: PROFILE_ENV,
      workerUrlEnv: WORKER_URL_ENV,
      gpuWorkerUrlEnv: GPU_WORKER_URL_ENV,
    },
  };
}

// Preserve configured profile IDs and worker URL ownership; execution no longer loads models.
const STORYBOARD_RAG_EXECUTION_PROFILES = Object.fromEntries([
  'xps_9550_local_dev', 'vps_6c_12gb', 'gpu_cloud_worker', 'macbook_pro_m5_max', 'ci_exception_only',
].map((value) => {
  const id = value as StoryboardRagExecutionProfileId;
  const ci = id === 'ci_exception_only';
  return [id, profile(id, ci ? 'CI 예외 처리 검증' : 'Gemini RAG worker', value,
    '기존 worker가 공식 Gemini API를 호출하며 모델을 다운로드하지 않습니다. 응답 유실 시 자동 재호출하지 않습니다.', ci,
    [profileStage('bge_embed', 'Gemini retrieval embeddings', ci ? 'not_invoked_in_ci' : 'remote_worker',
      ci ? ['fail_closed_exception_only'] : ['enable', 'queue'], 120_000, 'Gemini worker 인증·quota 확인', WORKER_URL_ENV),
     profileStage('bge_rerank', 'Gemini embedding cosine ranking', ci ? 'not_invoked_in_ci' : 'remote_worker',
      ci ? ['fail_closed_exception_only'] : ['enable', 'queue'], 120_000, 'Gemini worker 응답 확인', WORKER_URL_ENV),
     profileStage('llava_caption', 'Gemini frame caption', ci ? 'not_invoked_in_ci' : 'remote_worker',
      ci ? ['fail_closed_exception_only'] : ['enable', 'queue'], 120_000, '프레임과 Gemini worker 인증 확인', WORKER_URL_ENV)]),
  ];
})) as Record<StoryboardRagExecutionProfileId, StoryboardRagExecutionProfile>;

export function resolveStoryboardRagExecutionProfile(
  env: Pick<NodeJS.ProcessEnv, string> = process.env,
): StoryboardRagExecutionProfile {
  const requested = (env.STORYBOARD_RAG_EXECUTION_PROFILE || env.STORYBOARD_RAG_PROFILE || '').trim() as StoryboardRagExecutionProfileId;
  if (requested && STORYBOARD_RAG_EXECUTION_PROFILES[requested]) {
    return structuredClone(STORYBOARD_RAG_EXECUTION_PROFILES[requested]);
  }
  if (env.CI === 'true' || env.NODE_ENV === 'test') {
    return structuredClone(STORYBOARD_RAG_EXECUTION_PROFILES.ci_exception_only);
  }
  return structuredClone(STORYBOARD_RAG_EXECUTION_PROFILES.xps_9550_local_dev);
}

export function buildStoryboardRagProfileTraceDetail(profile = resolveStoryboardRagExecutionProfile()) {
  const locations = profile.stages
    .map((stage) => `${stage.label}:${stage.location}`)
    .join(' / ');
  const queue = profile.stages
    .map((stage) => `${stage.label} ${stage.queue.timeoutMs}ms`)
    .join(' / ');
  const missing = profile.stages
    .map((stage) => `${stage.label}→${stage.missingModelAction}`)
    .join(' / ');
  return [
    `현재 실행 프로파일: ${profile.label}`,
    `원격/로컬 provider 위치: ${locations}`,
    `대기열/타임아웃: ${queue}`,
    `모델 미설치 조치: ${missing}`,
  ].join(' · ');
}

export function getStoryboardRagExecutionProfiles() {
  return Object.values(STORYBOARD_RAG_EXECUTION_PROFILES).map((item) => structuredClone(item));
}

export function buildStoryboardRagModelStackDiagnostics(): StoryboardRagModelStackDiagnostics {
  const models = SCREENSHOT_RAG_MODEL_STACK.map((model) => ({ ...model }));
  const byRole = (role: StoryboardRagModelRole) =>
    models.filter((model) => model.role === role).map((model) => model.id);
  const executionProfile = resolveStoryboardRagExecutionProfile();

  return {
    schemaVersion: 1,
    policy: 'required_live_model_stack_fail_closed',
    allScreenshotModelsRegistered: false,
    providerUnavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_providers_only',
    executionProfile,
    models,
    executionPlan: {
      contextualRetrieval: {
        requiredModels: byRole('contextual_retrieval'),
        providerUnavailableBehavior: 'fail_closed',
      },
      embeddings: {
        requiredDenseModels: byRole('dense_embedding'),
        requiredSparseModels: byRole('sparse_embedding'),
        providerUnavailableBehavior: 'fail_closed',
      },
      reranking: {
        requiredModels: byRole('reranker'),
        providerUnavailableBehavior: 'fail_closed',
      },
      videoCaptioning: {
        requiredModels: byRole('video_captioning'),
        providerUnavailableBehavior: 'fail_closed',
      },
      judging: {
        requiredModels: byRole('llm_judge'),
        providerUnavailableBehavior: 'fail_closed',
      },
    },
  };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[“”"'`]/g, ' ')
    .replace(/[^0-9a-z가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function wordTokens(value: string) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}


function tokenize(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter(Boolean);
  const compactKoreanTokens = Array.from(normalized.replace(/[^가-힣]/g, ''));
  return [...tokens, ...compactKoreanTokens];
}

function hashToken(token: string) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % HASH_DIMENSIONS;
}

function embedText(value: string) {
  const vector = new Array<number>(HASH_DIMENSIONS).fill(0);
  for (const token of tokenize(value)) {
    vector[hashToken(token)] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return norm > 0 ? vector.map((item) => item / norm) : vector;
}

function cosine(left: number[], right: number[]) {
  return left.reduce((sum, item, index) => sum + item * (right[index] ?? 0), 0);
}

function tokenOverlap(query: string, content: string) {
  const queryWords = new Set(wordTokens(query));
  const contentWords = new Set(wordTokens(content));
  if (!queryWords.size || !contentWords.size) return 0;
  let overlap = 0;
  for (const token of queryWords) {
    if (contentWords.has(token)) overlap += 1;
  }
  return overlap / queryWords.size;
}

function candidateIntentScore(query: string, document: StoryboardRagDocument, similarityScore: number) {
  const overlap = tokenOverlap(query, document.content);
  if (overlap <= 0) return 0;
  return similarityScore * 0.45 + overlap * 0.4 + replayBoost(document) * 0.15;
}


function replayBoost(document: StoryboardRagDocument) {
  const score = document.metadata.replayScore;
  return typeof score === 'number' && Number.isFinite(score)
    ? Math.max(0, Math.min(score, 1))
    : 0;
}

function previewContent(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 179)}…`;
}

export function buildStoryboardRagDocuments({
  request,
  planner,
  sources,
}: Pick<StoryboardRagInput, 'request' | 'planner' | 'sources'>): StoryboardRagDocument[] {
  const documents: StoryboardRagDocument[] = [
    {
      id: 'prompt:operator-request',
      source: 'prompt',
      content: request.prompt,
      metadata: {},
    },
    {
      id: `topic:${planner.topicProfile.id}`,
      source: 'topic_profile',
      content: [
        planner.topicProfile.label,
        ...planner.topicProfile.keywords,
        ...planner.topicProfile.visualMotifs,
        ...planner.topicProfile.audioMotifs,
        ...planner.topicProfile.subtitleMotifs,
        ...planner.topicProfile.sensoryWords,
      ].join(' '),
      metadata: {
        topicKeywords: planner.topicProfile.keywords,
      },
    },
  ];

  for (const draft of planner.sceneDrafts) {
    documents.push({
      id: `scene:${String(draft.sceneNo).padStart(2, '0')}:${draft.role}`,
      source: 'scene_draft',
      content: [
        draft.title,
        draft.operatorIntent,
        draft.visualDirection,
        draft.hostBeat,
        draft.captionStem,
        ...draft.topicKeywords,
      ].join(' '),
      metadata: {
        sceneNo: draft.sceneNo,
        role: draft.role,
        topicKeywords: draft.topicKeywords,
      },
    });
  }

  sources.forEach((source, sourceIndex) => {
    source.markers.forEach((marker, markerIndex) => {
      documents.push({
        id: `heatmap:${source.videoId}:${sourceIndex}:${markerIndex}`,
        source: 'heatmap_marker',
        content: [
          source.videoId,
          marker.label,
          marker.peakTime,
          `replay ${(marker.replayScore * 100).toFixed(1)}%`,
        ].join(' '),
        metadata: {
          videoId: source.videoId,
          peakTime: marker.peakTime,
          replayScore: Number(marker.replayScore.toFixed(3)),
          topicKeywords: planner.topicProfile.keywords,
        },
      });
    });
  });

  return documents.filter((document) => normalizeText(document.content));
}

function createMatch(
  document: StoryboardRagDocument,
  query: string,
  similarityScore: number,
  diversityPenalty: number,
): StoryboardRagMatch {
  const overlap = tokenOverlap(query, document.content);
  const rerankScore = Math.min(
    1,
    similarityScore * 0.48 + overlap * 0.34 + replayBoost(document) * 0.18,
  );
  const score = Math.max(0, rerankScore - diversityPenalty * 0.12);
  return {
    documentId: document.id,
    source: document.source,
    contentPreview: previewContent(document.content),
    score: Number((score * 100).toFixed(2)),
    similarityScore: Number((similarityScore * 100).toFixed(2)),
    rerankScore: Number((rerankScore * 100).toFixed(2)),
    diversityPenalty: Number((diversityPenalty * 100).toFixed(2)),
    metadata: document.metadata,
  };
}

function uniqueSourcePenalty(
  document: StoryboardRagDocument,
  selected: StoryboardRagDocument[],
) {
  const sameSourceCount = selected.filter((item) => item.source === document.source).length;
  const sameVideoCount = document.metadata.videoId
    ? selected.filter((item) => item.metadata.videoId === document.metadata.videoId).length
    : 0;
  return Math.min(0.8, sameSourceCount * 0.08 + sameVideoCount * 0.18);
}

export function runStoryboardLocalRag(input: StoryboardRagInput): StoryboardRagDiagnostics {
  const query = normalizeText([
    input.request.prompt,
    input.planner.topicProfile.label,
    ...input.planner.topicProfile.keywords,
  ].join(' '));
  const documents = buildStoryboardRagDocuments(input);
  const evidenceDocuments = documents.filter((document) => document.source === 'heatmap_marker');
  const emptyBase = {
    query,
    providers: {
      embedding: REQUIRED_EMBEDDING_PROVIDER,
      reranker: REQUIRED_RERANKER_PROVIDER,
    },
    modelStack: buildStoryboardRagModelStackDiagnostics(),
    operations: {
      documentBuild: 'local_storyboard_evidence' as const,
      embedding: 'test_fixture_embedding' as const,
      candidateRanking: 'fixture_similarity' as const,
      mmrApplied: false,
      reranking: 'test_fixture_reranker' as const,
    },
    documentCount: documents.length,
    candidateCount: 0,
    selectedCount: 0,
    matches: [],
  };

  if (!query) {
    return { ...emptyBase, status: 'not_used', providerUnavailableReason: 'no_query' };
  }
  if (!evidenceDocuments.length) {
    return { ...emptyBase, status: 'not_used', providerUnavailableReason: 'no_documents' };
  }

  const queryVector = embedText(query);
  const candidateLimit = Math.max(1, Math.min(input.candidateLimit ?? 16, evidenceDocuments.length));
  const topK = Math.max(1, Math.min(input.topK ?? input.request.segmentCount, candidateLimit));
  const ranked = evidenceDocuments
    .map((document) => {
      const similarityScore = cosine(queryVector, embedText(document.content));
      return {
        document,
        similarityScore,
        intentScore: candidateIntentScore(query, document, similarityScore),
      };
    })
    .filter((candidate) => candidate.intentScore >= MIN_RELEVANT_CANDIDATE_SCORE)
    .sort((left, right) => right.intentScore - left.intentScore)
    .slice(0, candidateLimit);
  if (!ranked.length) {
    return { ...emptyBase, status: 'not_used', providerUnavailableReason: 'no_relevant_documents' };
  }

  const selected: Array<{ document: StoryboardRagDocument; similarityScore: number; penalty: number }> = [];
  const remaining = [...ranked];
  while (selected.length < topK && remaining.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const penalty = uniqueSourcePenalty(candidate.document, selected.map((item) => item.document));
      const score = candidate.similarityScore - penalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push({
      document: picked.document,
      similarityScore: picked.similarityScore,
      penalty: uniqueSourcePenalty(picked.document, selected.map((item) => item.document)),
    });
  }

  const matches = selected
    .map((item) => createMatch(item.document, query, item.similarityScore, item.penalty))
    .sort((left, right) => right.score - left.score);

  return {
    ...emptyBase,
    status: 'fixture_only',
    operations: {
      ...emptyBase.operations,
      mmrApplied: true,
    },
    candidateCount: ranked.length,
    selectedCount: matches.length,
    matches,
    providerUnavailableReason: 'local_fixture_only',
  };
}
