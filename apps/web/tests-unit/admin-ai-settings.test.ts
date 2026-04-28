import { beforeEach, describe, expect, mock, test } from 'bun:test';

const requireAdminOk = {
  ok: true as const,
  userId: 'admin-user',
};

const mockPayload = {
  settings: {
    routingMode: 'manual' as const,
    manualProvider: 'nvidia_nim' as const,
    manualModel: 'nvidia/nemotron-nano-12b-v2-vl',
    candidateModels: [
      {
        id: 'nvidia_nim:nvidia/nemotron-nano-12b-v2-vl',
        provider: 'nvidia_nim' as const,
        model: 'nvidia/nemotron-nano-12b-v2-vl',
        label: 'NVIDIA NIM 기본 OCR 모델',
      },
    ],
    updatedAt: '2026-04-25T00:00:00.000Z',
    updatedByAdminId: 'admin-user',
    persisted: true,
  },
  providers: [
    {
      provider: 'gemini' as const,
      hasStoredKey: true,
      hasEnvKey: false,
      source: 'database' as const,
      maskedSecret: '••••••••1234',
      updatedAt: '2026-04-25T00:00:00.000Z',
      updatedByAdminId: 'admin-user',
    },
    {
      provider: 'openai' as const,
      hasStoredKey: false,
      hasEnvKey: true,
      source: 'environment' as const,
      maskedSecret: '••••••••9999',
      updatedAt: null,
      updatedByAdminId: null,
    },
    {
      provider: 'nvidia_nim' as const,
      hasStoredKey: false,
      hasEnvKey: false,
      source: 'none' as const,
      maskedSecret: null,
      updatedAt: null,
      updatedByAdminId: null,
    },
  ],
  storage: {
    serviceRoleConfigured: true,
    databaseConfigured: true,
  },
  promotionGate: {
    ok: false,
    reasons: ['requires at least 10 validated gold fixtures'],
    fixtureCount: 1,
    koreanRestaurantFixtureCount: 1,
  },
};

beforeEach(() => {
  mock.restore();
});

