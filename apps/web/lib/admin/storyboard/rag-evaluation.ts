import type { StoryboardRagDiagnostics, StoryboardRagProviderDescriptor } from './rag';
import type { StoryboardFallbackReason, StoryboardGenerationResult } from './types';

export type StoryboardRagEvaluationCriterionId =
  | 'intent_alignment'
  | 'evidence_grounding'
  | 'retrieval_relevance'
  | 'rerank_usefulness'
  | 'diversity_coverage'
  | 'temporal_pacing'
  | 'storyboard_actionability'
  | 'visual_specificity'
  | 'safety_fail_closed';

export type StoryboardRagEvaluationCriterion = {
  id: StoryboardRagEvaluationCriterionId;
  label: string;
  weight: number;
  score: number;
  evidence: string;
};

export type StoryboardRagEvaluationSourceSummary = {
  mode: StoryboardGenerationResult['mode'];
  heatmapDirectory: string;
  dataModeLabel: string;
  isFallbackData: boolean;
  fallbackReason: StoryboardFallbackReason | null;
  usableSources: number;
  selectedSources: number;
  totalMarkers: number;
};

export type StoryboardRagEvaluationReport = {
  schemaVersion: 1;
  experimentId: string;
  targetScore: number;
  score: number;
  status: 'passed' | 'needs_iteration';
  testMode: 'deterministic_fixtures';
  providerPolicy: 'required_live_model_stack_fail_closed';
  sourceSummary: StoryboardRagEvaluationSourceSummary;
  criteria: StoryboardRagEvaluationCriterion[];
  blockers: string[];
  iterationBacklog: string[];
};

const RAG_EVALUATION_WEIGHTS: Record<StoryboardRagEvaluationCriterionId, number> = {
  intent_alignment: 12,
  evidence_grounding: 14,
  retrieval_relevance: 14,
  rerank_usefulness: 10,
  diversity_coverage: 10,
  temporal_pacing: 8,
  storyboard_actionability: 12,
  visual_specificity: 10,
  safety_fail_closed: 10,
};

const EXPECTED_EMBEDDING_PROVIDER_ID = 'BAAI/bge-m3';
const EXPECTED_RERANKER_PROVIDER_ID = 'BAAI/bge-reranker-v2-m3';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedScore(value: number) {
  if (!isFiniteNumber(value)) return 0;
  return Number(Math.max(0, Math.min(100, value)).toFixed(2));
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
  return normalized ? normalized.split(' ').filter((token) => token.length >= 2) : [];
}

function ratio(value: number, denominator: number) {
  if (!isFiniteNumber(value) || !isFiniteNumber(denominator) || denominator <= 0) return 0;
  return Math.max(0, Math.min(1, value / denominator));
}

function sourceSummarySnapshot(result: StoryboardGenerationResult): StoryboardRagEvaluationSourceSummary {
  return {
    mode: result.mode,
    heatmapDirectory: result.sourceSummary.heatmapDirectory,
    dataModeLabel: result.sourceSummary.dataModeLabel,
    isFallbackData: result.sourceSummary.isFallbackData,
    fallbackReason: result.sourceSummary.fallbackReason,
    usableSources: result.sourceSummary.usableSources,
    selectedSources: result.sourceSummary.selectedSources,
    totalMarkers: result.sourceSummary.totalMarkers,
  };
}

function isTrustedSourceSummary(result: StoryboardGenerationResult) {
  const summary = sourceSummarySnapshot(result);
  const heatmapDirectory = summary.heatmapDirectory.toLowerCase();
  const demoLikeLabel = /demo|fallback|샘플|데모/.test(summary.dataModeLabel.toLowerCase());
  return (
    result.mode !== 'local_demo_fallback' &&
    !heatmapDirectory.startsWith('local-demo://') &&
    !demoLikeLabel &&
    summary.isFallbackData === false &&
    summary.fallbackReason === null &&
    summary.usableSources > 0 &&
    summary.selectedSources > 0 &&
    summary.totalMarkers > 0
  );
}

function describeSourceSummary(result: StoryboardGenerationResult) {
  const summary = sourceSummarySnapshot(result);
  return [
    `mode=${summary.mode}`,
    `heatmapDirectory=${summary.heatmapDirectory}`,
    `label=${summary.dataModeLabel}`,
    `isFallbackData=${summary.isFallbackData}`,
    `fallbackReason=${summary.fallbackReason ?? 'none'}`,
    `usableSources=${summary.usableSources}`,
    `selectedSources=${summary.selectedSources}`,
    `totalMarkers=${summary.totalMarkers}`,
  ].join('; ');
}

