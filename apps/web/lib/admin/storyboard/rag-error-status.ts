export type StoryboardRagFailureStage =
  | 'worker_connection'
  | 'bge_embedding'
  | 'supabase_search'
  | 'reranker'
  | 'llava_caption'
  | 'judge';

export type StoryboardRagFailureStatus = {
  error: string;
  causeCode: string;
  stage: StoryboardRagFailureStage;
  stageLabel: string;
  message: string;
  nextActions: string[];
  traceId?: string;
  trace: Array<{
    step: StoryboardRagFailureStage;
    status: 'failed';
    causeCode: string;
    detail: string;
  }>;
};

const STAGE_INFO: Record<StoryboardRagFailureStage, {
  label: string;
  message: string;
  nextActions: string[];
}> = {
  worker_connection: {
    label: 'worker 연결',
    message: 'RAG worker에 연결하지 못해 작업을 중단했어요. 결과를 임시로 만들지 않았습니다.',
    nextActions: [
      'RAG worker를 다시 시작해 주세요.',
      'STORYBOARD_RAG_WORKER_URL이 실행 중인 worker 주소와 같은지 확인해 주세요.',
      '모델 로딩이 오래 걸리면 STORYBOARD_RAG_WORKER_TIMEOUT_MS 값을 늘려 주세요.',
    ],
  },
  bge_embedding: {
    label: 'BGE 임베딩',
    message: 'BGE-M3 임베딩 단계에서 필수 dense/sparse 결과 검증이 실패해 중단했어요.',
    nextActions: [
      'BAAI/bge-m3 모델이 Python worker 환경에 설치되어 있는지 확인해 주세요.',
      'worker 로그에서 /embed 요청과 모델 로딩 오류를 확인해 주세요.',
      '첫 로딩 시간이 길면 worker를 미리 예열하거나 타임아웃을 늘려 주세요.',
    ],
  },
  supabase_search: {
    label: 'Supabase 검색',
    message: 'Supabase 문서 저장 또는 하이브리드 검색 단계에서 중단했어요.',
    nextActions: [
      'documents 테이블, pgvector 확장, hybrid search RPC migration이 적용됐는지 확인해 주세요.',
      'Supabase service role 환경 변수가 서버 전용으로 설정되어 있는지 확인해 주세요.',
      'RPC 파라미터와 RLS 정책이 현재 사용자 ID를 허용하는지 확인해 주세요.',
    ],
  },
  reranker: {
    label: 'reranker',
    message: 'bge-reranker-v2-m3 재정렬 단계에서 필수 결과 검증이 실패해 중단했어요.',
    nextActions: [
      'BAAI/bge-reranker-v2-m3 모델이 Python worker 환경에 설치되어 있는지 확인해 주세요.',
      'worker 로그에서 /rerank 요청과 후보 문서 수를 확인해 주세요.',
      'GPU/메모리 부족이나 모델 첫 로딩 지연이면 worker를 예열하거나 타임아웃을 늘려 주세요.',
    ],
  },
  llava_caption: {
    label: 'LLaVA caption',
    message: 'LLaVA-NeXT-Video-7B-hf 캡션 단계에서 필수 모델 실행이 실패해 중단했어요.',
    nextActions: [
      'llava-hf/LLaVA-NeXT-Video-7B-hf 모델 파일이 다운로드됐는지 확인해 주세요.',
      '프레임 이미지 경로와 GPU/메모리 여유를 확인해 주세요.',
      '영상 캡션 첫 실행이 길면 worker를 예열하거나 타임아웃을 늘려 주세요.',
    ],
  },
  judge: {
    label: 'judge',
    message: 'Gemini/OpenAI/Ollama judge 또는 planning 모델 단계에서 필수 provider 확인이 실패해 중단했어요.',
    nextActions: [
      'Gemini/OpenAI OAuth 파일과 권한이 유효한지 확인해 주세요.',
      'Ollama가 실행 중인지 확인하고 필요한 judge 모델을 다운로드해 주세요.',
      'provider quota·네트워크·타임아웃 설정을 확인해 주세요.',
    ],
  },
};

