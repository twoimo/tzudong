export type InsightChatStreamState = {
    accumulated: string;
    streamError: string | null;
    toolTrace?: string[];
    cancellationReason?: 'request_cancelled' | 'stream_error';
    requestId?: string;
};

function normalizeStreamToolTrace(raw: unknown): string[] {
    const entries: string[] = [];

    const pushEntry = (value: unknown) => {
        if (typeof value !== 'string') {
            return;
        }

        const normalized = value.trim();
        if (!normalized) {
            return;
        }

        if (normalized.includes('>')) {
            const nested = normalized.split('>');
            for (const chunk of nested) {
                const trimmed = chunk.trim();
                if (trimmed) entries.push(trimmed);
            }
            return;
        }

        entries.push(normalized);
    };

    if (Array.isArray(raw)) {
        for (const value of raw) {
            pushEntry(value);
        }
        return entries.filter((value, index, values) => values.indexOf(value) === index);
    }

    pushEntry(raw);
    return entries.filter((value, index, values) => values.indexOf(value) === index);
}

function mergeToolTrace(state: string[] | undefined, incoming: string[]): string[] {
    const next = [...(state ?? []), ...incoming];
    return next.filter((value, index, values) =>
        value && values.indexOf(value) === index,
    );
}

export function parseInsightChatStreamLine(
    line: string,
    state: InsightChatStreamState,
    onToken: (token: string) => void,
): InsightChatStreamState {
    if (state.streamError) {
        return state;
    }

    const match = line.match(/^\s*data:\s*(.*?)\s*$/);
    if (!match) {
        return state;
    }

    const payload = (match[1] ?? '').trim();
    if (!payload || payload === '[DONE]') {
        return state;
    }

    let parsed: {
        text?: unknown;
        error?: unknown;
        toolTrace?: unknown;
        requestId?: unknown;
        cancellationReason?: unknown;
    };
    try {
        parsed = JSON.parse(payload) as {
            text?: unknown;
            error?: unknown;
            toolTrace?: unknown;
            requestId?: unknown;
            cancellationReason?: unknown;
        };
    } catch {
        return state;
    }

    const parsedToolTrace = normalizeStreamToolTrace(parsed.toolTrace);
    const mergedToolTrace = mergeToolTrace(state.toolTrace, parsedToolTrace);
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : state.requestId;
    const cancellationReason = parsed.cancellationReason === 'request_cancelled' || parsed.cancellationReason === 'stream_error'
        ? parsed.cancellationReason
        : undefined;

    if (typeof parsed.error === 'string' && parsed.error) {
        return {
            ...state,
            toolTrace: mergedToolTrace,
            streamError: parsed.error,
            cancellationReason,
            requestId,
        };
    }

    if (typeof parsed.text === 'string' && parsed.text) {
        onToken(parsed.text);
        return {
            ...state,
            toolTrace: mergedToolTrace,
            requestId,
            accumulated: state.accumulated + parsed.text,
        };
    }

    return {
        ...state,
        toolTrace: mergedToolTrace,
        requestId,
    };
}
