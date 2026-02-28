import type {
    InsightChatAttachment,
    InsightChatAttachmentInput,
    InsightChatContextMessage,
    InsightChatFeedbackContext,
    InsightChatResponseMode,
    InsightChatMemoryMode,
    LlmRequestConfig,
    StoryboardModelProfile,
} from '@/types/insight';

type ParsedBodyValue = Record<string, unknown> | null | undefined;

export type ParsedInsightChatRequest = {
    message: string;
    requestId: string | undefined;
    llmConfig: LlmRequestConfig | undefined;
    responseMode: InsightChatResponseMode | undefined;
    attachments: InsightChatAttachment[];
    contextMessages: InsightChatContextMessage[];
    feedbackContext: InsightChatFeedbackContext | undefined;
    memoryMode?: InsightChatMemoryMode;
    memoryProfileNote?: string;
    invalidFeedbackReason?: string;
    inputPolicyViolationReason?: string;
    invalidModelReason?: string;
    invalidAttachmentReason?: string;
    invalidContextReason?: string;
};

const MAX_REQUEST_ID_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_ATTACHMENTS_COUNT = 4;
const MAX_ATTACHMENT_CONTENT_LENGTH = 12_000;
const MAX_ATTACHMENT_SIZE_BYTES = 200_000;
const MAX_CONTEXT_MESSAGES_COUNT = 12;
const MAX_CONTEXT_MESSAGE_CONTENT_LENGTH = 1_200;
const MAX_MEMORY_PROFILE_NOTE_LENGTH = 600;
const ALLOWED_ATTACHMENT_NAME = /\.(txt|csv)$/i;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    'text/plain',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
]);
const ALLOWED_RESPONSE_MODES = new Set<InsightChatResponseMode>(['fast', 'deep', 'structured']);
const ALLOWED_MEMORY_MODES = new Set<InsightChatMemoryMode>(['off', 'session', 'pinned']);

function normalizeResponseMode(raw: unknown): InsightChatResponseMode | undefined {
    return raw === 'fast' || raw === 'deep' || raw === 'structured' ? raw : undefined;
}

function normalizeMemoryMode(raw: unknown): InsightChatMemoryMode | undefined {
    return ALLOWED_MEMORY_MODES.has(raw as InsightChatMemoryMode) ? raw as InsightChatMemoryMode : undefined;
}

function sanitizeFeedbackReason(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300);
    return normalized || undefined;
}

function normalizeFeedbackContext(raw: unknown): {
    feedbackContext?: InsightChatFeedbackContext;
    invalidFeedbackReason?: string;
} {
    if (raw === undefined) {
        return {};
    }

    if (raw === null || typeof raw !== 'object') {
        return { invalidFeedbackReason: 'invalid_feedback_context' };
    }

    const payload = raw as Partial<InsightChatFeedbackContext>;
    const rating = payload.rating === 'up' || payload.rating === 'down' ? payload.rating : undefined;
    if (!rating) {
        return { invalidFeedbackReason: 'invalid_feedback_rating' };
    }

    if (payload.reason !== undefined && typeof payload.reason !== 'string') {
        return { invalidFeedbackReason: 'invalid_feedback_reason' };
    }

    if (
        payload.targetAssistantMessageId !== undefined
        && (typeof payload.targetAssistantMessageId !== 'string'
            || !payload.targetAssistantMessageId.trim()
        )
    ) {
        return { invalidFeedbackReason: 'invalid_feedback_target_id' };
    }

    const reason = sanitizeFeedbackReason(payload.reason);
    const targetAssistantMessageId = typeof payload.targetAssistantMessageId === 'string'
        ? payload.targetAssistantMessageId.trim()
        : undefined;

    return {
        feedbackContext: {
            rating,
            ...(reason ? { reason } : {}),
            ...(targetAssistantMessageId ? { targetAssistantMessageId } : {}),
        },
    };
}

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