const STAGE_PATTERNS: Array<[StoryboardRagFailureStage, RegExp]> = [
  ['bge_embedding', /bge|embed|embedding|sparse|vector/i],
  ['reranker', /rerank|reranker/i],
  ['supabase_search', /supabase|rpc|documents?_upsert|hybrid|pgvector|database|db/i],
  ['llava_caption', /llava|caption|video_caption/i],
  ['judge', /judge|gemini|openai|ollama|oauth|provider|model_stack|planning/i],
  ['worker_connection', /worker|fetch|abort|timeout|unavailable|url_missing|connection/i],
];

function mapRawFailureToCauseCode(value: string) {
  const lower = value.toLowerCase();
  if (/rerank|reranker/.test(lower)) return 'required_storyboard_rag_worker_rerank_failed';
  if (/bge|embed|embedding|sparse|vector/.test(lower)) return 'required_storyboard_rag_worker_embed_failed';
  if (/supabase|rpc|document|hybrid|pgvector|database|\bdb\b|password/.test(lower)) return 'storyboard_rag_search_rpc_failed';
  if (/llava|caption|video_caption|cuda|vram|gpu/.test(lower)) return 'required_llava_caption_failed';
  if (/judge|gemini|openai|ollama|oauth|provider|model|api_key|token|secret|quota/.test(lower)) return 'required_judge_provider_failed';
  if (/worker|fetch|abort|timeout|unavailable|url|connection|network/.test(lower)) return 'required_storyboard_rag_worker_unavailable';
  return 'storyboard_rag_failed';
}

function containsUnsafeRawMarker(value: string) {
  return /api[_-]?key|secret|token|password|bearer|cookie|auth\.json|oauth_creds|\\.codex|\\.gemini|sk-[a-z0-9_-]+|eyj[a-z0-9_-]+/i.test(value);
}


function sanitizeCauseCode(value: string) {
  const [firstSegment] = value.split(':');
  const normalized = firstSegment
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  const firstSegmentUnsafe = containsUnsafeRawMarker(firstSegment) || containsUnsafeRawMarker(normalized);
  if (/^(required|storyboard|invalid|oauth|session|unauthorized)[a-zA-Z0-9_.-]*$/.test(normalized) && !firstSegmentUnsafe) {
    return normalized;
  }
  if (containsUnsafeRawMarker(value)) {
    return mapRawFailureToCauseCode(value);
  }
  return mapRawFailureToCauseCode(value);
}

function rawErrorText(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'error' in error) {
    const value = (error as { error?: unknown }).error;
    if (typeof value === 'string') return value;
  }
  return 'storyboard_rag_failed';
}

export function classifyStoryboardRagFailureStage(
  causeCode: string,
  preferredStage?: StoryboardRagFailureStage,
): StoryboardRagFailureStage {
  if (preferredStage) return preferredStage;
  for (const [stage, pattern] of STAGE_PATTERNS) {
    if (pattern.test(causeCode)) return stage;
  }
  return 'worker_connection';
}

export function buildStoryboardRagFailureStatus(args: {
  causeCode: string;
  preferredStage?: StoryboardRagFailureStage;
  traceId?: string;
}): StoryboardRagFailureStatus {
  const causeCode = sanitizeCauseCode(args.causeCode);
  const stage = classifyStoryboardRagFailureStage(causeCode, args.preferredStage);
  const info = STAGE_INFO[stage];
  const detail = [
    `원인 코드: ${causeCode}`,
    `설명: ${info.message}`,
    `다음 조치: ${info.nextActions.join(' / ')}`,
  ].join(' · ');
  return {
    error: causeCode,
    causeCode,
    stage,
    stageLabel: info.label,
    message: info.message,
    nextActions: info.nextActions,
    ...(args.traceId ? { traceId: args.traceId } : {}),
    trace: [
      {
        step: stage,
        status: 'failed',
        causeCode,
        detail,
      },
    ],
  };
}

export function buildStoryboardRagErrorStatus(
  error: unknown,
  options: {
    fallbackCauseCode?: string;
    preferredStage?: StoryboardRagFailureStage;
    traceId?: string;
  } = {},
) {
  const raw = rawErrorText(error);
  return buildStoryboardRagFailureStatus({
    causeCode: raw === 'storyboard_rag_failed' ? (options.fallbackCauseCode ?? raw) : raw,
    preferredStage: options.preferredStage,
    traceId: options.traceId,
  });
}

export function formatStoryboardRagFailureTraceDetail(status: StoryboardRagFailureStatus) {
  return status.trace[0]?.detail ?? `원인 코드: ${status.causeCode} · 설명: ${status.message}`;
}
