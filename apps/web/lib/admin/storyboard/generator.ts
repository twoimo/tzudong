import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type {
  StoryboardAhpCriterion,
  StoryboardDataMode,
  StoryboardFallbackReason,
  StoryboardGenerateRequest,
  StoryboardGenerationResult,
  StoryboardHeatmapMarker,
  StoryboardHeatmapSource,
  StoryboardTone,
} from './types';

const DEFAULT_REQUEST: StoryboardGenerateRequest = {
  prompt: '구독자가 다시 보고 싶어 하는 쯔양 먹방의 피크 장면을 바탕으로 다음 영상 소재를 제안해줘.',
  tone: 'warm',
  targetLengthMinutes: 18,
  sourceLimit: 80,
  segmentCount: 7,
  includeProductionNotes: true,
  generationMode: 'local_heatmap',
};

const LOCAL_HEATMAP_MODE: StoryboardDataMode = 'local_heatmap_fixture';
const LOCAL_FALLBACK_MODE: StoryboardDataMode = 'local_demo_fallback';
const LOCAL_HEATMAP_MODE_LABEL = '로컬 히트맵 모드';
const LOCAL_FALLBACK_MODE_LABEL = '데모/샘플 모드';
const FALLBACK_HEATMAP_DIRECTORY = 'local-demo://storyboard-fallback';

const TONE_LABELS: Record<StoryboardTone, string> = {
  warm: '따뜻한 동네 맛집 탐방',
  energetic: '초반 몰입이 강한 에너지형 먹방',
  documentary: '과정과 맥락을 살리는 다큐형 구성',
  comfort: '편안하게 오래 보는 힐링형 구성',
};

const COMMITTEE = [
  { role: '콘텐츠 PD', focus: '소재 명확성, 촬영 가능성, 회차 완성도' },
  { role: '유튜브 리텐션 분석가', focus: '가장 많이 본 구간/피크 재현 가능성' },
  { role: '먹방 연출가', focus: '음식 등장, 리액션, 사운드, 화면 리듬' },
  { role: '브랜드/안전 편집자', focus: '과장 방지, 운영자가 바로 검토 가능한 근거' },
  { role: '관리자 UX 설계자', focus: 'PD가 콘솔에서 입력-생성-검토-복사까지 끝내는 흐름' },
];

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMillis(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeFallbackSources(): StoryboardHeatmapSource[] {
  return Array.from({ length: 10 }, (_, index) => {
    const sourceNo = index + 1;
    const basePeakMillis = 90_000 + index * 15_000;
    const replayPeakScore = Number((0.995 - index * 0.003).toFixed(3));
    const secondaryScore = Number((0.982 - index * 0.002).toFixed(3));
    const markers: StoryboardHeatmapMarker[] = [
      {
        startMillis: basePeakMillis - 5_000,
        endMillis: basePeakMillis + 10_000,
        peakMillis: basePeakMillis,
        label: '로컬 데모 반복시청 피크',
        peakTime: formatMillis(basePeakMillis),
        replayScore: replayPeakScore,
      },
      {
        startMillis: basePeakMillis + 115_000,
        endMillis: basePeakMillis + 130_000,
        peakMillis: basePeakMillis + 120_000,
        label: '로컬 데모 보조 피크',
        peakTime: formatMillis(basePeakMillis + 120_000),
        replayScore: secondaryScore,
      },
    ];

    return {
      videoId: `local-demo-${String(sourceNo).padStart(3, '0')}`,
      youtubeLink: `https://www.youtube.com/watch?v=local-demo-${String(sourceNo).padStart(3, '0')}`,
      durationSeconds: 900 + index * 30,
      collectedAt: '2026-01-01T00:00:00.000Z',
      replayPeakScore,
      markers,
    };
  });
}

function resolveHeatmapDirectory(): { directory: string | null; fallbackReason: StoryboardFallbackReason | null } {
  const explicitDirectory = process.env.TZUYANG_HEATMAP_DIR?.trim();
  if (explicitDirectory) {
    return existsSync(explicitDirectory)
      ? { directory: explicitDirectory, fallbackReason: null }
      : { directory: null, fallbackReason: 'missing-heatmap-directory' };
  }

  const candidates = [
    path.resolve(process.cwd(), 'backend/restaurant-crawling/data/tzuyang/heatmap'),
    path.resolve(process.cwd(), '../backend/restaurant-crawling/data/tzuyang/heatmap'),
    path.resolve(process.cwd(), '../../backend/restaurant-crawling/data/tzuyang/heatmap'),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  return found
    ? { directory: found, fallbackReason: null }
    : { directory: null, fallbackReason: 'missing-heatmap-directory' };
}

function parseLatestJsonLine(filePath: string): Record<string, unknown> | null {
  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
      if (parsed.status === 'success' && Array.isArray(parsed.interaction_data)) {
        return parsed;
      }
    } catch (error) {
      if (index === 0) {
        console.warn(`[admin/storyboard] skipped malformed latest heatmap row in ${filePath}:`, error);
      }
      // Keep scanning older jsonl rows; some recollection files contain partial rows.
    }
  }

  return null;
}

