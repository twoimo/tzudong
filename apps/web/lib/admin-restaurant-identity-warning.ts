import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';

export type RestaurantIdentityWarningSeverity = 'warn' | 'block';

export type RestaurantIdentityWarningRule =
  | 'provider_name_mismatch'
  | 'missing_branch_context'
  | 'contradictory_visit_evidence'
  | 'deleted_same_video_identity';

export interface RestaurantIdentityWarningRow {
  id: string;
  approved_name?: string | null;
  origin_name?: string | null;
  naver_name?: string | null;
  google_name?: string | null;
  name?: string | null;
  restaurant_name?: string | null;
  status?: string | null;
  youtube_link?: string | null;
  reasoning_basis?: string | null;
  evaluation_results?: unknown;
}

export interface RestaurantIdentityWarning {
  rule: RestaurantIdentityWarningRule;
  severity: RestaurantIdentityWarningSeverity;
  title: string;
  message: string;
  evidence: string[];
}

function firstNonEmpty(values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, ' ')
    .replace(/(?:^|\s)(?:구|현|전)(?:\s|$)/g, ' ')
    .replace(/[\s·・ㆍ._\-–—,，()（）\[\]{}<>《》"'`´’‘“”:：]/g, '')
    .trim();
}

function tokenizeName(value: string | null | undefined): string[] {
  return [...new Set(String(value || '')
    .normalize('NFKC')
    .replace(/\(([^)]*)\)|（([^）]*)）/g, ' $1 $2 ')
    .replace(/[·・ㆍ._\-–—,，\[\]{}<>《》"'`´’‘“”:：]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !['구', '현', '전', '내', '본점'].includes(token)))];
}

function stripBranchSuffix(token: string): string {
  return token.replace(/점$/, '').trim();
}

function resolveCandidateName(row: RestaurantIdentityWarningRow, approvedNameOverride?: string | null): string | null {
  return firstNonEmpty([
    approvedNameOverride,
    row.approved_name,
    row.naver_name,
    row.google_name,
    row.restaurant_name,
    row.name,
  ]);
}

function hasNameCompatibility(originName: string, candidateName: string): boolean {
  const origin = normalizeName(originName);
  const candidate = normalizeName(candidateName);
  if (!origin || !candidate) return true;
  if (origin === candidate) return true;
  if (origin.length >= 3 && candidate.includes(origin)) return true;
  if (candidate.length >= 3 && origin.includes(candidate)) return true;

  const originTokens = tokenizeName(originName).map(stripBranchSuffix).map(normalizeName).filter(Boolean);
  const candidateTokens = tokenizeName(candidateName).map(stripBranchSuffix).map(normalizeName).filter(Boolean);
  return originTokens.some((originToken) => (
    candidateTokens.some((candidateToken) => (
      originToken === candidateToken
      || (originToken.length >= 3 && candidateToken.includes(originToken))
      || (candidateToken.length >= 3 && originToken.includes(candidateToken))
    ))
  ));
}

function getMissingBranchTokens(originName: string, candidateName: string): string[] {
  const candidate = normalizeName(candidateName);
  return tokenizeName(originName)
    .filter((token) => /점$/.test(token) || /파크|몰|백화점|시장|역|센터|지하|본점/.test(token))
    .filter((token) => {
      const normalizedToken = normalizeName(stripBranchSuffix(token));
      return normalizedToken.length >= 2 && !candidate.includes(normalizedToken);
    });
}

function getNumericEvalValue(row: RestaurantIdentityWarningRow, key: string): number | null {
  const results = row.evaluation_results && typeof row.evaluation_results === 'object' && !Array.isArray(row.evaluation_results) ? row.evaluation_results as Record<string, unknown> : null;
  const value = results?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const evalValue = (value as { eval_value?: unknown }).eval_value;
  return typeof evalValue === 'number' && Number.isFinite(evalValue) ? evalValue : null;
}

function getLocationMatchEvalValue(row: RestaurantIdentityWarningRow): boolean | null {
  const results = row.evaluation_results && typeof row.evaluation_results === 'object' && !Array.isArray(row.evaluation_results) ? row.evaluation_results as Record<string, unknown> : null;
  const value = results?.location_match_TF;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const evalValue = (value as { eval_value?: unknown }).eval_value;
  return typeof evalValue === 'boolean' ? evalValue : null;
}

function getEvalBasis(row: RestaurantIdentityWarningRow, key: string): string | null {
  const results = row.evaluation_results && typeof row.evaluation_results === 'object' && !Array.isArray(row.evaluation_results) ? row.evaluation_results as Record<string, unknown> : null;
  const value = results?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const basis = (value as { eval_basis?: unknown }).eval_basis;
  return typeof basis === 'string' && basis.trim() ? basis.trim() : null;
}

function isSameVideoSameOriginDeleted(target: RestaurantIdentityWarningRow, related: RestaurantIdentityWarningRow): boolean {
  if (related.id === target.id || related.status !== 'deleted') return false;
  const targetVideoId = extractVideoIdFromYoutubeLink(target.youtube_link || '');
  const relatedVideoId = extractVideoIdFromYoutubeLink(related.youtube_link || '');
  if (!targetVideoId || targetVideoId !== relatedVideoId) return false;

  const targetOrigin = normalizeName(target.origin_name || '');
  const relatedOrigin = normalizeName(related.origin_name || '');
  if (targetOrigin && relatedOrigin && targetOrigin === relatedOrigin) return true;

  const targetCandidate = normalizeName(resolveCandidateName(target) || '');
  const relatedCandidate = normalizeName(resolveCandidateName(related) || '');
  return Boolean(targetCandidate && relatedCandidate && targetCandidate === relatedCandidate);
}

export function findRestaurantIdentityWarnings(
  target: RestaurantIdentityWarningRow,
  relatedRows: RestaurantIdentityWarningRow[] = [],
  options: { approvedNameOverride?: string | null } = {},
): RestaurantIdentityWarning[] {
  if (target.status === 'deleted') return [];

  const warnings: RestaurantIdentityWarning[] = [];
  const originName = firstNonEmpty([target.origin_name]);
  const candidateName = resolveCandidateName(target, options.approvedNameOverride);
  const locationMatched = getLocationMatchEvalValue(target) === true;
  const visitAuthenticity = getNumericEvalValue(target, 'visit_authenticity');
  const inferenceScore = getNumericEvalValue(target, 'rb_inference_score');
  const candidateCompatible = Boolean(originName && candidateName && hasNameCompatibility(originName, candidateName));

  if (originName && candidateName && !candidateCompatible) {
    const severity: RestaurantIdentityWarningSeverity = locationMatched ? 'block' : 'warn';
    warnings.push({
      rule: 'provider_name_mismatch',
      severity,
      title: locationMatched ? '주소만 맞고 상호명이 다른 후보입니다' : '영상 언급명과 지도 후보명이 다릅니다',
      message: `영상 근거의 원본명은 “${originName}”인데 현재 승인 후보명은 “${candidateName}”입니다. 주소가 같아도 다른 상호를 자동 승인하지 말고 원본 장소명으로 수정하거나 다시 확인하세요.`,
      evidence: [`origin=${originName}`, `candidate=${candidateName}`, `locationMatched=${locationMatched}`],
    });
  }

  if (originName && candidateName && candidateCompatible) {
    const missingBranchTokens = getMissingBranchTokens(originName, candidateName);
    if (missingBranchTokens.length > 0) {
      warnings.push({
        rule: 'missing_branch_context',
        severity: 'warn',
        title: '지점/장소 맥락이 후보명에서 빠졌습니다',
        message: `원본명 “${originName}”의 ${missingBranchTokens.join(', ')} 맥락이 후보명 “${candidateName}”에 없습니다. 폐업·이전·동명 지점 가능성을 확인하세요.`,
        evidence: missingBranchTokens.map((token) => `missing=${token}`),
      });
    }
  }

  if (locationMatched && (visitAuthenticity === 0 || inferenceScore === 0) && !candidateCompatible) {
    const evidence = [
      visitAuthenticity === 0 ? getEvalBasis(target, 'visit_authenticity') : null,
      inferenceScore === 0 ? getEvalBasis(target, 'rb_inference_score') : null,
    ].filter((value): value is string => Boolean(value));
    warnings.push({
      rule: 'contradictory_visit_evidence',
      severity: 'block',
      title: '평가 근거가 현재 후보를 부정합니다',
      message: '위치 매칭은 통과했지만 방문/추론 평가가 현재 지도 후보를 부정합니다. 승인 전에 이름과 장소 후보를 다시 잡아야 합니다.',
      evidence: evidence.length > 0 ? evidence : ['visit_authenticity/rb_inference_score failed'],
    });
  }

  const deletedMatches = relatedRows.filter((row) => isSameVideoSameOriginDeleted(target, row));
  if (deletedMatches.length > 0) {
    warnings.push({
      rule: 'deleted_same_video_identity',
      severity: 'warn',
      title: '관리자가 이미 삭제한 같은 영상/같은 장소 후보입니다',
      message: `같은 영상에서 같은 원본명 또는 같은 후보명이 삭제된 이력이 ${deletedMatches.length}건 있습니다. 재수집으로 되살아난 오매칭인지 확인하세요.`,
      evidence: deletedMatches.slice(0, 3).map((row) => `${row.id}:${row.origin_name || resolveCandidateName(row) || '이름 없음'}`),
    });
  }

  const unique = new Map<string, RestaurantIdentityWarning>();
  for (const warning of warnings) {
    unique.set(warning.rule, warning);
  }
  return [...unique.values()].sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'block' ? -1 : 1));
}

export function hasBlockingRestaurantIdentityWarning(warnings: RestaurantIdentityWarning[]): boolean {
  return warnings.some((warning) => warning.severity === 'block');
}

export function formatRestaurantIdentityWarning(warnings: RestaurantIdentityWarning[]): string {
  if (warnings.length === 0) return '';
  const blockingCount = warnings.filter((warning) => warning.severity === 'block').length;
  const first = warnings[0];
  const prefix = blockingCount > 0 ? `승인 차단 ${blockingCount}건` : `확인 필요 ${warnings.length}건`;
  return `${prefix}: ${first.message}`;
}