function containsRequiredBgeProvider(value: unknown) {
  const normalized = JSON.stringify(value ?? {}).toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  return (
    compact.includes('baaibgem3') ||
    compact.includes('baibgem3') ||
    compact.includes('bgem3') ||
    compact.includes('bgererankerv2m3') ||
    compact.includes('bgereranker')
  );
}

function isExpectedProvider(
  value: unknown,
  expectedId: typeof EXPECTED_EMBEDDING_PROVIDER_ID | typeof EXPECTED_RERANKER_PROVIDER_ID,
) {
  const provider = value as Partial<StoryboardRagProviderDescriptor> | null | undefined;
  return (
    provider?.id === expectedId &&
    provider.kind === 'required_model_provider' &&
    provider.evidenceBound === true &&
    typeof provider.modelLabel === 'string' &&
    containsRequiredBgeProvider(provider.modelLabel)
  );
}

function auditLocalRagProviders(localRag: StoryboardRagDiagnostics | undefined) {
  const providers = localRag?.providers as Partial<StoryboardRagDiagnostics['providers']> | undefined;
  const providerText = JSON.stringify(providers ?? {});
  const embeddingValid = isExpectedProvider(providers?.embedding, EXPECTED_EMBEDDING_PROVIDER_ID);
  const rerankerValid = isExpectedProvider(providers?.reranker, EXPECTED_RERANKER_PROVIDER_ID);
  const requiredBgeClaimPresent = containsRequiredBgeProvider(providerText);
  const valid = embeddingValid && rerankerValid && requiredBgeClaimPresent;
  return {
    valid,
    embeddingValid,
    rerankerValid,
    requiredBgeClaimPresent,
    evidence: [
      `providerDescriptorsValid=${valid}`,
      `embeddingValid=${embeddingValid}`,
      `rerankerValid=${rerankerValid}`,
      `requiredBgeClaimPresent=${requiredBgeClaimPresent}`,
    ].join('; '),
  };
}

function getLocalRagMatches(localRag: StoryboardRagDiagnostics | undefined) {
  return Array.isArray(localRag?.matches) ? localRag.matches : [];
}

function findInvalidRagMatchMetric(localRag: StoryboardRagDiagnostics | undefined) {
  if (!localRag || localRag.status !== 'used') return null;
  if (!Array.isArray(localRag.matches)) return 'RAG match 배열이 없음';
  for (const [index, match] of localRag.matches.entries()) {
    const candidate = match as Partial<StoryboardRagDiagnostics['matches'][number]>;
    const metrics: Array<[string, unknown]> = [
      ['score', candidate.score],
      ['similarityScore', candidate.similarityScore],
      ['rerankScore', candidate.rerankScore],
      ['diversityPenalty', candidate.diversityPenalty],
    ];
    for (const [name, value] of metrics) {
      if (!isFiniteNumber(value)) {
        return `RAG match #${index + 1} ${name} 값이 유한한 숫자가 아님`;
      }
    }
  }
  return null;
}

function criterion(
  id: StoryboardRagEvaluationCriterionId,
  score: number,
  evidence: string,
): StoryboardRagEvaluationCriterion {
  const labels: Record<StoryboardRagEvaluationCriterionId, string> = {
    intent_alignment: '의도 정렬',
    evidence_grounding: '근거성',
    retrieval_relevance: '검색 관련성',
    rerank_usefulness: '리랭크 유용성',
    diversity_coverage: '다양성/커버리지',
    temporal_pacing: '시간 배분',
    storyboard_actionability: '제작 실행성',
    visual_specificity: '비주얼 구체성',
    safety_fail_closed: '안전/Fail-closed',
  };
  return {
    id,
    label: labels[id],
    weight: RAG_EVALUATION_WEIGHTS[id],
    score: boundedScore(score),
    evidence,
  };
}

function scoreIntentAlignment(result: StoryboardGenerationResult) {
  const promptTokens = new Set(wordTokens(result.request.prompt));
  const keywordHits = result.planner?.topicProfile.keywords.filter((keyword) =>
    promptTokens.has(normalizeText(keyword)),
  ).length ?? 0;
  const profileHit = result.planner?.topicProfile.label
    ? result.request.prompt.includes(result.planner.topicProfile.label.replace(/\s*먹방$/, ''))
    : false;
  const score = Math.min(100, 72 + keywordHits * 8 + (profileHit ? 8 : 0));
  return criterion(
    'intent_alignment',
    score,
    `${keywordHits}개 주제 키워드가 프롬프트와 정렬됨; profile=${result.planner?.topicProfile.label ?? 'unknown'}`,
  );
}

