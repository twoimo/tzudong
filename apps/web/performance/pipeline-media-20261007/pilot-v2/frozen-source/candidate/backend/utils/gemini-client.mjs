/** One SDK attempt per admitted operation; deadlines retain permits until settlement. */
import { GoogleGenAI } from '@google/genai';
import { applyProjectCooldown, withProjectBudget } from './provider-budget.mjs';

function fixedError(code) {
    return Object.assign(new Error(code), { code });
}

export function geminiHttpOptions(timeout = 300000, fetchImpl = globalThis.fetch) {
    return {
        timeout,
        retryOptions: { attempts: 1 },
        fetch: async (...args) => {
            const response = await fetchImpl(...args);
            if (response.status === 429 || response.status === 503) {
                // SDK ApiError can discard response headers; observe the header first.
                try { await applyProjectCooldown({ headers: response.headers }); }
                catch (error) { await response.body?.cancel(); throw error; }
            }
            return response;
        },
    };
}

export function createGeminiClient(apiKey, timeout = 300000) {
    return new GoogleGenAI({ apiKey, httpOptions: geminiHttpOptions(timeout) });
}

export async function withGeminiDeadline(work, timeoutMs = 300000, externalSignal) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
        throw fixedError('GEMINI_TIMEOUT_INVALID');
    if (externalSignal?.aborted) throw fixedError('GEMINI_REQUEST_ABORTED');
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // Do not race and abandon work: the caller's permit stays held until
        // SDK transport/body consumption actually completes or rejects.
        const result = await work(signal);
        if (controller.signal.aborted) throw fixedError('GEMINI_API_TIMEOUT');
        if (externalSignal?.aborted) throw fixedError('GEMINI_REQUEST_ABORTED');
        return result;
    } catch (error) {
        if (controller.signal.aborted) throw fixedError('GEMINI_API_TIMEOUT');
        if (externalSignal?.aborted) throw fixedError('GEMINI_REQUEST_ABORTED');
        throw error;
    } finally { clearTimeout(timer); }
}

export function generateWithProjectBudget(ai, request, timeoutMs = 300000) {
    if (request.config?.abortSignal?.aborted) return Promise.reject(fixedError('GEMINI_REQUEST_ABORTED'));
    return withProjectBudget(() => withGeminiDeadline(signal => ai.models.generateContent({
        ...request,
        config: {
            ...request.config,
            abortSignal: signal,
            httpOptions: { ...request.config?.httpOptions, timeout: timeoutMs, retryOptions: { attempts: 1 } },
        },
    }), timeoutMs, request.config?.abortSignal), request.config?.abortSignal ? { acquireTimeoutMs: timeoutMs } : undefined);
}

export function logGeminiUsage(response, write = console.log) {
    const usage = response?.usageMetadata;
    if (!usage) return;
    const counts = Object.fromEntries(['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount']
        .filter(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
        .map(key => [key, usage[key]]));
    if (Object.keys(counts).length) write('GEMINI_USAGE ' + JSON.stringify(counts));
}

export function requireGeminiText(response) {
    const text = response?.text;
    if (typeof text !== 'string' || !text.trim()) throw fixedError('GEMINI_EMPTY_RESPONSE');
    return text;
}
