import { describe, expect, test } from 'bun:test';
import { answerAdminInsightChat } from '@/lib/insight/chat';

describe('admin insight chat setup checklist mode', () => {
  test('returns concise operator todo checklist for /operator-todo command', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
    const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
    const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
    const prevBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
    const prevBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevRunDaily = process.env.RUN_DAILY_SCRIPT_PATH;

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/operator-todo');

      expect(response.meta?.source).toBe('local');
      expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
      expect(response.meta?.systemStatusHints).toContain('BGE 임베딩: STORYBOARD_BGE_ENABLED=true, STORYBOARD_BGE_EMBEDDING_URL/토큰 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('Nano Banana 2: NANO_BANANA_2_API_KEY 미설정');
      expect(response.meta?.systemStatusHints).toContain('Storyboard: STORYBOARD_AGENT_ENABLED=true 및 STORYBOARD_AGENT_API_URL 점검 필요');
      expect(response.content).toContain('## 운영자 TODO');
      expect(response.content).toContain('Supabase');
      expect(response.content).toContain('Storyboard');
      expect(response.content).toContain('BGE');
      expect(response.content).toContain('Nano Banana 2');
      expect(response.content).toContain('미확인');
    } finally {
      global.fetch = originalFetch;
      if (prevCacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
      }
      if (prevStoryboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
      }
      if (prevStoryboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
      }
      if (prevBgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevBgeEnabled;
      }
      if (prevBgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevBgeUrl;
      }
      if (prevSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      }
      if (prevSupabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
      }
      if (prevRunDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevRunDaily;
      }
    }
  });

  test('returns concise checklist for /setup-owner command', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
    const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
    const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
    const prevBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevRunDaily = process.env.RUN_DAILY_SCRIPT_PATH;

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/setup-owner');

      expect(response.meta?.source).toBe('local');
      expect(response.content).toContain('## 운영자 TODO');
      expect(response.content).toContain('Supabase');
      expect(response.content).toContain('Storyboard');
      expect(response.content).toContain('BGE');
      expect(response.content).toContain('Nano Banana 2');
    } finally {
      global.fetch = originalFetch;
      if (prevCacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
      }
      if (prevStoryboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
      }
      if (prevStoryboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
      }
      if (prevBgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevBgeEnabled;
      }
      if (prevSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      }
      if (prevSupabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
      }
      if (prevRunDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevRunDaily;
      }
    }
  });

  test('returns setup checklist text for /setup command', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
    const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
    const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
    const prevBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
    const prevBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
    const prevNanoBanana2Key = process.env.NANO_BANANA_2_API_KEY;
    const prevNanoBananaKey = process.env.NANO_BANANA_API_KEY;
    const prevNanoBananaAgentKey = process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
    const prevStoryboardImageAgentKey = process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevRunDaily = process.env.RUN_DAILY_SCRIPT_PATH;

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NANO_BANANA_2_API_KEY = '';
    process.env.NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_IMAGE_API_KEY = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/setup');

      expect(response.meta?.source).toBe('local');
      expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
      expect(response.meta?.systemStatusHints).toContain('Storyboard: STORYBOARD_AGENT_ENABLED=true 및 STORYBOARD_AGENT_API_URL 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('BGE 임베딩: STORYBOARD_BGE_ENABLED=true, STORYBOARD_BGE_EMBEDDING_URL/토큰 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('Nano Banana 2: NANO_BANANA_2_API_KEY 미설정');
      expect(response.content).toContain('## 운영 체크리스트 모드');
      expect(response.content).toContain('운영 키 점검');
      expect(response.content).toContain('run_daily 수집 파이프라인');
      expect(response.content).toContain('Storyboard 연동');
      expect(response.content).toContain('BGE 임베딩');
      expect(response.content).toContain('### ⚠️ Nano Banana 2 키');
      expect(response.content).toContain('run_daily');
    } finally {
      global.fetch = originalFetch;
      if (prevCacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
      }
      if (prevStoryboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
      }
      if (prevStoryboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
      }
      if (prevBgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevBgeEnabled;
      }
      if (prevBgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevBgeUrl;
      }
      if (prevNanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevNanoBanana2Key;
      }
      if (prevNanoBananaKey === undefined) {
        delete process.env.NANO_BANANA_API_KEY;
      } else {
        process.env.NANO_BANANA_API_KEY = prevNanoBananaKey;
      }
      if (prevNanoBananaAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = prevNanoBananaAgentKey;
      }
      if (prevStoryboardImageAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_IMAGE_API_KEY = prevStoryboardImageAgentKey;
      }
      if (prevSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      }
      if (prevSupabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
      }
      if (prevRunDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevRunDaily;
      }
    }
  });

  test('never exposes configured secret values in setup checklist responses', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
    const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
    const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
    const prevBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
    const prevBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
    const prevBgeToken = process.env.STORYBOARD_BGE_EMBEDDING_TOKEN;
    const prevGeminiKey = process.env.GEMINI_OCR_YEON;
    const prevOpenAIKey = process.env.OPENAI_API_KEY;
    const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const prevNanoBanana2Key = process.env.NANO_BANANA_2_API_KEY;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevRunDaily = process.env.RUN_DAILY_SCRIPT_PATH;

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.STORYBOARD_BGE_EMBEDDING_TOKEN = 'super-secret-bge-token';
    process.env.GEMINI_OCR_YEON = 'super-secret-gemini-key';
    process.env.OPENAI_API_KEY = 'super-secret-openai-key';
    process.env.ANTHROPIC_API_KEY = 'super-secret-anthropic-key';
    process.env.NANO_BANANA_2_API_KEY = 'super-secret-nanobanana-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/setup');
      const responseText = JSON.stringify(response);

      expect(response.meta?.source).toBe('local');
      expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
      expect(responseText).not.toContain('super-secret-bge-token');
      expect(responseText).not.toContain('super-secret-gemini-key');
      expect(responseText).not.toContain('super-secret-openai-key');
      expect(responseText).not.toContain('super-secret-anthropic-key');
      expect(responseText).not.toContain('super-secret-nanobanana-key');
      expect(response.content).toContain('## 운영 체크리스트 모드');
    } finally {
      global.fetch = originalFetch;
      if (prevCacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
      }
      if (prevStoryboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
      }
      if (prevStoryboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
      }
      if (prevBgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevBgeEnabled;
      }
      if (prevBgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevBgeUrl;
      }
      if (prevBgeToken === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_TOKEN;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_TOKEN = prevBgeToken;
      }
      if (prevGeminiKey === undefined) {
        delete process.env.GEMINI_OCR_YEON;
      } else {
        process.env.GEMINI_OCR_YEON = prevGeminiKey;
      }
      if (prevOpenAIKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prevOpenAIKey;
      }
      if (prevAnthropicKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
      }
      if (prevNanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevNanoBanana2Key;
      }
      if (prevSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      }
      if (prevSupabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
      }
      if (prevRunDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevRunDaily;
      }
    }
  });

  test('treats /setup-checklist alias as setup checklist request', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
    const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
    const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
    const prevBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
    const prevBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
    const prevNanoBanana2Key = process.env.NANO_BANANA_2_API_KEY;
    const prevNanoBananaKey = process.env.NANO_BANANA_API_KEY;
    const prevNanoBananaAgentKey = process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
    const prevStoryboardImageAgentKey = process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevRunDaily = process.env.RUN_DAILY_SCRIPT_PATH;

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NANO_BANANA_2_API_KEY = '';
    process.env.NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_IMAGE_API_KEY = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/setup-checklist');

      expect(response.meta?.source).toBe('local');
      expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
      expect(response.meta?.systemStatusHints).toContain('Storyboard: STORYBOARD_AGENT_ENABLED=true 및 STORYBOARD_AGENT_API_URL 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('BGE 임베딩: STORYBOARD_BGE_ENABLED=true, STORYBOARD_BGE_EMBEDDING_URL/토큰 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('Nano Banana 2: NANO_BANANA_2_API_KEY 미설정');
      expect(response.content).toContain('## 운영 체크리스트 모드');
      expect(response.content).toContain('운영 키 점검');
      expect(response.content).toContain('run_daily 수집 파이프라인');
    } finally {
      global.fetch = originalFetch;
      if (prevCacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
      }
      if (prevStoryboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
      }
      if (prevStoryboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
      }
      if (prevBgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevBgeEnabled;
      }
      if (prevBgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevBgeUrl;
      }
      if (prevNanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevNanoBanana2Key;
      }
      if (prevNanoBananaKey === undefined) {
        delete process.env.NANO_BANANA_API_KEY;
      } else {
        process.env.NANO_BANANA_API_KEY = prevNanoBananaKey;
      }
      if (prevNanoBananaAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = prevNanoBananaAgentKey;
      }
      if (prevStoryboardImageAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_IMAGE_API_KEY = prevStoryboardImageAgentKey;
      }
      if (prevSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      }
      if (prevSupabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
      }
      if (prevRunDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevRunDaily;
      }
    }
  });

  test('returns key-focused checklist for /setup-keys command', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
    const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
    const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
    const prevBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
    const prevBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
    const prevNanoBanana2Key = process.env.NANO_BANANA_2_API_KEY;
    const prevNanoBananaKey = process.env.NANO_BANANA_API_KEY;
    const prevNanoBananaAgentKey = process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
    const prevStoryboardImageAgentKey = process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NANO_BANANA_2_API_KEY = '';
    process.env.NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_IMAGE_API_KEY = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';

    try {
      const response = await answerAdminInsightChat('/setup-keys');

      expect(response.meta?.source).toBe('local');
      expect(response.meta?.toolTrace).toContain('local:setup-keys');
      expect(response.content).toContain('## 운영 키 체크리스트');
      expect(response.content).toContain('준비 항목');
      expect(response.content).toContain('Supabase URL');
      expect(response.content).toContain('Supabase Service Role');
      expect(response.content).toContain('Gemini 서버 키');
      expect(response.content).toContain('OpenAI 서버 키');
      expect(response.content).toContain('Anthropic 서버 키');
      expect(response.content).toContain('Nano Banana 2 키');
      expect(response.content).toContain('API 키 설정');
      expect(response.content).toContain('```bash');
    } finally {
      global.fetch = originalFetch;
      if (prevCacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
      }
      if (prevStoryboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
      }
      if (prevStoryboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
      }
      if (prevBgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevBgeEnabled;
      }
      if (prevBgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevBgeUrl;
      }
      if (prevNanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevNanoBanana2Key;
      }
      if (prevNanoBananaKey === undefined) {
        delete process.env.NANO_BANANA_API_KEY;
      } else {
        process.env.NANO_BANANA_API_KEY = prevNanoBananaKey;
      }
      if (prevNanoBananaAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = prevNanoBananaAgentKey;
      }
      if (prevStoryboardImageAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_IMAGE_API_KEY = prevStoryboardImageAgentKey;
      }
      if (prevSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      }
      if (prevSupabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
      }
    }
  });

  test('treats /ops-checklist as setup checklist alias', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
    const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
    const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
    const prevBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
    const prevBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
    const prevNanoBanana2Key = process.env.NANO_BANANA_2_API_KEY;
    const prevNanoBananaKey = process.env.NANO_BANANA_API_KEY;
    const prevNanoBananaAgentKey = process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
    const prevStoryboardImageAgentKey = process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevRunDaily = process.env.RUN_DAILY_SCRIPT_PATH;

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NANO_BANANA_2_API_KEY = '';
    process.env.NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_IMAGE_API_KEY = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/ops-checklist');

      expect(response.meta?.source).toBe('local');
      expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
      expect(response.meta?.systemStatusHints).toContain('Storyboard: STORYBOARD_AGENT_ENABLED=true 및 STORYBOARD_AGENT_API_URL 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('BGE 임베딩: STORYBOARD_BGE_ENABLED=true, STORYBOARD_BGE_EMBEDDING_URL/토큰 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('Nano Banana 2: NANO_BANANA_2_API_KEY 미설정');
      expect(response.content).toContain('## 운영 체크리스트 모드');
      expect(response.content).toContain('운영 키 점검');
      expect(response.content).toContain('run_daily 수집 파이프라인');
    } finally {
      global.fetch = originalFetch;
      if (prevCacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
      }
      if (prevStoryboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
      }
      if (prevStoryboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
      }
      if (prevBgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevBgeEnabled;
      }
      if (prevBgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevBgeUrl;
      }
      if (prevNanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevNanoBanana2Key;
      }
      if (prevNanoBananaKey === undefined) {
        delete process.env.NANO_BANANA_API_KEY;
      } else {
        process.env.NANO_BANANA_API_KEY = prevNanoBananaKey;
      }
      if (prevNanoBananaAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = prevNanoBananaAgentKey;
      }
      if (prevStoryboardImageAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_IMAGE_API_KEY = prevStoryboardImageAgentKey;
      }
      if (prevSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
      }
      if (prevSupabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
      }
      if (prevRunDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevRunDaily;
      }
    }
  });

  test('treats Korean checklist phrase as setup request', async () => {
    const response = await answerAdminInsightChat('운영 체크리스트 확인해줘', {
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      apiKey: '',
    });

    expect(response.meta?.source).toBe('local');
    expect(response.content).toContain('## 운영 체크리스트 모드');
    expect(response.content).toContain('현재');
  });

  test('setup/operator commands include operator-aware follow-up prompts', async () => {
    const testCases: Array<{
      command: string;
      expectedFollowUps: string[];
    }> = [
      {
        command: '/setup',
        expectedFollowUps: ['/setup-checklist', '/setup-keys', '/operator-todo', '/ops-status', '/system-status'],
      },
      {
        command: '/setup-checklist',
        expectedFollowUps: ['/setup-keys', '/operator-todo', '/setup-owner', '/ops-status', '/system-status'],
      },
      {
        command: '/ops-checklist',
        expectedFollowUps: ['/setup-keys', '/operator-todo', '/setup-owner', '/ops-status', '/system-status'],
      },
      {
        command: '/setup-keys',
        expectedFollowUps: ['/setup', '/setup-checklist', '/operator-todo', '/ops-status', '/system-status'],
      },
      {
        command: '/ops-keys',
        expectedFollowUps: ['/setup', '/setup-checklist', '/operator-todo', '/ops-status', '/system-status'],
      },
      {
        command: '/keys-check',
        expectedFollowUps: ['/setup', '/setup-checklist', '/operator-todo', '/ops-status', '/system-status'],
      },
      {
        command: '/operator-todo',
        expectedFollowUps: ['/setup', '/setup-keys', '/setup-checklist', '/ops-status', '/system-status'],
      },
      {
        command: '/ops-todo',
        expectedFollowUps: ['/setup', '/setup-keys', '/setup-checklist', '/ops-status', '/system-status'],
      },
      {
        command: '/setup-owner',
        expectedFollowUps: ['/setup', '/setup-keys', '/operator-todo', '/ops-status', '/system-status'],
      },
    ];

    const originalFetch = global.fetch;
    const restore = {
      cacheTtl: process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS,
      storyboardEnabled: process.env.STORYBOARD_AGENT_ENABLED,
      storyboardApiUrl: process.env.STORYBOARD_AGENT_API_URL,
      bgeEnabled: process.env.STORYBOARD_BGE_ENABLED,
      bgeUrl: process.env.STORYBOARD_BGE_EMBEDDING_URL,
      nanoBanana2Key: process.env.NANO_BANANA_2_API_KEY,
      nanoBananaKey: process.env.NANO_BANANA_API_KEY,
      nanoBananaAgentKey: process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY,
      storyboardImageAgentKey: process.env.STORYBOARD_AGENT_IMAGE_API_KEY,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      runDaily: process.env.RUN_DAILY_SCRIPT_PATH,
    };

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NANO_BANANA_2_API_KEY = '';
    process.env.NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = '';
    process.env.STORYBOARD_AGENT_IMAGE_API_KEY = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    global.fetch = async (input: RequestInfo | URL) => {
      const endpoint = String(input);
      if (endpoint.includes('/health')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };

    try {
      for (const { command, expectedFollowUps } of testCases) {
        const response = await answerAdminInsightChat(command);
        const prompts = response.followUpPrompts?.map((entry) => entry.prompt) ?? [];

        expect(response.meta?.source).toBe('local');
        for (const followUp of expectedFollowUps) {
          expect(prompts).toContain(followUp);
        }
        expect(prompts).not.toContain('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
        expect(prompts).not.toContain('/tzuyang-restaurant 오늘 운영 영상용 상호 브리핑(메뉴·세팅·컷 추천)을 정리해줘');
        expect(prompts).not.toContain('/tzuyang-peak-frame 피크 프레임 구간에서 후킹/클로징 보강 컷을 제안해줘');
      }
    } finally {
      global.fetch = originalFetch;
      if (restore.cacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = restore.cacheTtl;
      }
      if (restore.storyboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = restore.storyboardEnabled;
      }
      if (restore.storyboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = restore.storyboardApiUrl;
      }
      if (restore.bgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = restore.bgeEnabled;
      }
      if (restore.bgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = restore.bgeUrl;
      }
      if (restore.nanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = restore.nanoBanana2Key;
      }
      if (restore.nanoBananaKey === undefined) {
        delete process.env.NANO_BANANA_API_KEY;
      } else {
        process.env.NANO_BANANA_API_KEY = restore.nanoBananaKey;
      }
      if (restore.nanoBananaAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = restore.nanoBananaAgentKey;
      }
      if (restore.storyboardImageAgentKey === undefined) {
        delete process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
      } else {
        process.env.STORYBOARD_AGENT_IMAGE_API_KEY = restore.storyboardImageAgentKey;
      }
      if (restore.supabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = restore.supabaseUrl;
      }
      if (restore.supabaseRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = restore.supabaseRoleKey;
      }
      if (restore.runDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = restore.runDaily;
      }
    }
  });
});
