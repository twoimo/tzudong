import type { RestaurantRecordChanges } from './admin/record-action-contract';

export type SponsorshipAnalysis = {
    status: string;
    outcome?: string;
    source?: string;
    version?: string | null;
    reason?: string;
    source_sha256?: string | null;
    retained_previous?: boolean;
    retained_version?: string | null;
    retained_source_sha256?: string | null;
};
export type SponsorshipInfo<Names = string | string[] | null> = {
    is_ads: boolean | null;
    what_ads: Names;
    sponsor_analysis?: SponsorshipAnalysis;
};
const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/** Preserve base metadata even when the independent sponsorship supplement is absent. */
export function normalizeSponsorshipInfo(value: unknown): SponsorshipInfo {
    const ads = record(value) ? value : {};
    const names = ads.what_ads;
    const result: SponsorshipInfo = {
        is_ads: typeof ads.is_ads === 'boolean' ? ads.is_ads : null,
        what_ads: typeof names === 'string' || (Array.isArray(names) && names.every((name) => typeof name === 'string')) ? names : null,
    };
    if (Object.hasOwn(ads, 'sponsor_analysis')) {
        const analysis = record(ads.sponsor_analysis) ? ads.sponsor_analysis : {};
        result.sponsor_analysis = { status: typeof analysis.status === 'string' ? analysis.status : 'unknown' };
        for (const key of ['outcome', 'source', 'version', 'reason', 'source_sha256', 'retained_version', 'retained_source_sha256'] as const) {
            if (typeof analysis[key] === 'string' && analysis[key].length <= 160) result.sponsor_analysis[key] = analysis[key];
        }
        if (analysis.retained_previous === true) result.sponsor_analysis.retained_previous = true;
        if (Object.hasOwn(analysis, 'retained_previous') && typeof analysis.retained_previous !== 'boolean') {
            result.sponsor_analysis.status = 'unknown';
        }
    }
    if (names !== undefined && names !== null && typeof names !== 'string' &&
        !(Array.isArray(names) && names.every((name) => typeof name === 'string'))) {
        result.sponsor_analysis = { ...result.sponsor_analysis, status: 'unknown', outcome: 'unknown' };
    }
    return result;
}

function sponsorNames(ads: SponsorshipInfo): string[] {
    return (typeof ads.what_ads === 'string' ? [ads.what_ads] : ads.what_ads ?? []).filter((name) => name.trim());
}

export function sponsorshipState(value: unknown): 'detected' | 'confirmed_none' | 'unknown' {
    const ads = normalizeSponsorshipInfo(value);
    const analysis = ads.sponsor_analysis;
    if (analysis && (analysis.status !== 'completed' || analysis.retained_previous ||
        (analysis.outcome !== 'detected' && analysis.outcome !== 'confirmed_none'))) return 'unknown';
    if (ads.is_ads === false && sponsorNames(ads).length === 0 && (!analysis || analysis.outcome === 'confirmed_none')) return 'confirmed_none';
    if (ads.is_ads === true && (!analysis || (analysis.outcome === 'detected' && sponsorNames(ads).length > 0))) return 'detected';
    return 'unknown';
}

export function sponsorshipLabel(value: unknown): string {
    const ads = normalizeSponsorshipInfo(value);
    const state = sponsorshipState(ads);
    if (state === 'unknown') return ads.sponsor_analysis?.retained_previous
        ? '광고 미확인 (기존 판정 유지)' : '광고 미확인';
    if (state === 'confirmed_none') return '광고 아님';
    const names = sponsorNames(ads);
    return names.length ? `광고 (${names.join(', ')})` : '광고 (회사 미확인)';
}

/** Omission is essential: null/[] would clear an existing confirmed attribution. */
export function confirmedSponsorshipChanges(value: unknown): Pick<NonNullable<RestaurantRecordChanges['youtube_meta']>, 'is_ads' | 'what_ads'> {
    const ads = normalizeSponsorshipInfo(value);
    const state = sponsorshipState(ads);
    if (state === 'unknown') return {};
    if (state === 'confirmed_none') return { is_ads: false, what_ads: null };
    const names = sponsorNames(ads);
    return { is_ads: true, ...(names.length ? { what_ads: names } : {}) };
}

/** Only the existing allowlisted guarded DTO; never send provenance as mutation fields. */
export function youtubeMetadataChanges(value: unknown): RestaurantRecordChanges['youtube_meta'] {
    if (!record(value)) return undefined;
    const published = value.published_at ?? value.publishedAt;
    return {
        ...(typeof value.title === 'string' ? { title: value.title } : {}),
        ...(typeof published === 'string' ? { published_at: published } : {}),
        ...(typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 ? { duration: value.duration } : {}),
        ...(typeof value.is_shorts === 'boolean' ? { is_shorts: value.is_shorts } : {}),
        ...confirmedSponsorshipChanges(record(value.ads_info) ? value.ads_info : value),
    };
}

/** Called only for an explicit human choice; fetched metadata never opts into it. */
export function manualSponsorshipChanges(
    decision: 'detected' | 'confirmed_none', companyLines = '',
): RestaurantRecordChanges['youtube_meta'] | null {
    if (decision === 'confirmed_none') return { sponsorship_confirmation: decision, is_ads: false, what_ads: null };
    const names = companyLines.split(/\r?\n/u).map(name => name.trim()).filter(Boolean);
    if (!names.length || names.length > 20 || names.some(name => name.length > 4000)) return null;
    return { sponsorship_confirmation: decision, is_ads: true, what_ads: names };
}
