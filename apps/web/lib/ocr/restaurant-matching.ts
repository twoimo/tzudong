export type OcrRestaurantMatchLevel = 'high' | 'medium' | 'low';
export type OcrRestaurantMatchSource = 'selected_restaurant' | 'exact_name' | 'normalized_token' | 'address_context';

export type SelectedRestaurantContext = {
  id?: string | null;
  name?: string | null;
  road_address?: string | null;
  jibun_address?: string | null;
  category?: string | null;
};

export type RestaurantMatchRow = {
  id: string;
  name: string;
  road_address?: string | null;
  jibun_address?: string | null;
};

export type OcrRestaurantMatchCandidate = RestaurantMatchRow & {
  score: number;
  level: OcrRestaurantMatchLevel;
  reason: string;
  source: OcrRestaurantMatchSource;
};

export type OcrRestaurantLookupStats = {
  lookupCount: number;
  lookupLimit: number;
  stoppedByBudget: boolean;
};

export type OcrRestaurantMatchResult = {
  candidates: OcrRestaurantMatchCandidate[];
  stats: OcrRestaurantLookupStats;
};

const DEFAULT_LOOKUP_LIMIT = 3;

export function normalizeOcrRestaurantName(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/본점|지점|분점|직영점/g, '')
    .replace(/[^0-9a-zA-Z가-힣]/g, '')
    .toLowerCase();
}



const KOREAN_RECEIPT_OCR_CONFUSIONS: Array<[RegExp, string]> = [
  // OCR often fuses/warps Korean syllables in small receipt fonts. Keep this
  // inside candidate scoring only; never rewrite the user-visible raw OCR text.
  [/쭈발/g, '밥'],
  [/취아/g, '천안'],
  [/런/g, '린'],
];

function normalizeOcrRestaurantNameVariants(value: string | null | undefined): string[] {
  const base = normalizeOcrRestaurantName(value);
  if (!base) return [];
  const variants = new Set([base]);
  let corrected = base;
  for (const [pattern, replacement] of KOREAN_RECEIPT_OCR_CONFUSIONS) {
    corrected = corrected.replace(pattern, replacement);
    variants.add(corrected);
  }
  return [...variants];
}

function scoreNormalizedRestaurantNamePair(restaurant: string, receipt: string): number {
  if (!restaurant || !receipt) return 0;
  if (restaurant === receipt) return 100;
  if (restaurant.includes(receipt) || receipt.includes(restaurant)) return 92;
  const distance = levenshtein(restaurant, receipt);
  const maxLength = Math.max(restaurant.length, receipt.length);
  const similarity = maxLength ? 1 - distance / maxLength : 0;
  if (similarity >= 0.84) return Math.round(similarity * 100);
  return 0;
}

export function normalizeOcrRestaurantAddress(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/지하\s*\d+\s*층/g, '')
    .replace(/지상\s*\d+\s*층/g, '')
    .replace(/\d+\s*층/g, '')
    .replace(/\d+\s*호/g, '')
    .replace(/[^0-9a-zA-Z가-힣]/g, '')
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function scoreOcrRestaurantNameMatch(restaurantName: string, receiptName: string): number {
  const restaurantVariants = normalizeOcrRestaurantNameVariants(restaurantName);
  const receiptVariants = normalizeOcrRestaurantNameVariants(receiptName);
  if (!restaurantVariants.length || !receiptVariants.length) return 0;

  let bestScore = 0;
  for (const restaurant of restaurantVariants) {
    for (const receipt of receiptVariants) {
      bestScore = Math.max(bestScore, scoreNormalizedRestaurantNamePair(restaurant, receipt));
    }
  }
  if (bestScore > 0) return bestScore;

  const restaurant = restaurantVariants[0];
  const tokens = buildOcrRestaurantSearchTokens(receiptName);
  return tokens.reduce((score, token) => {
    const normalizedToken = normalizeOcrRestaurantNameVariants(token)[0];
    if (normalizedToken && restaurant.includes(normalizedToken)) {
      return Math.max(score, 45 + Math.min(normalizedToken.length * 5, 35));
    }
    return score;
  }, 0);
}

export function buildOcrRestaurantSearchTokens(value: string): string[] {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];
  const spacedTokens = normalized.split(' ').map((token) => token.trim()).filter((token) => token.length >= 2);
  const compact = normalizeOcrRestaurantName(normalized);
  const prefixTokens = compact.length >= 4 ? [compact.slice(0, Math.min(5, compact.length))] : [];
  return Array.from(new Set([normalized, ...spacedTokens, ...prefixTokens])).sort((a, b) => b.length - a.length).slice(0, 3);
}

