import type { EvaluationResult, LocationMatchResult } from '@/types/evaluation';

type EvaluationNameSource = {
  approved_name?: string | null;
  restaurant_name?: string | null;
  name?: string | null;
  origin_name?: string | null;
  naver_name?: string | null;
  evaluation_results?: EvaluationResult | Record<string, unknown> | null;
};

function firstNonEmptyString(values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}


function normalizeComparableName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, ' ')
    .replace(/(?:^|\s)(?:구|현|전)(?:\s|$)/g, ' ')
    .replace(/[\s·・ㆍ._\-–—,，()（）\[\]{}<>《》"'`´’‘“”:：]/g, '')
    .trim();
}

function tokenizeComparableName(value: string | null | undefined): string[] {
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

function hasNameCompatibility(originName: string | null | undefined, candidateName: string | null | undefined): boolean {
  const origin = normalizeComparableName(originName);
  const candidate = normalizeComparableName(candidateName);
  if (!origin || !candidate) return true;
  if (origin === candidate) return true;
  if (origin.length >= 3 && candidate.includes(origin)) return true;
  if (candidate.length >= 3 && origin.includes(candidate)) return true;

  const originTokens = tokenizeComparableName(originName).map(stripBranchSuffix).map(normalizeComparableName).filter(Boolean);
  const candidateTokens = tokenizeComparableName(candidateName).map(stripBranchSuffix).map(normalizeComparableName).filter(Boolean);
  return originTokens.some((originToken) => candidateTokens.some((candidateToken) => (
    originToken === candidateToken
    || (originToken.length >= 3 && candidateToken.includes(originToken))
    || (candidateToken.length >= 3 && originToken.includes(candidateToken))
  )));
}

function getLocationMatchResult(evaluationResults: EvaluationNameSource['evaluation_results']): LocationMatchResult | null {
  if (!evaluationResults || typeof evaluationResults !== 'object' || Array.isArray(evaluationResults)) {
    return null;
  }

  const locationMatch = (evaluationResults as { location_match_TF?: unknown }).location_match_TF;
  if (!locationMatch || typeof locationMatch !== 'object' || Array.isArray(locationMatch)) {
    return null;
  }

  return locationMatch as LocationMatchResult;
}

export function getRuleBasedPassedNaverName(source: EvaluationNameSource): string | null {
  const locationMatch = getLocationMatchResult(source.evaluation_results);
  const isRuleBasedPassed = locationMatch?.eval_value === true || locationMatch?.match_status === 'matched';

  if (!isRuleBasedPassed) {
    return null;
  }

  const candidateNames = [
    source.naver_name,
    locationMatch?.naver_name,
    locationMatch?.matched_provider === 'naver' ? locationMatch?.matched_name : null,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return candidateNames.find((candidateName) => hasNameCompatibility(source.origin_name, candidateName))?.trim() || null;
}

export function getAdminEvaluationDisplayName(source: EvaluationNameSource): string {
  return (
    firstNonEmptyString([
      source.approved_name,
      getRuleBasedPassedNaverName(source),
      source.restaurant_name,
      source.name,
      source.origin_name,
    ]) || '이름 없음'
  );
}


export function getAdminEvaluationApprovalName(source: EvaluationNameSource): string {
  return getAdminEvaluationDisplayName(source);
}

export function hasAdminEvaluationYoutubeTitle(source: {
  youtube_meta?: { title?: string | null } | null;
}): boolean {
  return firstNonEmptyString([source.youtube_meta?.title]) !== null;
}

export function getAdminEvaluationVideoLabel(source: EvaluationNameSource & {
  youtube_meta?: { title?: string | null } | null;
  youtube_link?: string | null;
}): string {
  const title = firstNonEmptyString([source.youtube_meta?.title]);
  if (title) return title;
  const restaurantName = getAdminEvaluationDisplayName(source);
  if (restaurantName !== '이름 없음') return restaurantName;
  return '영상 제목 없음';
}

export function matchesAdminEvaluationSearch(
  source: EvaluationNameSource & {
    youtube_meta?: { title?: string | null } | null;
    youtube_link?: string | null;
  },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystacks = [
    getAdminEvaluationVideoLabel(source),
    getAdminEvaluationDisplayName(source),
    source.origin_name,
    source.approved_name,
    source.restaurant_name,
    source.name,
    source.naver_name,
    source.youtube_meta?.title,
    source.youtube_link,
  ];

  return haystacks.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
}