function scoreEvidenceGrounding(result: StoryboardGenerationResult) {
  const sourceTrusted = isTrustedSourceSummary(result);
  if (!sourceTrusted) {
    return criterion(
      'evidence_grounding',
      45,
      `sourceTrusted=false; ${describeSourceSummary(result)}; demo source cannot prove RAG grounding`,
    );
  }
  const scenesWithEvidence = result.storyboard.scenes.filter((scene) =>
    scene.heatmapEvidence.videoId && scene.heatmapEvidence.peakTime && scene.heatmapEvidence.reason,
  ).length;
  const score = 60 + ratio(scenesWithEvidence, result.storyboard.scenes.length) * 40;
  return criterion(
    'evidence_grounding',
    score,
    `sourceTrusted=true; ${scenesWithEvidence}/${result.storyboard.scenes.length}개 CUT이 videoId/peakTime/reason 근거를 포함; ${describeSourceSummary(result)}`,
  );
}

function scoreRetrievalRelevance(result: StoryboardGenerationResult) {
  const localRag = result.backendAnalysis.localRag;
  if (!localRag) {
    return criterion('retrieval_relevance', 0, 'backendAnalysis.localRag 없음');
  }
  if (localRag.status !== 'used') {
    return criterion(
      'retrieval_relevance',
      55,
      `RAG가 fail-closed 처리됨: ${localRag.providerUnavailableReason ?? localRag.status}`,
    );
  }
  const invalidMetric = findInvalidRagMatchMetric(localRag);
  if (invalidMetric) {
    return criterion('retrieval_relevance', 0, invalidMetric);
  }
  const matches = getLocalRagMatches(localRag);
  if (!matches.length) {
    return criterion('retrieval_relevance', 0, 'RAG status=used 이지만 match가 없음');
  }
  const average = matches.reduce((sum, match) => sum + match.score, 0) / matches.length;
  if (!isFiniteNumber(average)) {
    return criterion('retrieval_relevance', 0, 'RAG match 평균 점수가 유한한 숫자가 아님');
  }
  const normalizedScore = Math.min(100, 45 + average * 0.65);
  return criterion(
    'retrieval_relevance',
    normalizedScore,
    `${matches.length}개 heatmap_marker match 평균 원점수 ${average.toFixed(1)}를 루브릭 점수 ${normalizedScore.toFixed(1)}로 환산`,
  );
}

function scoreRerankUsefulness(result: StoryboardGenerationResult) {
  const localRag = result.backendAnalysis.localRag;
  if (!localRag) return criterion('rerank_usefulness', 0, 'localRag 없음');
  if (localRag.status !== 'used') {
    return criterion('rerank_usefulness', 64, `리랭크 전 fail-closed: ${localRag.providerUnavailableReason ?? 'not_used'}`);
  }
  const invalidMetric = findInvalidRagMatchMetric(localRag);
  if (invalidMetric) {
    return criterion('rerank_usefulness', 0, invalidMetric);
  }
  const matches = getLocalRagMatches(localRag);
  if (!matches.length) {
    return criterion('rerank_usefulness', 0, 'RAG status=used 이지만 rerank 대상 match가 없음');
  }
  if (localRag.operations?.mmrApplied !== true) {
    return criterion('rerank_usefulness', 62, 'RAG status=used 이지만 MMR rerank 적용이 보고되지 않음');
  }
  const hasScoreSpread = new Set(matches.map((match) => match.score)).size > 1;
  const hasDiversityPenalty = matches.some((match) => match.diversityPenalty > 0);
  return criterion(
    'rerank_usefulness',
    82 + (hasScoreSpread ? 10 : 0) + (hasDiversityPenalty ? 4 : 0),
    `mmr=${localRag.operations.mmrApplied}; scoreSpread=${hasScoreSpread}; diversityPenalty=${hasDiversityPenalty}`,
  );
}

function scoreDiversityCoverage(result: StoryboardGenerationResult) {
  const uniqueVideos = new Set(
    result.storyboard.scenes.map((scene) => scene.heatmapEvidence.videoId).filter(Boolean),
  ).size;
  const roleCount = result.planner?.arcPlan.roles.length ?? result.storyboard.scenes.length;
  const score = 55 + ratio(uniqueVideos, result.storyboard.scenes.length) * 25 + ratio(roleCount, result.request.segmentCount) * 20;
  return criterion(
    'diversity_coverage',
    score,
    `${uniqueVideos}개 고유 영상 근거와 ${roleCount}/${result.request.segmentCount}개 아크 역할 커버`,
  );
}

