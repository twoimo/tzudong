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

export type StoryboardRagEmbeddingProviderId = 'BAAI/bge-m3';

export type StoryboardRagRerankerProviderId = 'BAAI/bge-reranker-v2-m3';

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
  provider: 'ollama' | 'flag_embedding' | 'huggingface' | 'gemini_cli' | 'openai_api';
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
  allScreenshotModelsRegistered: true;
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
  modelLabel: 'Required BGE-M3 embedding provider',
  evidenceBound: true,
};

const REQUIRED_RERANKER_PROVIDER: StoryboardRagProviderDescriptor = {
  id: 'BAAI/bge-reranker-v2-m3',
  kind: 'required_model_provider',
  modelLabel: 'Required BGE reranker v2 M3 provider',
  evidenceBound: true,
};
const SCREENSHOT_RAG_MODEL_STACK: StoryboardRagModelDescriptor[] = [
  {
    id: 'a.x-4.0-light-imatrix:Q8_0',
    provider: 'ollama',
    role: 'contextual_retrieval',
    modelLabel: 'Required Contextual Retrieval context generator (Q8_0)',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    localPullId: 'cookieshake/a.x-4.0-light-imatrix:Q8_0',
    requiredEnv: 'STORYBOARD_RAG_PULL_OLLAMA_MODELS',
  },
  {
    id: 'bge-m3',
    provider: 'flag_embedding',
    role: 'dense_embedding',
    modelLabel: 'Required BGE-M3 dense embedding',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_AGENT_ENABLE_BGE_RETRIEVAL',
  },
  {
    id: 'bge-m3',
    provider: 'flag_embedding',
    role: 'sparse_embedding',
    modelLabel: 'Required BGE-M3 sparse lexical embedding',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_AGENT_ENABLE_BGE_RETRIEVAL',
  },
  {
    id: 'bge-reranker-v2-m3',
    provider: 'flag_embedding',
    role: 'reranker',
    modelLabel: 'Required BGE reranker v2 M3 cross-encoder reranking',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_AGENT_ENABLE_BGE_RETRIEVAL',
  },
  {
    id: 'LLaVA-NeXT-Video-7B-hf',
    provider: 'huggingface',
    role: 'video_captioning',
    modelLabel: 'Required video captioning for most-replayed frames',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_AGENT_ENABLE_VIDEO_CAPTIONING',
  },
  {
    id: 'gemini-cli',
    provider: 'gemini_cli',
    role: 'llm_judge',
    modelLabel: 'Required Gemini CLI planning and LLM-as-a-judge route',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_AGENT_ENABLE_REAL_JUDGE',
  },
  {
    id: 'openai-api',
    provider: 'openai_api',
    role: 'llm_judge',
    modelLabel: 'Required OpenAI API LLM-as-a-judge route',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_AGENT_ENABLE_REAL_JUDGE',
  },
  {
    id: 'exaone3.5:7.8b',
    provider: 'ollama',
    role: 'llm_judge',
    modelLabel: 'Required EXAONE Korean judge experiment',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_RAG_PULL_OLLAMA_MODELS',
  },
  {
    id: 'EEVE-Korean-Instruct-10.8B',
    provider: 'ollama',
    role: 'llm_judge',
    modelLabel: 'Required EEVE Korean instruct judge experiment',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    localPullId: 'bnksys/eeve:10.8b-korean-instruct-q8-v1',
    requiredEnv: 'STORYBOARD_RAG_PULL_OLLAMA_MODELS',
  },
  {
    id: 'qwen3:8b',
    provider: 'ollama',
    role: 'llm_judge',
    modelLabel: 'Required Qwen3 judge/planning experiment',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_RAG_PULL_OLLAMA_MODELS',
  },
  {
    id: 'solar:10.7b-instruct-v1-q5_0',
    provider: 'ollama',
    role: 'llm_judge',
    modelLabel: 'Required Solar Korean judge/planning experiment',
    execution: 'required_live_provider',
    unavailableBehavior: 'fail_closed',
    ciProviderMode: 'mock_required_provider',
    providerRequired: true,
    requiredEnv: 'STORYBOARD_RAG_PULL_OLLAMA_MODELS',
  },
];