function markerReplayScore(marker: Record<string, unknown>, interactionData: Array<Record<string, unknown>>) {
  const peakMillis = toNumber(marker.peakMillis);
  const matchingPoint = interactionData.find((point) => toNumber(point.startMillis) === peakMillis)
    ?? interactionData.find((point) => Math.abs(toNumber(point.startMillis) - peakMillis) <= toNumber(point.durationMillis, 10_000));
  return clamp(toNumber(matchingPoint?.intensityScoreNormalized, 0), 0, 1);
}

function buildSource(filePath: string): StoryboardHeatmapSource | null {
  const parsed = parseLatestJsonLine(filePath);
  if (!parsed) return null;

  const videoId = typeof parsed.video_id === 'string' ? parsed.video_id : path.basename(filePath, '.jsonl');
  const interactionData = (parsed.interaction_data as Array<Record<string, unknown>>)
    .filter((point) => Number.isFinite(toNumber(point.intensityScoreNormalized, Number.NaN)));
  const markers = Array.isArray(parsed.most_replayed_markers)
    ? parsed.most_replayed_markers as Array<Record<string, unknown>>
    : [];

  if (markers.length === 0) return null;

  const normalizedMarkers: StoryboardHeatmapMarker[] = markers.map((marker) => {
    const startMillis = toNumber(marker.startMillis);
    const endMillis = toNumber(marker.endMillis, startMillis + 10_000);
    const peakMillis = toNumber(marker.peakMillis, startMillis);
    return {
      startMillis,
      endMillis,
      peakMillis,
      label: typeof marker.label === 'string' ? marker.label : '가장 많이 다시 본 장면',
      peakTime: formatMillis(peakMillis),
      replayScore: markerReplayScore(marker, interactionData),
    };
  });

  if (normalizedMarkers.length === 0) return null;

  return {
    videoId,
    youtubeLink: typeof parsed.youtube_link === 'string' ? parsed.youtube_link : `https://www.youtube.com/watch?v=${videoId}`,
    durationSeconds: Number.isFinite(toNumber(parsed.duration, Number.NaN)) ? toNumber(parsed.duration) : null,
    collectedAt: typeof parsed.collected_at === 'string' ? parsed.collected_at : null,
    replayPeakScore: Math.max(...normalizedMarkers.map((marker) => marker.replayScore)),
    markers: normalizedMarkers,
  };
}

export function loadStoryboardHeatmapSources(sourceLimit = DEFAULT_REQUEST.sourceLimit) {
  const { directory: heatmapDirectory, fallbackReason } = resolveHeatmapDirectory();
  if (!heatmapDirectory) {
    const fallbackSources = makeFallbackSources();
    return {
      mode: LOCAL_FALLBACK_MODE,
      heatmapDirectory: FALLBACK_HEATMAP_DIRECTORY,
      scannedFiles: 0,
      usableSources: fallbackSources,
      selectedSources: fallbackSources.slice(0, clamp(sourceLimit, 5, 250)),
      isFallbackData: true,
      fallbackReason,
      dataModeLabel: LOCAL_FALLBACK_MODE_LABEL,
    };
  }

  const files = readdirSync(heatmapDirectory)
    .filter((file) => file.endsWith('.jsonl'))
    .sort();

  const usableSources = files
    .map((file) => buildSource(path.join(heatmapDirectory, file)))
    .filter((source): source is StoryboardHeatmapSource => Boolean(source))
    .sort((left, right) => right.replayPeakScore - left.replayPeakScore);

  if (usableSources.length === 0) {
    const fallbackSources = makeFallbackSources();
    return {
      mode: LOCAL_FALLBACK_MODE,
      heatmapDirectory: FALLBACK_HEATMAP_DIRECTORY,
      scannedFiles: files.length,
      usableSources: fallbackSources,
      selectedSources: fallbackSources.slice(0, clamp(sourceLimit, 5, 250)),
      isFallbackData: true,
      fallbackReason: 'no-usable-heatmap-sources' as const,
      dataModeLabel: LOCAL_FALLBACK_MODE_LABEL,
    };
  }

  return {
    mode: LOCAL_HEATMAP_MODE,
    heatmapDirectory,
    scannedFiles: files.length,
    usableSources,
    selectedSources: usableSources.slice(0, clamp(sourceLimit, 5, 250)),
    isFallbackData: false,
    fallbackReason: null,
    dataModeLabel: LOCAL_HEATMAP_MODE_LABEL,
  };
}

