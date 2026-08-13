const SUPABASE_REST_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

type SupabaseRestQuery = Array<[string, string | number | boolean]>;

type SupabaseRestRpcResponse = Readonly<{
    data: unknown;
    error: null | Readonly<{ status: number }>;
}>;

function assertSupabaseRestConfig() {
    if (!SUPABASE_REST_URL || !SUPABASE_PUBLIC_KEY) {
        throw new Error('Supabase REST client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }
}

export function postgrestIn(values: readonly string[]) {
    return `in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(',')})`;
}

export function postgrestArrayOverlap(values: readonly string[]) {
    return `ov.{${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(',')}}`;
}

export async function fetchSupabaseRows<T>(table: string, query: SupabaseRestQuery): Promise<T[]> {
    assertSupabaseRestConfig();

    const url = new URL(`${SUPABASE_REST_URL}/rest/v1/${table}`);
    for (const [key, value] of query) {
        url.searchParams.append(key, String(value));
    }

    const response = await fetch(url.toString(), {
        headers: {
            apikey: SUPABASE_PUBLIC_KEY!,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Supabase REST ${table} failed: ${response.status} ${body}`.trim());
    }

    return response.json() as Promise<T[]>;
}

export const supabaseRestRpcClient = {
    async rpc(
        functionName: string,
        args: Readonly<Record<string, unknown>>,
    ): Promise<SupabaseRestRpcResponse> {
        assertSupabaseRestConfig();

        const url = new URL(
            `${SUPABASE_REST_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
        );
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                apikey: SUPABASE_PUBLIC_KEY!,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(args),
        });

        if (!response.ok) {
            return { data: null, error: { status: response.status } };
        }

        const data: unknown = await response.json().catch(() => null);
        return { data, error: null };
    },
};

export async function fetchSupabaseExactCount(table: string, query: SupabaseRestQuery): Promise<number> {
    assertSupabaseRestConfig();

    const url = new URL(`${SUPABASE_REST_URL}/rest/v1/${table}`);
    for (const [key, value] of query) {
        url.searchParams.append(key, String(value));
    }

    const response = await fetch(url.toString(), {
        method: 'HEAD',
        headers: {
            apikey: SUPABASE_PUBLIC_KEY!,
            Prefer: 'count=exact',
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Supabase REST ${table} count failed: ${response.status} ${body}`.trim());
    }

    const range = response.headers.get('content-range');
    const total = range?.split('/').at(1);
    const count = total ? Number(total) : NaN;
    if (!Number.isFinite(count)) {
        throw new Error(`Supabase REST ${table} count missing content-range.`);
    }

    return count;
}