describe('admin ai settings store helpers', () => {
  test('masks secrets and sanitizes duplicate candidate models', async () => {
    const { maskSecret, sanitizeSettingsInput } = await import('@/lib/admin/ai-settings-store');

    expect(maskSecret('sk-test-abcdef1234')).toBe('••••••••1234');
    expect(maskSecret('')).toBeNull();

    const settings = sanitizeSettingsInput({
      routingMode: 'manual',
      manualProvider: 'gemini',
      manualModel: 'gemini-3-flash-preview',
      candidateModels: [
        { provider: 'gemini', model: 'gemini-3-flash-preview', label: 'Gemini' },
        { provider: 'gemini', model: 'gemini-3-flash-preview', label: 'Gemini Duplicate' },
        { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
        { provider: 'nope', model: 'bad', label: 'Ignored' },
      ],
    });

    expect(settings.routingMode).toBe('manual');
    expect(settings.manualProvider).toBe('gemini');
    expect(settings.manualModel).toBe('gemini-3-flash-preview');
    expect(settings.candidateModels).toHaveLength(1);
    expect(settings.candidateModels[0]).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
    });
    expect(settings.candidateModels.every((candidate) => candidate.provider !== 'openai')).toBe(true);
  });



  test('defaults OCR routing to Gemini baseline before NVIDIA NIM experiments', async () => {
    const { resolveOcrAiRuntimeConfig, sanitizeSettingsInput } = await import(`@/lib/admin/ai-settings-store?case=${Math.random()}`);

    const settings = sanitizeSettingsInput({}, {} as NodeJS.ProcessEnv);
    expect(settings.manualProvider).toBe('gemini');
    expect(settings.manualModel).toBe('gemini-3-flash-preview');
    expect(settings.candidateModels[0]).toMatchObject({ provider: 'gemini', model: 'gemini-3-flash-preview' });

    const runtime = await resolveOcrAiRuntimeConfig({ GEMINI_OCR_YEON: 'gemini-key' } as NodeJS.ProcessEnv);
    expect(runtime).toMatchObject({
      routingMode: 'automatic',
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      source: 'environment',
    });
    expect(runtime.apiKey).toBe('gemini-key');
  });





  test('keeps multiple Gemini environment credentials so automatic mode can skip an invalid first key', async () => {
    const { getEnvFallbackSecrets, resolveOcrAiRuntimeConfig } = await import(`@/lib/admin/ai-settings-store?case=${Math.random()}`);
    const env = {
      GEMINI_OCR_YEON: 'invalid-first-gemini-key',
      GEMINI_API_KEY_BYEON: 'valid-byeon-gemini-key',
      NVIDIA_NIM_API_KEY: 'nvapi-fallback-key',
    } as NodeJS.ProcessEnv;

    expect(getEnvFallbackSecrets('gemini', env).map((entry) => entry.sourceName)).toEqual([
      'GEMINI_OCR_YEON',
      'GEMINI_API_KEY_BYEON',
    ]);

    const runtime = await resolveOcrAiRuntimeConfig(env);
    expect(runtime.credentialCandidates.map((entry) => entry.sourceName)).toEqual([
      'GEMINI_OCR_YEON',
      'GEMINI_API_KEY_BYEON',
    ]);
    expect(runtime.fallbackCandidates[0].provider).toBe('nvidia_nim');
  });

  test('automatic OCR runtime keeps NIM as outage fallback after Gemini primary', async () => {
    const { resolveOcrAiRuntimeConfig } = await import(`@/lib/admin/ai-settings-store?case=${Math.random()}`);
    const runtime = await resolveOcrAiRuntimeConfig({
      GEMINI_OCR_YEON: 'bad-or-good-gemini-key',
      NVIDIA_NIM_API_KEY: 'nvapi-fallback-key',
      NVIDIA_NIM_OCR_MODEL: 'nim-fallback-model',
    } as NodeJS.ProcessEnv);

    expect(runtime.provider).toBe('gemini');
    expect(runtime.model).toBe('gemini-3-flash-preview');
    expect(runtime.fallbackCandidates).toHaveLength(1);
    expect(runtime.fallbackCandidates[0]).toMatchObject({
      provider: 'nvidia_nim',
      model: 'nim-fallback-model',
      apiKey: 'nvapi-fallback-key',
      source: 'environment',
    });
  });

  test('uses env fallback when service role is unavailable', async () => {
    const previous = {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      GEMINI_OCR_YEON: process.env.GEMINI_OCR_YEON,
    };

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.GEMINI_OCR_YEON = 'gemini-secret-9876';

    try {
      const { getAdminAiSettings } = await import(`@/lib/admin/ai-settings-store?case=${Math.random()}`);
      const payload = await getAdminAiSettings();
      expect(payload.storage.serviceRoleConfigured).toBe(false);
      expect(payload.promotionGate).toMatchObject({
        ok: false,
        fixtureCount: 1,
        koreanRestaurantFixtureCount: 1,
      });
      expect(payload.providers.find((entry) => entry.provider === 'gemini')).toMatchObject({
        hasEnvKey: true,
        source: 'environment',
        maskedSecret: '••••••••9876',
      });
      expect(JSON.stringify(payload)).not.toContain('gemini-secret-9876');
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previous.NEXT_PUBLIC_SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = previous.SUPABASE_SERVICE_ROLE_KEY;
      process.env.GEMINI_OCR_YEON = previous.GEMINI_OCR_YEON;
    }
  });

  test('encrypts stored provider secrets and keeps legacy plaintext readable', async () => {
    const {
      decryptStoredProviderSecret,
      encryptStoredProviderSecret,
      maskSecret,
    } = await import('@/lib/admin/ai-settings-store');
    const env = { AI_SETTINGS_ENCRYPTION_KEY: 'unit-test-encryption-key' } as NodeJS.ProcessEnv;
    const secret = 'nvapi-unit-secret-1234';

    const encrypted = encryptStoredProviderSecret(secret, env);
    expect(encrypted).toStartWith('enc:v1:');
    expect(encrypted).not.toContain(secret);
    expect(decryptStoredProviderSecret(encrypted, env)).toBe(secret);
    expect(decryptStoredProviderSecret('legacy-plaintext-5678', env)).toBe('legacy-plaintext-5678');
    expect(maskSecret(decryptStoredProviderSecret(encrypted, env))).toBe('••••••••1234');
  });
});