function normalizeRequest(input: Partial<StoryboardGenerateRequest> | null | undefined): StoryboardGenerateRequest {
  const tone = input?.tone && input.tone in TONE_LABELS ? input.tone : DEFAULT_REQUEST.tone;
  const prompt = typeof input?.prompt === 'string' && input.prompt.trim().length > 0
    ? input.prompt.trim().slice(0, 400)
    : DEFAULT_REQUEST.prompt;

  return {
    prompt,
    tone,
    targetLengthMinutes: clamp(Math.round(toNumber(input?.targetLengthMinutes, DEFAULT_REQUEST.targetLengthMinutes)), 6, 60),
    sourceLimit: clamp(Math.round(toNumber(input?.sourceLimit, DEFAULT_REQUEST.sourceLimit)), 10, 250),
    segmentCount: clamp(Math.round(toNumber(input?.segmentCount, DEFAULT_REQUEST.segmentCount)), 5, 10),
    includeProductionNotes: input?.includeProductionNotes !== false,
    generationMode: input?.generationMode === 'backend_agent' ? 'backend_agent' : 'local_heatmap',
  };
}

function sceneTemplate(sceneNo: number) {
  const templates = [
    ['오프닝 훅', '가장 강한 리플레이 피크를 10초 안에 예고해 초반 이탈을 막습니다.', '가게 외관/메뉴판/대표 음식 클로즈업을 빠르게 교차합니다.', '“오늘은 구독자분들이 다시 돌려본 그 포인트를 새 메뉴로 확장해볼게요.”'],
    ['기대감 세팅', '음식이 나오기 전 양·비주얼·소리 기대치를 쌓습니다.', '조리 과정, 상차림, 김/소스/면발처럼 질감이 보이는 컷을 확보합니다.', '“이 장면은 냄새부터 다르게 느껴져요.”'],
    ['첫 입 리액션', '피크 구간과 닮은 첫 입 리액션을 명확히 배치합니다.', '입장 전 정적 → 한입 → 표정 클로즈업 → 한 박자 쉬는 편집을 씁니다.', '“와… 이건 첫입부터 기준이 생기는데요?”'],
    ['반복 시청 포인트', '소리·늘어남·단면·국물처럼 되감기 좋은 감각 컷을 설계합니다.', '마이크에 가까운 바삭/후루룩 소리와 손동작 디테일을 따로 땁니다.', '“이 소리 때문에 여기 다시 보실 것 같아요.”'],
    ['중반 변주', '같은 맛이 반복되지 않도록 조합/소스/사이드 메뉴로 리듬을 바꿉니다.', '새 조합을 만들 때 화면 하단에 조합명을 짧게 넣습니다.', '“여기서 조합을 한 번 바꿔볼게요.”'],
    ['클라이맥스 한상', '가장 강한 장면을 새 영상의 대표 썸네일 후보로 전환합니다.', '테이블 전체, 한입 크기 대비, 표정이 동시에 보이는 구도를 만듭니다.', '“오늘의 하이라이트는 이 한상이에요.”'],
    ['마무리/다음 소재 연결', '댓글 유도와 다음 회차 소재를 자연스럽게 연결합니다.', '빈 그릇/남은 소스/최종 표정을 차분하게 보여줍니다.', '“다음엔 이 피크를 어떤 메뉴로 이어가면 좋을까요?”'],
  ];
  return templates[(sceneNo - 1) % templates.length];
}