function normalizeModel(raw: unknown, provider: LlmRequestConfig['provider'] | undefined): string | undefined {
    if (typeof raw !== 'string') {
        return undefined;
    }

    const value = raw.trim();
    if (!provider || !value) {
        return undefined;
    }

    return value;
}

function normalizeStoryboardProfile(raw: unknown): StoryboardModelProfile | undefined {
    return raw === 'nanobanana' || raw === 'nanobanana_pro' ? raw : undefined;
}

function stripUnsafeMessage(message: string): string {
    return message.trim().replace(/[\u0000-\u001f\u007f]+/g, '').slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeAttachmentName(raw: unknown): string {
    if (typeof raw !== 'string') {
        return '';
    }
    return raw
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/[\u0000-\u001f\u007f]+/g, '')
        .slice(0, 120);
}

function normalizeAttachmentMimeType(raw: unknown): string {
    if (typeof raw !== 'string') {
        return '';
    }
    return raw.trim().toLowerCase().slice(0, 80);
}

function sanitizeAttachmentContent(raw: unknown): string {
    if (typeof raw !== 'string') {
        return '';
    }
    return raw
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
        .slice(0, MAX_ATTACHMENT_CONTENT_LENGTH);
}

function sanitizeContextMessageContent(raw: unknown): string {
    if (typeof raw !== 'string') {
        return '';
    }
    return raw
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CONTEXT_MESSAGE_CONTENT_LENGTH);
}

function sanitizeMemoryProfileNote(raw: unknown): string | undefined {
    if (typeof raw !== 'string') {
        return undefined;
    }

    const normalized = raw
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_MEMORY_PROFILE_NOTE_LENGTH);

    return normalized || undefined;
}

function parseContextMessages(raw: unknown): {
    contextMessages: InsightChatContextMessage[];
    invalidContextReason?: string;
} {
    if (raw === undefined || raw === null) {
        return { contextMessages: [] };
    }

    if (!Array.isArray(raw)) {
        return { contextMessages: [], invalidContextReason: 'invalid_context_payload' };
    }

    if (raw.length > MAX_CONTEXT_MESSAGES_COUNT) {
        return { contextMessages: [], invalidContextReason: 'context_count_exceeded' };
    }

    const parsed: InsightChatContextMessage[] = [];

    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') {
            return { contextMessages: [], invalidContextReason: 'invalid_context_entry' };
        }

        const role = (entry as { role?: unknown }).role;
        const content = sanitizeContextMessageContent((entry as { content?: unknown }).content);
        if (role !== 'user' && role !== 'assistant') {
            return { contextMessages: [], invalidContextReason: 'invalid_context_role' };
        }

        if (!content) {
            return { contextMessages: [], invalidContextReason: 'invalid_context_content' };
        }

        parsed.push({
            role,
            content,
        });
    }

    return {
        contextMessages: parsed,
    };
}

function parseAttachments(raw: unknown): { attachments: InsightChatAttachment[]; invalidAttachmentReason?: string } {
    if (raw === undefined || raw === null) {
        return { attachments: [] };
    }

    if (!Array.isArray(raw)) {
        return { attachments: [], invalidAttachmentReason: 'invalid_attachments_payload' };
    }

    if (raw.length > MAX_ATTACHMENTS_COUNT) {
        return { attachments: [], invalidAttachmentReason: 'attachments_count_exceeded' };
    }

    const parsed: InsightChatAttachment[] = [];

    for (const entry of raw as InsightChatAttachmentInput[]) {
        if (!entry || typeof entry !== 'object') {
            return { attachments: [], invalidAttachmentReason: 'invalid_attachment_entry' };
        }

        const name = sanitizeAttachmentName(entry.name);
        const mimeType = normalizeAttachmentMimeType(entry.mimeType);
        const content = sanitizeAttachmentContent(entry.content);
        const rawSize = typeof entry.sizeBytes === 'number' ? Math.floor(entry.sizeBytes) : undefined;
        const measuredSize = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize > 0
            ? rawSize
            : content.length;

        if (!name || !ALLOWED_ATTACHMENT_NAME.test(name)) {
            return { attachments: [], invalidAttachmentReason: 'invalid_attachment_name' };
        }

        const isAllowedMimeType = !mimeType
            || ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)
            || mimeType.startsWith('text/');
        if (!isAllowedMimeType) {
            return { attachments: [], invalidAttachmentReason: 'invalid_attachment_mime' };
        }

        if (!content.trim()) {
            return { attachments: [], invalidAttachmentReason: 'empty_attachment_content' };
        }

        if (content.length > MAX_ATTACHMENT_CONTENT_LENGTH || measuredSize > MAX_ATTACHMENT_SIZE_BYTES) {
            return { attachments: [], invalidAttachmentReason: 'attachment_size_exceeded' };
        }

        parsed.push({
            name,
            mimeType: mimeType || 'text/plain',
            content,
            sizeBytes: measuredSize,
        });
    }

    return { attachments: parsed };
}