describe('admin ai settings routes', () => {
  test('GET returns masked settings bundle only for admins', async () => {
    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => requireAdminOk,
    }));
    mock.module('@/lib/admin/ai-settings-store', () => ({
      getAdminAiSettings: async () => mockPayload,
      saveAdminAiSettings: async () => mockPayload,
    }));

    const { GET } = await import(`@/app/api/admin/ai-settings/route?case=${Math.random()}`);
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.providers[0].maskedSecret).toBe('••••••••1234');
    expect(JSON.stringify(data)).not.toContain('sk-live-secret');
  });

  test('PUT provider key route validates provider and returns masked summary', async () => {
    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => requireAdminOk,
    }));
    mock.module('@/lib/admin/ai-settings-store', () => ({
      parseProviderParam: (value: string) => (value === 'gemini' ? 'gemini' : null),
      upsertProviderApiKey: async () => mockPayload.providers[0],
      deleteProviderApiKey: async () => mockPayload.providers[2],
    }));

    const routeModule = await import(`@/app/api/admin/ai-settings/keys/[provider]/route?case=${Math.random()}`);
    const putResponse = await routeModule.PUT(
      new Request('http://localhost/api/admin/ai-settings/keys/gemini', {
        method: 'PUT',
        body: JSON.stringify({ secret: 'sk-live-secret-1234' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ provider: 'gemini' }) },
    );
    const putData = await putResponse.json();

    expect(putResponse.status).toBe(200);
    expect(putData).toMatchObject({
      provider: 'gemini',
      maskedSecret: '••••••••1234',
      source: 'database',
    });
    expect(JSON.stringify(putData)).not.toContain('sk-live-secret-1234');

    const badResponse = await routeModule.PUT(
      new Request('http://localhost/api/admin/ai-settings/keys/nope', {
        method: 'PUT',
        body: JSON.stringify({ secret: 'ignored' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ provider: 'nope' }) },
    );

    expect(badResponse.status).toBe(400);
  });
});

