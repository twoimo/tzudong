type SupabaseRestQuery = Array<[string, string | number | boolean]>;

type SupabaseRestRpcResponse = Readonly<{
    data: unknown;
    error: null | Readonly<{ status: number }>;
}>;

function readSupabaseRestConfig(): { url: string; key: string } {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
    if (!url || !key) {
        throw new Error('supabase_rest_config_missing');
    }
    let endpoint: URL;
    try {
        endpoint = new URL(url);
    } catch {
        throw new Error('supabase_rest_config_invalid');
    }
    if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
        throw new Error('supabase_rest_config_invalid');
    }
    return { url, key };
}

export function supabaseRestFailureCode(kind: 'rows' | 'count' | 'rpc', status: number): string {
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
    return kind === 'rows'
        ? `supabase_rest_rows_failed:${safeStatus}`
        : kind === 'rpc'
            ? `supabase_rest_rpc_failed:${safeStatus}`
            : `supabase_rest_count_failed:${safeStatus}`;
}

export class SupabaseRestRowsError extends Error {
    constructor(readonly status: number, readonly code?: 'PGRST200') {
        super(supabaseRestFailureCode('rows', status));
    }
}

async function discardResponseBody(response: Response) {
    try {
        await response.body?.cancel();
    } catch {
        // The status code is the trace. Body text stays out of logs and errors.
    }
}

async function readMissingRelationCode(response: Response): Promise<'PGRST200' | undefined> {
    if (response.status !== 400) {
        await discardResponseBody(response);
        return undefined;
    }

    // Read actual bytes, not Content-Length. Retain only the recovery code;
    // provider message/details/hint and row payloads never enter the error.
    const maxBytes = 8192;
    const maxReadMs = 250;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
        reader = response.body?.getReader();
        if (!reader) return undefined;
        const bodyReader = reader;
        const deadlineAt = Date.now() + maxReadMs;
        const deadline = new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
                expired = true;
                resolve(undefined);
            }, maxReadMs);
        });
        const readCode = async (): Promise<'PGRST200' | undefined> => {
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let bytes = 0;
            let text = '';
            for (;;) {
                const { done, value } = await bodyReader.read();
                if (expired || Date.now() >= deadlineAt) return undefined;
                if (done) break;
                bytes += value.byteLength;
                if (bytes > maxBytes) return undefined;
                text += decoder.decode(value, { stream: true });
            }
            const body: unknown = JSON.parse(text + decoder.decode());
            if (body && typeof body === 'object' && !Array.isArray(body)
                && (body as { code?: unknown }).code === 'PGRST200') {
                return 'PGRST200';
            }
            return undefined;
        };
        return await Promise.race([readCode(), deadline]);
    } catch {
        // Unreadable/malformed errors keep the original fixed HTTP failure.
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        try {
            // Cleanup must not wait for a stalled/rejecting transport either.
            void reader?.cancel().catch(() => {});
        } catch {
            // Cleanup diagnostics are also untrusted.
        }
        try {
            reader?.releaseLock();
        } catch {
            // A release failure must not replace the fixed HTTP error.
        }
    }
    return undefined;
}

export function postgrestIn(values: readonly string[]) {
    return `in.(${values.map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}

export function postgrestArrayOverlap(values: readonly string[]) {
    return `ov.{${values.map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

export async function fetchSupabaseRows<T>(table: string, query: SupabaseRestQuery): Promise<T[]> {
    const config = readSupabaseRestConfig();

    const url = new URL(`${config.url}/rest/v1/${table}`);
    for (const [key, value] of query) {
        url.searchParams.append(key, String(value));
    }

    let response: Response;
    try {
        response = await fetch(url.toString(), {
            headers: {
                apikey: config.key,
                Authorization: `Bearer ${config.key}`,
            },
        });
    } catch {
        throw new Error(supabaseRestFailureCode('rows', 0));
    }

    if (!response.ok) {
        if (
            (table === 'announcements' || table === 'ad_banners')
            && (response.status === 401 || response.status === 403)
        ) {
            await discardResponseBody(response);
            return [];
        }
        const code = await readMissingRelationCode(response);
        throw new SupabaseRestRowsError(response.status, code);
    }

    try {
        return await response.json() as T[];
    } catch {
        throw new Error(supabaseRestFailureCode('rows', 0));
    }
}

export const supabaseRestRpcClient = {
    async rpc(
        functionName: string,
        args: Readonly<Record<string, unknown>>,
    ): Promise<SupabaseRestRpcResponse> {
        const config = readSupabaseRestConfig();

        const url = new URL(
            `${config.url}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
        );
        let response: Response;
        try {
            response = await fetch(url.toString(), {
                method: 'POST',
                headers: {
                    apikey: config.key,
                    Authorization: `Bearer ${config.key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(args),
            });
        } catch {
            throw new Error(supabaseRestFailureCode('rpc', 0));
        }

        if (!response.ok) {
            await discardResponseBody(response);
            return { data: null, error: { status: response.status } };
        }

        const data: unknown = await response.json().catch(() => null);
        return { data, error: null };
    },
};

export async function fetchSupabaseExactCount(table: string, query: SupabaseRestQuery): Promise<number> {
    const config = readSupabaseRestConfig();

    const url = new URL(`${config.url}/rest/v1/${table}`);
    for (const [key, value] of query) {
        url.searchParams.append(key, String(value));
    }

    let response: Response;
    try {
        response = await fetch(url.toString(), {
            method: 'HEAD',
            headers: {
                apikey: config.key,
                Authorization: `Bearer ${config.key}`,
                Prefer: 'count=exact',
            },
        });
    } catch {
        throw new Error(supabaseRestFailureCode('count', 0));
    }

    if (!response.ok) {
        await discardResponseBody(response);
        throw new Error(supabaseRestFailureCode('count', response.status));
    }

    const range = response.headers.get('content-range');
    const total = range?.split('/').at(1);
    const count = total ? Number(total) : NaN;
    if (!Number.isFinite(count)) {
        throw new Error('supabase_rest_count_missing');
    }

    return count;
}