function scoreTemporalPacing(result: StoryboardGenerationResult) {
  const totalDuration = result.storyboard.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  const targetDuration = result.request.targetLengthMinutes * 60;
  const drift = Math.abs(totalDuration - targetDuration) / Math.max(targetDuration, 1);
  return criterion(
    'temporal_pacing',
    100 - Math.min(40, drift * 100),
    `총 CUT 길이 ${totalDuration}초 / 목표 ${targetDuration}초 / drift ${(drift * 100).toFixed(1)}%`,
  );
}

function scoreStoryboardActionability(result: StoryboardGenerationResult) {
  const actionableScenes = result.storyboard.scenes.filter((scene) =>
    scene.operatorIntent && scene.hostBeat && scene.captionIdea && scene.productionChecklist.length > 0,
  ).length;
  return criterion(
    'storyboard_actionability',
    58 + ratio(actionableScenes, result.storyboard.scenes.length) * 42,
    `${actionableScenes}/${result.storyboard.scenes.length}개 CUT이 의도/멘트/자막/체크리스트를 포함`,
  );
}

function scoreVisualSpecificity(result: StoryboardGenerationResult) {
  const visualScenes = result.storyboard.scenes.filter((scene) => {
    const text = normalizeText(scene.visualDirection);
    return /손|김|소스|테이블|메뉴|한입|그릇|면|치즈|국물|상차림|소리/.test(text);
  }).length;
  return criterion(
    'visual_specificity',
    50 + ratio(visualScenes, result.storyboard.scenes.length) * 50,
    `${visualScenes}/${result.storyboard.scenes.length}개 CUT이 손/음식/테이블/소리 등 촬영 가능한 비주얼 단서를 포함`,
  );
}

function scoreSafetyFailClosed(result: StoryboardGenerationResult) {
  const localRag = result.backendAnalysis.localRag;
  const providerAudit = auditLocalRagProviders(localRag);
  const sourceTrusted = isTrustedSourceSummary(result);
  const failClosedReported = localRag?.status === 'used' || Boolean(localRag?.providerUnavailableReason);
  let score =
    10 +
    (providerAudit.valid ? 50 : 0) +
    (failClosedReported ? 15 : 0) +
    (sourceTrusted ? 25 : 0);
  if (!providerAudit.valid) score = Math.min(score, 60);
  if (!failClosedReported) score = Math.min(score, 60);
  if (!sourceTrusted) score = Math.min(score, 55);
  return criterion(
    'safety_fail_closed',
    score,
    `${providerAudit.evidence}; failClosedReported=${failClosedReported}; sourceTrusted=${sourceTrusted}; ${describeSourceSummary(result)}`,
  );
}

export function evaluateStoryboardRagExperiment(
  result: StoryboardGenerationResult,
  options: { experimentId?: string } = {},
): StoryboardRagEvaluationReport {
  const criteria = [
    scoreIntentAlignment(result),
    scoreEvidenceGrounding(result),
    scoreRetrievalRelevance(result),
    scoreRerankUsefulness(result),
    scoreDiversityCoverage(result),
    scoreTemporalPacing(result),
    scoreStoryboardActionability(result),
    scoreVisualSpecificity(result),
    scoreSafetyFailClosed(result),
  ];
  const score = criteria.reduce((sum, item) => sum + (item.score * item.weight) / 100, 0);
  const blockers = criteria
    .filter((item) => item.score < 70)
    .map((item) => `${item.label} 기준 ${item.score}/100: ${item.evidence}`);
  const iterationBacklog = blockers.length
    ? blockers.map((blocker) => `다음 RAG 실험에서 개선: ${blocker}`)
    : ['실제 BGE-M3/reranker 수동 smoke에서 동일 루브릭으로 점수 비교'];

  return {
    schemaVersion: 1,
    experimentId: options.experimentId ?? 'storyboard-local-rag-fixture',
    targetScore: 82,
    score: Number(score.toFixed(2)),
    status: score >= 82 && blockers.length === 0 ? 'passed' : 'needs_iteration',
    testMode: 'deterministic_fixtures',
    providerPolicy: 'required_live_model_stack_fail_closed',
    sourceSummary: sourceSummarySnapshot(result),
    criteria,
    blockers,
    iterationBacklog,
  };
}