describe('admin ocr quota helpers', () => {
  function createCountQuery(count: number) {
    const query = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { count: number; error: null }) => unknown) => Promise.resolve({ count, error: null }).then(resolve),
    };
    return query;
  }

  function createRoleQuery(isAdmin: boolean) {
    const query = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      maybeSingle: async () => ({ data: isAdmin ? { role: 'admin' } : null, error: null }),
    };
    return query;
  }

  test('keeps admin users on unlimited OCR quota while still reporting used count', async () => {
    const { getOcrQuotaStatus } = await import('@/lib/ocr/quota');
    const logsClient = { from: () => createCountQuery(9) } as never;
    const roleClient = { from: () => createRoleQuery(true) } as never;

    const quota = await getOcrQuotaStatus({
      userId: 'admin-user',
      logsClient,
      roleClient,
      now: new Date('2026-04-25T12:34:00.000Z'),
      env: {},
    });

    expect(quota).toMatchObject({
      used: 9,
      max: null,
      remaining: null,
      unlimited: true,
      resetAt: '2026-04-26T00:00:00.000Z',
    });
  });

  test('enforces the regular daily OCR quota for non-admin users', async () => {
    const { checkOcrDailyQuota, OCR_DAILY_QUOTA } = await import('@/lib/ocr/quota');
    const logsClient = { from: () => createCountQuery(OCR_DAILY_QUOTA) } as never;
    const roleClient = { from: () => createRoleQuery(false) } as never;

    const quota = await checkOcrDailyQuota({
      userId: 'member-user',
      logsClient,
      roleClient,
      now: new Date('2026-04-25T12:34:00.000Z'),
      env: {},
    });

    expect(quota).toMatchObject({
      used: OCR_DAILY_QUOTA,
      max: OCR_DAILY_QUOTA,
      remaining: 0,
      unlimited: false,
      exceeded: true,
    });
  });

  test('allows OCR force refresh only in development or for admins', async () => {
    const {
      canForceRefreshOcr,
      isOcrForceRefreshAllowedInEnvironment,
      isOcrForceRefreshRequested,
    } = await import('@/lib/ocr/quota');

    const formData = new FormData();
    formData.set('force', '1');
    expect(isOcrForceRefreshRequested({ formData })).toBe(true);
    expect(isOcrForceRefreshAllowedInEnvironment({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isOcrForceRefreshAllowedInEnvironment({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);

    await expect(canForceRefreshOcr({
      userId: 'admin-user',
      roleClient: { from: () => createRoleQuery(true) } as never,
      env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv,
    })).resolves.toBe(true);

    await expect(canForceRefreshOcr({
      userId: 'member-user',
      roleClient: { from: () => createRoleQuery(false) } as never,
      env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv,
    })).resolves.toBe(false);
  });
});

describe('arena leaderboard routing helpers', () => {
  test('maps Arena.ai vision rows to NVIDIA NIM candidates conservatively', async () => {
    const { buildArenaNimCandidates, fetchArenaLeaderboardSnapshot } = await import('@/lib/admin/ai-leaderboard');

    const candidates = buildArenaNimCandidates([
      { model_name: 'claude-opus-4-6-thinking', rank: 1, rating: 1500, vote_count: 1000, category: 'overall', leaderboard_publish_date: '2026-04-23' },
      { model_name: 'glm-4.7', rank: 6, rating: 1444, vote_count: 3651, category: 'overall', leaderboard_publish_date: '2026-04-23' },
      { model_name: 'glm-4.7', rank: 7, rating: 1400, vote_count: 10, category: 'overall', leaderboard_publish_date: '2026-04-23' },
      { model_name: 'kimi-k2-thinking', rank: 10, rating: 1390, vote_count: 500, category: 'overall', leaderboard_publish_date: '2026-04-23' },
      { model_name: 'glm-4.7', rank: 1, rating: 1600, vote_count: 1, category: 'style_control', leaderboard_publish_date: '2026-04-23' },
    ]);

    expect(candidates.map((candidate) => candidate.model)).toEqual([
      'z-ai/glm-4.7',
      'moonshotai/kimi-k2-thinking',
    ]);
    expect(candidates[0]).toMatchObject({
      provider: 'nvidia_nim',
      arenaRank: 6,
      arenaRating: 1444,
      voteCount: 3651,
    });

    const responsePayload = {
      rows: [
        { row: { model_name: 'minimax-m2.1-preview', rank: 8, rating: 1432, vote_count: 5259, category: 'overall', leaderboard_publish_date: '2026-04-23' } },
      { row: { model_name: 'kimi-k2.6', rank: 9, rating: 1400, vote_count: 1000, category: 'overall', leaderboard_publish_date: '2026-04-23' } },
      ],
      truncated: false,
    };
    const snapshot = await fetchArenaLeaderboardSnapshot({
      now: new Date('2026-04-25T00:00:00.000Z'),
      fetchImpl: (async () => new Response(JSON.stringify(responsePayload), { status: 200 })) as typeof fetch,
    });

    expect(snapshot.candidates.map((candidate) => candidate.model)).toEqual(['minimaxai/minimax-m2.1-preview']);
    expect(JSON.stringify(snapshot.payload)).toContain('lmarena-ai/leaderboard-dataset');
  });
});

describe('admin OCR production promotion gate enforcement', () => {
  test('blocks manual OCR routing changes until the evaluation gate is satisfied', async () => {
    const {
      assertAdminAiSettingsPromotionAllowed,
      sanitizeSettingsInput,
    } = await import(`@/lib/admin/ai-settings-store?case=${Math.random()}`);
    const env = {} as NodeJS.ProcessEnv;
    const defaults = sanitizeSettingsInput({}, env);
    const next = sanitizeSettingsInput({
      routingMode: 'manual',
      manualProvider: 'nvidia_nim',
      manualModel: 'meta/llama-4-maverick-17b-128e-instruct',
      candidateModels: [
        { provider: 'nvidia_nim', model: 'meta/llama-4-maverick-17b-128e-instruct', label: 'NIM Maverick' },
      ],
    }, env);

    expect(() => assertAdminAiSettingsPromotionAllowed({ next, defaults, acknowledged: true }))
      .toThrow('OCR 모델 라우팅/프로덕션 기본값 변경은 평가 게이트 통과 후에만 저장할 수 있습니다.');
  });

  test('allows the current default Gemini OCR routing settings without promotion evidence', async () => {
    const {
      assertAdminAiSettingsPromotionAllowed,
      sanitizeSettingsInput,
    } = await import(`@/lib/admin/ai-settings-store?case=${Math.random()}`);
    const defaults = sanitizeSettingsInput({}, {} as NodeJS.ProcessEnv);

    expect(() => assertAdminAiSettingsPromotionAllowed({ next: defaults, defaults })).not.toThrow();
  });
});
