import type { LlmRequestConfig, StoryboardModelProfile } from '@/types/insight';

type ParsedBodyValue = Record<string, unknown> | null | undefined;

export type ParsedInsightChatRequest = {
    message: string;
    requestId: string | undefined;
    llmConfig: LlmRequestConfig | undefined;
};

const MAX_REQUEST_ID_LENGTH = 64;

function trimRequestId(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

function normalizeRequestId(raw: unknown): string | undefined {
    const value = trimRequestId(raw);
    return value ? value.slice(0, MAX_REQUEST_ID_LENGTH) : undefined;
}

function normalizeProvider(raw: unknown): LlmRequestConfig['provider'] | undefined {
    return raw === 'gemini' || raw === 'openai' || raw === 'anthropic' ? raw : undefined;
}

function normalizeStoryboardProfile(raw: unknown): StoryboardModelProfile | undefined {
    return raw === 'nanobanana' || raw === 'nanobanana_pro' ? raw : undefined;
}

export function parseInsightChatRequestBody(body: ParsedBodyValue): ParsedInsightChatRequest {
    const message = typeof body?.message === 'string' ? body.message : '';
    const requestId = normalizeRequestId(body?.requestId);
    const provider = normalizeProvider(body?.provider);
    const model = typeof body?.model === 'string' ? body.model : undefined;
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : undefined;
    const useServerKey = body?.useServerKey === true;
    const storyboardModelProfile = normalizeStoryboardProfile(body?.storyboardModelProfile);
    const imageModelProfile = normalizeStoryboardProfile(body?.imageModelProfile);

    const shouldUseServerKey = useServerKey || (provider === 'gemini' && !apiKey);
    const llmConfig = provider && model
        ? {
            provider,
            model,
            apiKey,
            useServerKey: shouldUseServerKey,
            ...(storyboardModelProfile ? { storyboardModelProfile } : {}),
            ...(imageModelProfile ? { imageModelProfile } : {}),
        }
        : undefined;

    return { message, requestId, llmConfig };
}