function levelForScore(score: number, source: OcrRestaurantMatchSource): OcrRestaurantMatchLevel {
  if (source === 'selected_restaurant' && score >= 84) return 'high';
  if (source === 'exact_name' && score >= 95) return 'high';
  if (score >= 90 && source === 'address_context') return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

function reasonForCandidate(input: { score: number; source: OcrRestaurantMatchSource; receiptName: string; row: RestaurantMatchRow }): string {
  if (input.source === 'selected_restaurant') return '선택된 맛집과 영수증 상호가 강하게 일치합니다.';
  if (input.source === 'exact_name') return 'DB 승인 상호와 영수증 상호가 정확히 일치합니다.';
  if (input.source === 'address_context') return '주소 문맥과 상호가 함께 일치합니다.';
  return `영수증 상호 '${input.receiptName}'와 DB 상호 '${input.row.name}'의 유사도가 ${input.score}점입니다.`;
}

function toCandidate(row: RestaurantMatchRow, source: OcrRestaurantMatchSource, receiptName: string): OcrRestaurantMatchCandidate {
  const score = source === 'exact_name' && normalizeOcrRestaurantName(row.name) === normalizeOcrRestaurantName(receiptName)
    ? 100
    : scoreOcrRestaurantNameMatch(row.name, receiptName);
  return {
    ...row,
    score,
    source,
    level: levelForScore(score, source),
    reason: reasonForCandidate({ score, source, receiptName, row }),
  };
}

function mergeCandidates(candidates: OcrRestaurantMatchCandidate[]): OcrRestaurantMatchCandidate[] {
  const byId = new Map<string, OcrRestaurantMatchCandidate>();
  for (const candidate of candidates) {
    const prev = byId.get(candidate.id);
    if (!prev || candidate.score > prev.score || (candidate.score === prev.score && candidate.level === 'high')) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

function hasUsableCandidate(candidates: OcrRestaurantMatchCandidate[]): boolean {
  return candidates.some((candidate) => candidate.level === 'high' || candidate.level === 'medium');
}

export async function findOcrRestaurantMatches(input: {
  receiptStoreName?: string | null;
  selectedRestaurant?: SelectedRestaurantContext | null;
  lookupBySelectedId?: (id: string) => Promise<RestaurantMatchRow | null>;
  lookupExactName?: (name: string) => Promise<RestaurantMatchRow[]>;
  lookupFuzzyToken?: (token: string) => Promise<RestaurantMatchRow[]>;
  maxLookups?: number;
}): Promise<OcrRestaurantMatchResult> {
  const receiptName = input.receiptStoreName?.trim();
  const lookupLimit = input.maxLookups ?? DEFAULT_LOOKUP_LIMIT;
  let lookupCount = 0;
  let stoppedByBudget = false;
  const candidates: OcrRestaurantMatchCandidate[] = [];

  const canLookup = () => lookupCount < lookupLimit;
  const spend = () => {
    if (!canLookup()) {
      stoppedByBudget = true;
      return false;
    }
    lookupCount += 1;
    return true;
  };

  if (!receiptName) {
    return { candidates: [], stats: { lookupCount, lookupLimit, stoppedByBudget } };
  }

  if (input.selectedRestaurant?.id && input.lookupBySelectedId && spend()) {
    const selected = await input.lookupBySelectedId(input.selectedRestaurant.id);
    if (selected) {
      candidates.push(toCandidate(selected, 'selected_restaurant', receiptName));
      if (candidates.some((candidate) => candidate.source === 'selected_restaurant' && candidate.level === 'high')) {
        return { candidates: mergeCandidates(candidates), stats: { lookupCount, lookupLimit, stoppedByBudget } };
      }
    }
  } else if (input.selectedRestaurant?.id && input.selectedRestaurant.name) {
    candidates.push(toCandidate({
      id: input.selectedRestaurant.id,
      name: input.selectedRestaurant.name,
      road_address: input.selectedRestaurant.road_address,
      jibun_address: input.selectedRestaurant.jibun_address,
    }, 'selected_restaurant', receiptName));
  }

  if (input.lookupExactName && canLookup()) {
    if (spend()) {
      const rows = await input.lookupExactName(receiptName);
      candidates.push(...rows.map((row) => toCandidate(row, 'exact_name', receiptName)));
      if (candidates.some((candidate) => candidate.source === 'exact_name' && candidate.level === 'high')) {
        return { candidates: mergeCandidates(candidates), stats: { lookupCount, lookupLimit, stoppedByBudget } };
      }
    }
  }

  const tokens = buildOcrRestaurantSearchTokens(receiptName)
    .filter((token) => normalizeOcrRestaurantName(token) !== normalizeOcrRestaurantName(receiptName))
    .slice(0, 2);

  for (const token of tokens) {
    if (!input.lookupFuzzyToken || !canLookup() || hasUsableCandidate(candidates)) break;
    if (!spend()) break;
    const rows = await input.lookupFuzzyToken(token);
    candidates.push(...rows.map((row) => toCandidate(row, 'normalized_token', receiptName)));
  }

  if (!canLookup() && tokens.length > 0) stoppedByBudget = true;
  return { candidates: mergeCandidates(candidates), stats: { lookupCount, lookupLimit, stoppedByBudget } };
}
