import publication from './public-popularity-publication.json';
import type { Restaurant } from '@/types/restaurant';

export type PublishedPopularityTier = 'fire' | 'ember' | 'rainbow' | 'standard';
export type PublishedPopularityLookup = (restaurantId: string) => PublishedPopularityTier;
export interface PublicPopularityPublication {
    readonly schemaVersion: 2;
    readonly publicationVersion: string;
    readonly sourceRevision: string | null;
    readonly entries: readonly Readonly<{ restaurantId: string; memberRestaurantIds: readonly string[]; tier: PublishedPopularityTier }>[];
}

const MAX_PUBLICATIONS = 5000;
const MAX_PUBLICATION_BYTES = 512 * 1024;
const fail = (): never => { throw new Error('PUBLIC_POPULARITY_PUBLICATION_INVALID'); };

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

// Shape validation is not an operator approval receipt. The source is deliberately
// empty until an operator-reviewed cohort is published through protected Git.
// Never populate it automatically from the private metrics or shadow tables.
export function parsePublicPopularityPublication(value: unknown): PublicPopularityPublication {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const data = value as Record<string, unknown>;
    if (!exactKeys(data, ['schemaVersion', 'publicationVersion', 'sourceRevision', 'entries'])
        || data.schemaVersion !== 2
        || typeof data.publicationVersion !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(data.publicationVersion)
        || (data.sourceRevision !== null && (typeof data.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(data.sourceRevision)))
        || !Array.isArray(data.entries) || data.entries.length > MAX_PUBLICATIONS) return fail();
    if (data.entries.length > 0 && (data.publicationVersion === 'unpublished' || data.sourceRevision === null)) return fail();
    const seen = new Set<string>();
    const entries = data.entries.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail();
        const row = entry as Record<string, unknown>;
        if (!exactKeys(row, ['restaurantId', 'memberRestaurantIds', 'tier'])
            || typeof row.restaurantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.restaurantId)
            || typeof row.tier !== 'string' || !['fire', 'ember', 'rainbow', 'standard'].includes(row.tier)
            || !Array.isArray(row.memberRestaurantIds) || !row.memberRestaurantIds.length
            || row.memberRestaurantIds.length > MAX_PUBLICATIONS) return fail();
        const members: string[] = [];
        for (const member of row.memberRestaurantIds) {
            if (typeof member !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(member)
                || seen.has(member) || (members.length > 0 && members[members.length - 1] >= member)
                || seen.size >= MAX_PUBLICATIONS) return fail();
            members.push(member);
            seen.add(member);
        }
        // Explicit reviewed membership binds the grade, not whichever video row
        // the compact/full projection selects as its display representative.
        if (members[0] !== row.restaurantId) return fail();
        return Object.freeze({ restaurantId: row.restaurantId,
            memberRestaurantIds: Object.freeze(members), tier: row.tier as PublishedPopularityTier });
    });
    const result = { schemaVersion: 2 as const, publicationVersion: data.publicationVersion,
        sourceRevision: data.sourceRevision as string | null, entries: Object.freeze(entries) };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_PUBLICATION_BYTES) return fail();
    return Object.freeze(result);
}

function lookupFor(publication: PublicPopularityPublication): PublishedPopularityLookup {
    const tiers = new Map<string, PublishedPopularityTier>();
    for (const entry of publication.entries) {
        for (const member of entry.memberRestaurantIds) tiers.set(member, entry.tier);
    }
    return (restaurantId) => tiers.get(restaurantId) ?? 'standard';
}

export function createPublishedPopularityLookup(value: unknown): PublishedPopularityLookup {
    return lookupFor(parsePublicPopularityPublication(value));
}

export const publicPopularityPublication = parsePublicPopularityPublication(publication);
export const lookupPublishedPopularityTier = lookupFor(publicPopularityPublication);

export function resolvePublishedPopularityTier(
    restaurant: { id: string; mergedRestaurants?: readonly { id: string }[] | null },
    lookup: PublishedPopularityLookup = lookupPublishedPopularityTier,
    members = restaurant.mergedRestaurants,
): PublishedPopularityTier {
    if (lookup === lookupPublishedPopularityTier && publicPopularityPublication.entries.length === 0) return 'standard';
    const tier = lookup(restaurant.id);
    // A new/unpublished member or conflicting publication invalidates the group
    // display. Never choose the highest grade or trust the display representative.
    for (const member of members ?? []) {
        if (lookup(member.id) !== tier) return 'standard';
    }
    return tier;
}

export function projectPublishedPopularityTier(
    restaurant: Restaurant,
    lookup: PublishedPopularityLookup = lookupPublishedPopularityTier,
): Restaurant {
    const tier = resolvePublishedPopularityTier(restaurant, lookup);
    return restaurant.popularity_tier === tier ? restaurant : { ...restaurant, popularity_tier: tier };
}
