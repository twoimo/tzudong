export type InsightChatStreamState = {
    accumulated: string;
    streamError: string | null;
    toolTrace?: string[];
    cancellationReason?: 'request_cancelled' | 'stream_error';
    requestId?: string;
};

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
        text?: string;
        error?: string;
        toolTrace?: string[] | string;
        requestId?: string;
        cancellationReason?: 'request_cancelled' | 'stream_error';
    };
    try {
        parsed = JSON.parse(payload) as {
            text?: string;
            error?: string;
            requestId?: string;
            cancellationReason?: 'request_cancelled' | 'stream_error';
        };
    } catch {
        return state;
    }

    const parsedToolTrace = Array.isArray(parsed.toolTrace)
        ? parsed.toolTrace
        : typeof parsed.toolTrace === 'string'
            ? [parsed.toolTrace]
            : [];

    if (parsed.error) {
        return {
            ...state,
            toolTrace: [...(state.toolTrace ?? []), ...parsedToolTrace].filter((value, index, values) =>
                values.indexOf(value) === index && Boolean(value),
            ),
            streamError: parsed.error,
            cancellationReason: parsed.cancellationReason ?? undefined,
            requestId: parsed.requestId ?? state.requestId,
        };
    }

    if (typeof parsed.text === 'string' && parsed.text) {
        onToken(parsed.text);
        return {
            ...state,
            toolTrace: [...(state.toolTrace ?? []), ...parsedToolTrace].filter((value, index, values) =>
                values.indexOf(value) === index && Boolean(value),
            ),
            requestId: parsed.requestId ?? state.requestId,
            accumulated: state.accumulated + parsed.text,
        };
    }

    return {
        ...state,
        toolTrace: [...(state.toolTrace ?? []), ...parsedToolTrace].filter((value, index, values) =>
            values.indexOf(value) === index && Boolean(value),
        ),
        requestId: parsed.requestId ?? state.requestId,
    };
}