const PROFILE_ENV = 'STORYBOARD_RAG_EXECUTION_PROFILE' as const;
const WORKER_URL_ENV = 'STORYBOARD_RAG_WORKER_URL' as const;
const GPU_WORKER_URL_ENV = 'STORYBOARD_RAG_GPU_WORKER_URL' as const;

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

const STORYBOARD_RAG_EXECUTION_PROFILES: Record<StoryboardRagExecutionProfileId, StoryboardRagExecutionProfile> = {
  xps_9550_local_dev: profile(
    'xps_9550_local_dev',
    'XPS 9550 로컬 개발',
    '저전력 Windows 로컬 개발 장비',
    'BGE는 로컬 worker에서 1개씩 큐잉하고, LLaVA 같은 GPU 캡션은 원격 GPU worker를 필수 endpoint로 분리합니다.',
    false,
    [
      profileStage('bge_embed', 'BAAI/bge-m3 dense/sparse embedding', 'local_worker', ['enable', 'queue', 'unload_after_request'], 180_000, 'BAAI/bge-m3 설치 후 worker 재시작'),
      profileStage('bge_rerank', 'BAAI/bge-reranker-v2-m3 rerank', 'local_worker', ['enable', 'queue', 'unload_after_request'], 180_000, 'BAAI/bge-reranker-v2-m3 설치 후 worker 재시작'),
      profileStage('llava_caption', 'LLaVA-NeXT-Video caption', 'remote_worker', ['remote_required', 'queue'], 600_000, 'GPU worker endpoint 확인 또는 LLaVA 모델 다운로드', GPU_WORKER_URL_ENV),
      profileStage('ollama_judge', 'Ollama judge models', 'local_ollama', ['enable', 'queue', 'unload_after_request'], 240_000, 'Ollama 실행 및 exaone/EEVE/qwen/solar 모델 pull'),
      profileStage('gemini_openai_judge', 'Gemini/OpenAI OAuth judge', 'oauth_provider', ['enable', 'queue'], 240_000, 'Gemini/OpenAI OAuth 파일과 quota 확인'),
    ],
  ),
  vps_6c_12gb: profile(
    'vps_6c_12gb',
    '6c/12GB VPS',
    'CPU/메모리 제한이 있는 운영 보조 worker',
    'BGE 검색은 작은 배치로 큐잉하고, LLaVA와 큰 Ollama judge는 원격 GPU worker 또는 OAuth judge로 분리합니다.',
    false,
    [
      profileStage('bge_embed', 'BAAI/bge-m3 dense/sparse embedding', 'local_worker', ['enable', 'queue'], 240_000, 'BAAI/bge-m3 배치 크기를 낮추고 worker 재시작'),
      profileStage('bge_rerank', 'BAAI/bge-reranker-v2-m3 rerank', 'local_worker', ['enable', 'queue', 'unload_after_request'], 240_000, 'BAAI/bge-reranker-v2-m3 모델 설치 또는 원격 worker 전환'),
      profileStage('llava_caption', 'LLaVA-NeXT-Video caption', 'remote_worker', ['remote_required', 'queue'], 900_000, 'GPU caption worker endpoint 설정', GPU_WORKER_URL_ENV),
      profileStage('ollama_judge', 'Ollama judge models', 'remote_worker', ['remote_required', 'queue'], 360_000, 'Ollama judge 전용 worker endpoint 또는 모델 설치 확인', GPU_WORKER_URL_ENV),
      profileStage('gemini_openai_judge', 'Gemini/OpenAI OAuth judge', 'oauth_provider', ['enable', 'queue'], 240_000, 'OAuth 파일·quota·네트워크 확인'),
    ],
  ),
  gpu_cloud_worker: profile(
    'gpu_cloud_worker',
    'GPU 클라우드 worker',
    '원격 GPU가 있는 heavy-model 실행 환경',
    'BGE, reranker, LLaVA, Ollama judge를 GPU worker에서 실행하고 모든 단계는 큐/타임아웃 기준으로 fail-closed 처리합니다.',
    false,
    [
      profileStage('bge_embed', 'BAAI/bge-m3 dense/sparse embedding', 'remote_worker', ['enable', 'queue'], 120_000, 'GPU worker BAAI/bge-m3 모델 캐시 확인', GPU_WORKER_URL_ENV),
      profileStage('bge_rerank', 'BAAI/bge-reranker-v2-m3 rerank', 'remote_worker', ['enable', 'queue'], 120_000, 'GPU worker BAAI/bge-reranker-v2-m3 모델 캐시 확인', GPU_WORKER_URL_ENV),
      profileStage('llava_caption', 'LLaVA-NeXT-Video caption', 'remote_worker', ['enable', 'queue'], 600_000, 'GPU worker LLaVA 모델 캐시와 VRAM 확인', GPU_WORKER_URL_ENV),
      profileStage('ollama_judge', 'Ollama judge models', 'remote_worker', ['enable', 'queue'], 300_000, 'GPU worker Ollama 모델 pull 상태 확인', GPU_WORKER_URL_ENV),
      profileStage('gemini_openai_judge', 'Gemini/OpenAI OAuth judge', 'oauth_provider', ['enable', 'queue'], 240_000, 'OAuth 파일·quota·네트워크 확인'),
    ],
  ),
  macbook_pro_m5_max: profile(
    'macbook_pro_m5_max',
    'MacBook Pro M5 Max 예정',
    '고성능 로컬 Apple Silicon 개발/검증 장비',
    'BGE/reranker/Ollama는 로컬 worker·Ollama에서 큐잉하고, LLaVA는 로컬 우선·필요 시 GPU endpoint로 분리합니다.',
    false,
    [
      profileStage('bge_embed', 'BAAI/bge-m3 dense/sparse embedding', 'local_worker', ['enable', 'queue'], 120_000, 'BAAI/bge-m3 모델 캐시 확인 및 worker 재시작'),
      profileStage('bge_rerank', 'BAAI/bge-reranker-v2-m3 rerank', 'local_worker', ['enable', 'queue'], 120_000, 'BAAI/bge-reranker-v2-m3 모델 캐시 확인 및 worker 재시작'),
      profileStage('llava_caption', 'LLaVA-NeXT-Video caption', 'local_worker', ['enable', 'queue', 'unload_after_request'], 600_000, 'LLaVA 모델 설치·Metal/MPS 메모리 확인 또는 GPU endpoint 설정'),
      profileStage('ollama_judge', 'Ollama judge models', 'local_ollama', ['enable', 'queue'], 240_000, 'Ollama 실행 및 judge 모델 pull 상태 확인'),
      profileStage('gemini_openai_judge', 'Gemini/OpenAI OAuth judge', 'oauth_provider', ['enable', 'queue'], 240_000, 'OAuth 파일·quota·네트워크 확인'),
    ],
  ),
  ci_exception_only: profile(
    'ci_exception_only',
    'CI 예외 처리 검증',
    'credentials/network/GPU 없는 테스트 환경',
    '실제 provider를 호출하지 않고 프로파일 선택, Korean fail-closed 메시지, 예외 매핑만 검증합니다. 성공 결과를 합성하지 않습니다.',
    true,
    [
      profileStage('bge_embed', 'BAAI/bge-m3 dense/sparse embedding', 'not_invoked_in_ci', ['fail_closed_exception_only'], 1_000, 'CI에서는 모델 실행 대신 오류 매핑 테스트만 수행'),
      profileStage('bge_rerank', 'BAAI/bge-reranker-v2-m3 rerank', 'not_invoked_in_ci', ['fail_closed_exception_only'], 1_000, 'CI에서는 모델 실행 대신 오류 매핑 테스트만 수행'),
      profileStage('llava_caption', 'LLaVA-NeXT-Video caption', 'not_invoked_in_ci', ['fail_closed_exception_only'], 1_000, 'CI에서는 GPU 캡션 실행 없이 fail-closed 경로만 검증'),
      profileStage('ollama_judge', 'Ollama judge models', 'not_invoked_in_ci', ['fail_closed_exception_only'], 1_000, 'CI에서는 Ollama 실행 없이 fail-closed 경로만 검증'),
      profileStage('gemini_openai_judge', 'Gemini/OpenAI OAuth judge', 'not_invoked_in_ci', ['fail_closed_exception_only'], 1_000, 'CI에서는 OAuth provider 호출 없이 fail-closed 경로만 검증'),
    ],
  ),
};

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
    allScreenshotModelsRegistered: true,
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
