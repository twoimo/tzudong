import { describe, expect, mock, test } from 'bun:test';

mock.module('@/lib/auth/require-admin', () => ({
    requireAdmin: async () => ({
        ok: true,
        userId: 'admin-user',
    }),
}));

const originalEnv = {
    GEMINI_OCR_YEON: process.env.GEMINI_OCR_YEON,
    STORYBOARD_AGENT_GEMINI_API_KEY: process.env.STORYBOARD_AGENT_GEMINI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
};

async function getConfig() {
    const { GET } = await import('@/app/api/admin/insight/llm-config/route');
    const response = await GET();
    return response.json();
}

describe('insight llm config security', () => {
    test('does not expose raw Gemini server key in response', async () => {
        const secret = 'sk-test-hidden-1234567890';
        process.env.GEMINI_OCR_YEON = secret;
        try {
            const payload = await getConfig();
            expect(payload).toEqual({ hasGeminiServerKey: true });
            expect(JSON.stringify(payload)).not.toContain(secret);
        } finally {
            process.env.GEMINI_OCR_YEON = originalEnv.GEMINI_OCR_YEON;
        }
    });

    test('returns false when server keys are not configured', async () => {
        process.env.GEMINI_OCR_YEON = '';
        process.env.STORYBOARD_AGENT_GEMINI_API_KEY = '';
        process.env.GEMINI_API_KEY = '';
        process.env.GOOGLE_API_KEY = '';
        try {
            const payload = await getConfig();
            expect(payload).toEqual({ hasGeminiServerKey: false });
            expect(payload).not.toHaveProperty('geminiKey');
        } finally {
            process.env.GEMINI_OCR_YEON = originalEnv.GEMINI_OCR_YEON;
            process.env.STORYBOARD_AGENT_GEMINI_API_KEY = originalEnv.STORYBOARD_AGENT_GEMINI_API_KEY;
            process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
            process.env.GOOGLE_API_KEY = originalEnv.GOOGLE_API_KEY;
        }
    });
});