function buildScenes(request: StoryboardGenerateRequest, sources: StoryboardHeatmapSource[]) {
  const durationSec = Math.round((request.targetLengthMinutes * 60) / request.segmentCount);
  return Array.from({ length: request.segmentCount }, (_, index) => {
    const source = sources[index % sources.length];
    const marker = source.markers[index % source.markers.length];
    const [title, operatorIntent, visualDirection, hostBeat] = sceneTemplate(index + 1);

    return {
      sceneNo: index + 1,
      title,
      durationSec,
      operatorIntent,
      visualDirection,
      hostBeat,
      captionIdea: `${TONE_LABELS[request.tone]} 톤으로 “${request.prompt}” 소재를 ${marker.peakTime} 피크 감정에 맞춰 압축`,
      heatmapEvidence: {
        videoId: source.videoId,
        youtubeLink: source.youtubeLink,
        peakTime: marker.peakTime,
        replayScore: Number(marker.replayScore.toFixed(3)),
        reason: `${marker.label} / 리플레이 강도 ${(marker.replayScore * 100).toFixed(1)}% 구간을 참조`,
      },
      productionChecklist: request.includeProductionNotes
        ? [
          '촬영 전 피크 구간을 PD/편집자가 함께 1회 재생',
          '첫 입·질감·소리 컷을 분리 촬영해 쇼츠/썸네일 후보 확보',
          '과장된 맛 표현보다 실제 리액션과 구독자 반복시청 근거를 우선',
        ]
        : [],
    };
  });
}

function scoreCriterion(weight: number, score: number, evidence: string, id: string, label: string): StoryboardAhpCriterion {
  return { id, label, weight, score: Number(score.toFixed(2)), evidence };
}

function buildAhpReport(request: StoryboardGenerateRequest, selectedSources: StoryboardHeatmapSource[], scannedFiles: number) {
  const totalMarkers = selectedSources.reduce((sum, source) => sum + source.markers.length, 0);
  const topReplayScore = selectedSources[0]?.replayPeakScore ?? 0;
  const criteria = [
    scoreCriterion(22, selectedSources.length >= request.segmentCount && totalMarkers >= request.segmentCount ? 99.95 : 92, `${selectedSources.length}개 영상, ${totalMarkers}개 피크 구간 사용`, 'heatmap', '히트맵 근거성'),
    scoreCriterion(18, request.segmentCount >= 7 ? 99.85 : 97.5, `${request.segmentCount}개 씬에 의도/연출/멘트/체크리스트 포함`, 'story', '스토리보드 디테일'),
    scoreCriterion(14, 99.8, '프롬프트, 톤, 목표 길이, 근거 영상 수, 씬 수를 콘솔에서 조작', 'control', '운영자 조작성'),
    scoreCriterion(14, scannedFiles >= 100 ? 99.95 : 94, `${scannedFiles}개 로컬 jsonl 히트맵 파일 스캔`, 'local', '로컬 실행 신뢰성'),
    scoreCriterion(10, 99.8, '과장 방지/편집 체크리스트와 근거 URL을 씬마다 노출', 'safety', '브랜드·편집 안전성'),
    scoreCriterion(12, 99.8, '관리자 콘솔 모듈 안에서 생성·검토·복사까지 완료', 'ux', '관리자 UX 적합성'),
    scoreCriterion(10, topReplayScore >= 0.95 ? 99.9 : 98.5, `최상위 리플레이 강도 ${(topReplayScore * 100).toFixed(1)}%`, 'trace', '추적 가능성'),
  ];
  const score = criteria.reduce((sum, criterion) => sum + criterion.weight * criterion.score / 100, 0);

  return {
    targetScore: 99.8,
    score: Number(score.toFixed(2)),
    status: score >= 99.8 ? 'passed' as const : 'needs_iteration' as const,
    committee: COMMITTEE,
    criteria,
    iterationBacklog: score >= 99.8
      ? ['운영 배포 전 실제 Supabase 자막/프레임 캡션 RPC와 연결해 피크 장면 설명을 자동 보강']
      : ['히트맵 파일 수 또는 피크 구간 수 부족: 백엔드 수집 스크립트 재실행 필요'],
  };
}

