import { createClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/integrations/supabase/types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;

type KeyRole = 'anon' | 'service';

type DashboardRestaurantRow = Pick<
    Tables<'restaurants'>,
    | 'id'
    | 'name'
    | 'categories'
    | 'road_address'
    | 'jibun_address'
    | 'origin_address'
    | 'lat'
    | 'lng'
    | 'youtube_link'
    | 'youtube_meta'
    | 'source_type'
    | 'status'
    | 'is_not_selected'
    | 'is_missing'
    | 'geocoding_success'
    | 'geocoding_false_stage'
    | 'evaluation_results'
    | 'updated_at'
    | 'created_at'
>;

type RestaurantCache = {
    expiresAt: number;
    rows: DashboardRestaurantRow[];
} | null;

let restaurantCacheByRole: Record<KeyRole, RestaurantCache> = {
    anon: null,
    service: null,
};

function createSupabaseServerClient(keyRole: KeyRole) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
        throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_URL).');
    }

    if (keyRole === 'service') {
        if (!supabaseServiceRoleKey) {
            throw new Error('Supabase environment variables are missing (SUPABASE_SERVICE_ROLE_KEY).');
        }

        return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
    }

    if (!supabaseAnonKey) {
        throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_ANON_KEY).');
    }

    return createClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

async function fetchRestaurantPage(
    from: number,
    to: number,
    keyRole: KeyRole,
): Promise<DashboardRestaurantRow[]> {
    const supabase = createSupabaseServerClient(keyRole);
    const { data, error } = await supabase
        .from('restaurants')
        .select(`
            id,
            name:approved_name,
            categories,
            road_address,
            jibun_address,
            origin_address,
            lat,
            lng,
            youtube_link,
            youtube_meta,
            source_type,
            status,
            is_not_selected,
            is_missing,
            geocoding_success,
            geocoding_false_stage,
            evaluation_results,
            updated_at,
            created_at
        `)
        .range(from, to);

    if (error) {
        throw new Error(`Failed to fetch restaurants: ${error.message}`);
    }

    return (data as DashboardRestaurantRow[]) || [];
}

export async function getRestaurantRows(
    forceRefresh = false,
    keyRole: KeyRole = 'anon',
): Promise<DashboardRestaurantRow[]> {
    const restaurantCache = restaurantCacheByRole[keyRole];
    if (
        !forceRefresh &&
        restaurantCache &&
        restaurantCache.expiresAt > Date.now()
    ) {
        return restaurantCache.rows;
    }

    const rows: DashboardRestaurantRow[] = [];
    let page = 0;

    while (true) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const chunk = await fetchRestaurantPage(from, to, keyRole);

        rows.push(...chunk);

        if (chunk.length < PAGE_SIZE) {
            break;
        }

        page += 1;
    }

    restaurantCacheByRole[keyRole] = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        rows,
    };

    return rows;
}

export function clearRestaurantRowsCache(keyRole?: KeyRole) {
    if (keyRole) {
        restaurantCacheByRole[keyRole] = null;
        return;
    }

    restaurantCacheByRole = {
        anon: null,
        service: null,
    };
}

export type { DashboardRestaurantRow };
