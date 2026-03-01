import { afterEach, describe, expect, mock, test } from 'bun:test';
import { answerAdminInsightChat } from '@/lib/insight/chat';
import type { AdminInsightSystemStatusResponse } from '@/types/insight';

describe('admin insight chat ops status summary', () => {
  afterEach(() => {
    mock.restore();
  });

  test('returns concise summary for /ops-status command', async () => {
    const prevEnv = {
      cacheTtl: process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS,
      storyboardEnabled: process.env.STORYBOARD_AGENT_ENABLED,
      storyboardApiUrl: process.env.STORYBOARD_AGENT_API_URL,
      bgeEnabled: process.env.STORYBOARD_BGE_ENABLED,
      bgeUrl: process.env.STORYBOARD_BGE_EMBEDDING_URL,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      nanoBanana2Key: process.env.NANO_BANANA_2_API_KEY,
      runDaily: process.env.RUN_DAILY_SCRIPT_PATH,
    };

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    process.env.NANO_BANANA_2_API_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/ops-status');

      expect(response.meta?.source).toBe('local');
      expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
      expect(response.meta?.systemStatusHints).toContain('Storyboard: STORYBOARD_AGENT_ENABLED=true 및 STORYBOARD_AGENT_API_URL 점검 필요');
      expect(response.meta?.systemStatusHints).toContain('BGE 임베딩: STORYBOARD_BGE_ENABLED=true, STORYBOARD_BGE_EMBEDDING_URL/토큰 점검 필요');
      expect(response.content).toContain('## 운영 상태 요약');
      expect(response.content).toContain('- run_daily: 점검 필요');
      expect(response.content).toContain('- Storyboard:');
      expect(response.content).toContain('- BGE 임베딩:');
      expect(response.content).toContain('- 키 준비 상태:');
      expect(response.content).toContain('### Blocker');
      expect(response.meta?.toolTrace ?? []).toContain('local:ops-status');
    } finally {
      if (prevEnv.cacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevEnv.cacheTtl;
      }
      if (prevEnv.storyboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevEnv.storyboardEnabled;
      }
      if (prevEnv.storyboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevEnv.storyboardApiUrl;
      }
      if (prevEnv.bgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevEnv.bgeEnabled;
      }
      if (prevEnv.bgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevEnv.bgeUrl;
      }
      if (prevEnv.supabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv.supabaseUrl;
      }
      if (prevEnv.supabaseServiceRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.supabaseServiceRoleKey;
      }
      if (prevEnv.nanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevEnv.nanoBanana2Key;
      }
      if (prevEnv.runDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevEnv.runDaily;
      }
    }
  });

  test('renders up to 3 actionable snippets for critical/high checklist items', async () => {
    const prevEnv = {
      cacheTtl: process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS,
      storyboardEnabled: process.env.STORYBOARD_AGENT_ENABLED,
      storyboardApiUrl: process.env.STORYBOARD_AGENT_API_URL,
      bgeEnabled: process.env.STORYBOARD_BGE_ENABLED,
      bgeUrl: process.env.STORYBOARD_BGE_EMBEDDING_URL,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      nanoBanana2Key: process.env.NANO_BANANA_2_API_KEY,
      runDaily: process.env.RUN_DAILY_SCRIPT_PATH,
    };

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = '';
    process.env.STORYBOARD_BGE_ENABLED = 'false';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    process.env.NANO_BANANA_2_API_KEY = '';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    try {
      const response = await answerAdminInsightChat('/ops-status');

      expect(response.meta?.source).toBe('local');
      expect(response.content).toContain('## 운영 상태 요약');
      expect(response.content).toContain('### 운영 명령 스니펫');
      expect(response.content).toContain('run_daily 실행 권한 미설정');
      expect(response.content).toContain('NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://<project>.supabase.co}"');
      expect(response.content).toContain('RUN_DAILY_SCRIPT_PATH="${RUN_DAILY_SCRIPT_PATH:-/path/to/backend/run_daily.sh}"');
      expect(response.content).toContain('STORYBOARD_AGENT_API_URL="${STORYBOARD_AGENT_API_URL:-https://your-storyboard-host/api}"');
      expect((response.content.match(/```bash/g) || []).length).toBeLessThanOrEqual(3);
      expect(response.content).not.toContain('frame-caption');
    } finally {
      if (prevEnv.cacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevEnv.cacheTtl;
      }
      if (prevEnv.storyboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevEnv.storyboardEnabled;
      }
      if (prevEnv.storyboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevEnv.storyboardApiUrl;
      }
      if (prevEnv.bgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevEnv.bgeEnabled;
      }
      if (prevEnv.bgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevEnv.bgeUrl;
      }
      if (prevEnv.supabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv.supabaseUrl;
      }
      if (prevEnv.supabaseServiceRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.supabaseServiceRoleKey;
      }
      if (prevEnv.nanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevEnv.nanoBanana2Key;
      }
      if (prevEnv.runDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevEnv.runDaily;
      }
    }
  });

  test('returns minimal command hint when ops status is unavailable', async () => {
    const moduleId = `@/lib/insight/chat?ops-status-null-${Date.now()}-${Math.random()}`;
    mock.module('@/lib/insight/chat-system-status', () => ({
      getAdminInsightSystemStatus: async () => null as unknown as AdminInsightSystemStatusResponse,
    }));

    const { answerAdminInsightChat: mockedAnswer } = await import(moduleId);
    const response = await mockedAnswer('/ops-status');

    expect(response.meta?.source).toBe('local');
    expect(response.content).toContain('## 운영 상태 요약');
    expect(response.content).toContain('### 운영 명령 스니펫');
    expect(response.content).toContain('운영 상태 점검 정보를 불러오지 못했습니다.');
    expect(response.content).toContain('운영 상태 점검 실패 시 기본 진단');
    expect(response.content).toContain('ls -l backend/run_daily.sh || true');
  });

  test('redacts secret values in operator command snippets', async () => {
    const asOf = '2026-03-01T00:00:00.000Z';
    const status: AdminInsightSystemStatusResponse = {
      asOf,
      keys: {
        supabaseUrl: false,
        supabaseServiceRoleKey: false,
        geminiServerKey: false,
        openaiServerKey: false,
        anthropicServerKey: false,
        nanoBanana2Key: false,
      },
      storyboardAgent: {
        enabled: false,
        configured: false,
        reachable: false,
        checkedAt: asOf,
      },
      bgeEmbedding: {
        enabled: false,
        configured: false,
        reachable: false,
        checkedAt: asOf,
      },
      frameCaption: {
        configured: false,
        localPathConfigured: false,
        localPathAvailable: false,
        gdrivePathConfigured: false,
        reachable: false,
        checkedAt: asOf,
      },
      runDaily: {
        executable: false,
        stale: false,
        checkedAt: asOf,
      },
      checklist: [
        {
          id: 'supabase-keys',
          title: 'Supabase 키 미설정',
          severity: 'critical',
          category: 'environment',
          action: 'Supabase 연결 키를 설정하세요.',
          source: 'run_daily',
          commandSnippet: 'SUPABASE_SERVICE_ROLE_KEY="super-secret-supabase-role"',
        },
        {
          id: 'openai-secret',
          title: 'OpenAI 키 미설정',
          severity: 'high',
          category: 'provider-key',
          action: 'OpenAI 서버 키를 설정하세요.',
          source: 'provider-key',
          commandSnippet: 'OPENAI_API_KEY="openai-super-secret-key"',
        },
        {
          id: 'run-daily-script-missing',
          title: 'run_daily 미감지',
          severity: 'high',
          category: 'environment',
          action: 'run_daily 스크립트를 배치하세요.',
          source: 'run_daily',
          commandSnippet: 'RUN_DAILY_SCRIPT_PATH="${RUN_DAILY_SCRIPT_PATH:-/path/to/backend/run_daily.sh}"',
        },
        {
          id: 'provider-key-anthropic-low',
          title: 'Anthropic 키 미설정',
          severity: 'low',
          category: 'provider-key',
          action: 'Anthropic 서버 키를 설정하세요.',
          source: 'provider-key',
          commandSnippet: 'ANTHROPIC_API_KEY="anthropic-super-secret-key"',
        },
      ],
    };

    const moduleId = `@/lib/insight/chat?ops-status-redacted-${Date.now()}-${Math.random()}`;
    mock.module('@/lib/insight/chat-system-status', () => ({
      getAdminInsightSystemStatus: async () => status,
    }));

    const { answerAdminInsightChat: mockedAnswer } = await import(moduleId);
    const response = await mockedAnswer('/ops-status');

    expect(response.meta?.source).toBe('local');
    expect(response.content).toContain('### 운영 명령 스니펫');
    expect(response.content).not.toContain('super-secret-supabase-role');
    expect(response.content).not.toContain('openai-super-secret-key');
    expect(response.content).toContain('<REDACTED>');
    expect(response.content).toContain('OPENAI_API_KEY="<REDACTED>"');
    expect(response.content).toContain('SUPABASE_SERVICE_ROLE_KEY="<REDACTED>"');
    expect((response.content.match(/```bash/g) || []).length).toBeLessThanOrEqual(3);
  });

  test('returns ops status summary for /system-status and Korean alias', async () => {
    const prevEnv = {
      cacheTtl: process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS,
      storyboardEnabled: process.env.STORYBOARD_AGENT_ENABLED,
      storyboardApiUrl: process.env.STORYBOARD_AGENT_API_URL,
      bgeEnabled: process.env.STORYBOARD_BGE_ENABLED,
      bgeUrl: process.env.STORYBOARD_BGE_EMBEDDING_URL,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      nanoBanana2Key: process.env.NANO_BANANA_2_API_KEY,
      runDaily: process.env.RUN_DAILY_SCRIPT_PATH,
    };

    process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
    process.env.STORYBOARD_AGENT_ENABLED = 'true';
    process.env.STORYBOARD_AGENT_API_URL = 'https://board.example/internal/agent';
    process.env.STORYBOARD_BGE_ENABLED = 'true';
    process.env.STORYBOARD_BGE_EMBEDDING_URL = 'https://bge.example/internal/embeddings';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.NANO_BANANA_2_API_KEY = 'nanobanana-key';
    delete process.env.RUN_DAILY_SCRIPT_PATH;

    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const endpoint = String(input);
      if (endpoint.includes('/health') || endpoint.includes('embeddings')) {
        return new Response('', { status: 204 });
      }
      return new Response('', { status: 500 });
    };

    try {
      const commandResponse = await answerAdminInsightChat('/system-status');
      const phraseResponse = await answerAdminInsightChat('운영 상태 점검해줘');

      for (const response of [commandResponse, phraseResponse]) {
        expect(response.meta?.source).toBe('local');
        expect(response.meta?.toolTrace ?? []).toContain('local:ops-status');
        expect(response.content).toContain('## 운영 상태 요약');
        expect(response.content).toContain('- run_daily: 점검 필요');
        expect(response.content).toContain('- 키 준비 상태:');
      }
      expect(phraseResponse.content).toContain('- Storyboard:');
      expect(phraseResponse.content).toContain('- BGE 임베딩:');
    } finally {
      global.fetch = originalFetch;
      if (prevEnv.cacheTtl === undefined) {
        delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
      } else {
        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevEnv.cacheTtl;
      }
      if (prevEnv.storyboardEnabled === undefined) {
        delete process.env.STORYBOARD_AGENT_ENABLED;
      } else {
        process.env.STORYBOARD_AGENT_ENABLED = prevEnv.storyboardEnabled;
      }
      if (prevEnv.storyboardApiUrl === undefined) {
        delete process.env.STORYBOARD_AGENT_API_URL;
      } else {
        process.env.STORYBOARD_AGENT_API_URL = prevEnv.storyboardApiUrl;
      }
      if (prevEnv.bgeEnabled === undefined) {
        delete process.env.STORYBOARD_BGE_ENABLED;
      } else {
        process.env.STORYBOARD_BGE_ENABLED = prevEnv.bgeEnabled;
      }
      if (prevEnv.bgeUrl === undefined) {
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
      } else {
        process.env.STORYBOARD_BGE_EMBEDDING_URL = prevEnv.bgeUrl;
      }
      if (prevEnv.supabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv.supabaseUrl;
      }
      if (prevEnv.supabaseServiceRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.supabaseServiceRoleKey;
      }
      if (prevEnv.nanoBanana2Key === undefined) {
        delete process.env.NANO_BANANA_2_API_KEY;
      } else {
        process.env.NANO_BANANA_2_API_KEY = prevEnv.nanoBanana2Key;
      }
      if (prevEnv.runDaily === undefined) {
        delete process.env.RUN_DAILY_SCRIPT_PATH;
      } else {
        process.env.RUN_DAILY_SCRIPT_PATH = prevEnv.runDaily;
      }
    }
  });
});