function isPotentialInjectionPayload(message: string): string | undefined {
    const normalized = message.toLowerCase();
    const patterns = [
        'ignore previous instructions',
        'ignore all previous',
        'system prompt',
        'you are now',
        'act as',
        'jailbreak',
        'pretend to be',
        '<|im_start|>',
        '<|assistant|>',
        '<|user|>',
    ];

    for (const pattern of patterns) {
        if (normalized.includes(pattern)) {
            return pattern;
        }
    }

    return undefined;
}

export function parseInsightChatRequestBody(body: ParsedBodyValue): ParsedInsightChatRequest {
    const rawMessage = typeof body?.message === 'string' ? body.message : '';
    const message = stripUnsafeMessage(rawMessage);
    const requestId = normalizeRequestId(body?.requestId);
    const provider = normalizeProvider(body?.provider);
    const model = normalizeModel(body?.model, provider);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : undefined;
    const rawModel = typeof body?.model === 'string' ? body.model.trim() : '';
    const useServerKey = body?.useServerKey === true;
    const storyboardModelProfile = normalizeStoryboardProfile(body?.storyboardModelProfile);
    const imageModelProfile = normalizeStoryboardProfile(body?.imageModelProfile);
    const responseMode = normalizeResponseMode(body?.responseMode);
    const memoryProfileNote = sanitizeMemoryProfileNote(body?.memoryProfileNote);
    const { feedbackContext, invalidFeedbackReason } = normalizeFeedbackContext(body?.feedbackContext);
    const memoryMode = normalizeMemoryMode(body?.memoryMode);
    const { attachments, invalidAttachmentReason } = parseAttachments(body?.attachments);
    const { contextMessages, invalidContextReason } = parseContextMessages(body?.contextMessages);

    const policyViolation = message ? isPotentialInjectionPayload(message) : undefined;
    const invalidModelReason = rawModel.length > 0 && provider !== undefined && model === undefined
        ? 'invalid_model'
        : undefined;

    const llmConfig = provider && model
        ? {
            provider,
            model,
            apiKey,
            useServerKey: useServerKey || (provider === 'gemini' && !apiKey),
            ...(storyboardModelProfile ? { storyboardModelProfile } : {}),
            ...(imageModelProfile ? { imageModelProfile } : {}),
        }
        : undefined;

    return {
        message,
        requestId,
        llmConfig,
        responseMode,
        attachments,
        contextMessages,
        feedbackContext,
        ...(invalidFeedbackReason ? { invalidFeedbackReason } : {}),
        inputPolicyViolationReason: policyViolation,
        ...(invalidModelReason ? { invalidModelReason } : {}),
        ...(invalidAttachmentReason ? { invalidAttachmentReason } : {}),
        ...(invalidContextReason ? { invalidContextReason } : {}),
        ...(memoryProfileNote ? { memoryProfileNote } : {}),
        ...(memoryMode ? { memoryMode } : {}),
    };
}