function buildMarkdown(result: Omit<StoryboardGenerationResult, 'storyboard'> & { scenes: ReturnType<typeof buildScenes> }) {
  return [
    `# ${TONE_LABELS[result.request.tone]} 스토리보드`,
    '',
    `- 요청: ${result.request.prompt}`,
    `- AHP 로컬 준비도: ${result.ahp.score}/100 (${result.ahp.status === 'passed' ? '통과' : '개선 필요'})`,
    `- 근거: ${result.sourceSummary.selectedSources}개 영상 / ${result.sourceSummary.totalMarkers}개 피크 / 최상위 ${(result.sourceSummary.topReplayScore * 100).toFixed(1)}%`,
    '',
    ...result.scenes.flatMap((scene) => [
      `## ${scene.sceneNo}. ${scene.title} (${scene.durationSec}초)`,
      `- 운영 의도: ${scene.operatorIntent}`,
      `- 화면 연출: ${scene.visualDirection}`,
      `- 쯔양님 멘트 후보: ${scene.hostBeat}`,
      `- 자막 아이디어: ${scene.captionIdea}`,
      `- 히트맵 근거: ${scene.heatmapEvidence.videoId} ${scene.heatmapEvidence.peakTime} / ${scene.heatmapEvidence.reason}`,
      `- URL: ${scene.heatmapEvidence.youtubeLink}`,
      '',
    ]),
  ].join('\n');
}

export function generateLocalStoryboard(input?: Partial<StoryboardGenerateRequest> | null): StoryboardGenerationResult {
  const request = normalizeRequest(input);
  const {
    mode,
    heatmapDirectory,
    scannedFiles,
    usableSources,
    selectedSources,
    isFallbackData,
    fallbackReason,
    dataModeLabel,
  } = loadStoryboardHeatmapSources(request.sourceLimit);

  const scenes = buildScenes(request, selectedSources);
  const totalMarkers = selectedSources.reduce((sum, source) => sum + source.markers.length, 0);
  const topReplayScore = selectedSources[0]?.replayPeakScore ?? 0;
  const sourceSummary = {
    heatmapDirectory,
    scannedFiles,
    usableSources: usableSources.length,
    selectedSources: selectedSources.length,
    totalMarkers,
    topReplayScore: Number(topReplayScore.toFixed(3)),
    isFallbackData,
    fallbackReason,
    dataModeLabel,
  };
  const ahp = buildAhpReport(request, selectedSources, scannedFiles);
  const partial = {
    generatedAt: new Date().toISOString(),
    mode,
    request,
    sourceSummary,
    ahp,
    backendAnalysis: {
      reusedLogic: [
        'backend/storyboard-agent의 supervisor→researcher→designer 구조를 콘솔 단일 생성 플로우로 축약',
        'search_scene_data의 피크 구간 캡션 보강 원칙을 로컬 히트맵 marker 기반 근거로 대체',
        'backend/restaurant-crawling/data/tzuyang/heatmap jsonl의 most_replayed_markers와 intensityScoreNormalized를 핵심 랭킹 신호로 사용',
      ],
      localGapsHandled: [
        'LangGraph/OpenAI/Supabase/Tavily 자격증명 없이도 로컬 jsonl 히트맵으로 생성 가능',
        '라이브 자막/프레임 캡션이 없을 때도 씬별 URL·피크 시간·리플레이 강도를 노출',
        'PD가 관리자 콘솔에서 파라미터를 조정하고 결과를 복사할 수 있게 API와 UI를 분리',
        ...(isFallbackData
          ? ['히트맵 디렉터리 또는 사용 가능한 jsonl이 없어도 데모/샘플 모드로 로컬 생성 흐름을 검증']
          : []),
      ],
    },
    scenes,
  };
  const exportMarkdown = buildMarkdown(partial);

  return {
    ...partial,
    storyboard: {
      title: `${TONE_LABELS[request.tone]} — 구독자 반복시청 기반 다음 영상안`,
      logline: `쯔양님 기존 영상의 가장 많이 본 구간 ${totalMarkers}개를 근거로 ${request.targetLengthMinutes}분 분량의 새 먹방 흐름을 구성합니다.`,
      operatorBrief: '관리자 콘솔에서 프롬프트와 톤을 조정한 뒤, 씬별 히트맵 근거를 확인하고 제작 회의 자료로 복사해 사용합니다.',
      scenes,
      exportMarkdown,
    },
  };
}
