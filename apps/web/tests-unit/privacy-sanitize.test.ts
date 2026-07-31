import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import {
  PrivacyUnsafeValueError,
  assertPrivacySafe,
  sanitizePrivacyValue,
} from '../lib/privacy/sanitize';
const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('privacy sanitizer', () => {
  test('redacts nested sensitive values without retaining their raw matches', () => {
    const rrn = '900101-1234567';
    const email = 'person@example.com';
    const phone = '010-1234-5678';
    const credential = 'password=not-for-a-sink';
    const token = 'Bearer not-for-a-sink';
    const rawOcr = '원본 OCR 문장';
    const result = sanitizePrivacyValue({
      envelope: {
        contact: { email },
        phone,
        연락처: phone,
        credentials: { value: credential },
        header: token,
        evidence: { rawOcr },
        devicePosition: { latitude: 37.5665, longitude: 126.978 },
        rrn,
      },
        [email]: 'sensitive property name',
    });
    const rendered = JSON.stringify(result);

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'rrn',
        'email',
        'phone',
        'credential',
        'token',
        'raw_ocr',
        'precise_location',
      ]),
    );
    expect(result.findings.every(({ count, kind, path }) => (
      typeof kind === 'string' && typeof path === 'string' && Number.isInteger(count)
    ))).toBe(true);
    for (const rawValue of [rrn, email, phone, credential, token, rawOcr, '37.5665', '126.978']) {
      expect(rendered).not.toContain(rawValue);
    }
  });
  test('redacts auth cookies, opaque session values, and provider diagnostics', () => {
    const authorization = 'Bearer authorization-secret';
    const cookie = 'sb-session=opaque-cookie-value';
    const setCookie = 'sb-session=opaque-set-cookie-value; HttpOnly';
    const challenge = 'opaque-challenge-value';
    const accessToken = 'opaque-access-token';
    const refreshToken = 'opaque-refresh-token';
    const password = 'not-for-a-sink';
    const email = 'person@example.com';
    const rrn = '900101-5234567';
    const clientSecret = 'opaque-client-secret';
    const serviceRole = 'opaque-service-role';
    const privateKey = 'opaque-private-key';
    const session = 'opaque-session-value';
    const onboarding = 'opaque-onboarding-value';
    const message = 'provider message must not reach a sink';
    const details = 'provider details must not reach a sink';
    const hint = 'provider hint must not reach a sink';
    const stack = 'provider stack must not reach a sink';

    const result = sanitizePrivacyValue({
      nested: {
        headers: {
          Authorization: authorization,
          Cookie: cookie,
          'Set-Cookie': setCookie,
        },
        recovery: {
          challenge,
          access_token: accessToken,
          refresh_token: refreshToken,
          password,
          email,
          rrn,
          session,
          onboarding_state: onboarding,
        },
        provider: {
          client_secret: clientSecret,
          service_role_key: serviceRole,
          private_key: privateKey,
        },
        error: { message, details, hint, stack },
      },
    });
    const rendered = JSON.stringify(result);

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'rrn',
        'email',
        'credential',
        'token',
        'cookie',
        'session',
        'diagnostic',
      ]),
    );
    for (const rawValue of [
      authorization,
      cookie,
      setCookie,
      challenge,
      accessToken,
      refreshToken,
      password,
      email,
      rrn,
      clientSecret,
      serviceRole,
      privateKey,
      session,
      onboarding,
      message,
      details,
      hint,
      stack,
    ]) {
      expect(rendered).not.toContain(rawValue);
    }
  });

  test('uses fixed auth and profile diagnostics instead of raw errors or messages', () => {
    const authContextSource = source('contexts/AuthContext.tsx');
    const resetPasswordSource = source('app/auth/reset-password/page.tsx');
    const profilePageSource = source('app/mypage/profile/page.tsx');
    const profileModalSource = source('components/profile/ProfileModal.tsx');
    const mypageSidebarSource = source('components/mypage/MyPageSidebar.tsx');
    const debugLogSource = source('lib/debug-log.ts');
    const ocrExtractSource = source('app/api/ocr/extract/route.ts');
    const submissionSources = [
      source('components/admin/AdminRestaurantModal.tsx'),
      source('components/admin/SubmissionDetailView.tsx'),
      source('components/modals/RestaurantSubmissionModal.tsx'),
      source('components/reviews/ReviewEditModal.tsx'),
      source('components/reviews/ReviewModal.tsx'),
    ];

    expect(authContextSource).toContain('DEBUG_LOG_EVENT.AUTH_PROFILE_LOOKUP_FAILED');
    expect(authContextSource).toContain('DEBUG_LOG_EVENT.AUTH_SESSION_REFRESH_FAILED');
    expect(authContextSource).toContain('DEBUG_LOG_EVENT.AUTH_SESSION_LOAD_FAILED');
    expect(authContextSource).not.toContain('console.error(');
    expect(resetPasswordSource).toContain(
      'DEBUG_LOG_EVENT.PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED',
    );
    expect(resetPasswordSource).toContain('DEBUG_LOG_EVENT.PASSWORD_UPDATE_FAILED');
    expect(resetPasswordSource).toContain(
      "toast.error('비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.');",
    );
    expect(resetPasswordSource).not.toContain('console.error(');
    expect(resetPasswordSource).not.toContain('error instanceof Error');
    expect(resetPasswordSource).not.toContain('toast.error(errorMessage)');
    expect(debugLogSource).toContain('sanitizePrivacyValue(metadata');
    expect(debugLogSource).toContain('DEBUG_LOG_EVENT.DEBUG_EVENT_REJECTED');
    expect(debugLogSource).not.toContain('console.log(...');
    expect(ocrExtractSource).toContain("const failureMetadata = { error_code: failureCode, provider: failureProvider }");
    expect(ocrExtractSource).not.toContain('getErrorMessage(');
    expect(ocrExtractSource).not.toContain('error.attempts');
    expect(ocrExtractSource).not.toContain('metadata: { error:');
    for (const submissionSource of submissionSources) {
      expect(submissionSource).not.toMatch(/toast\.error\([^)]*\.message/);
      expect(submissionSource).not.toMatch(/throw new Error\([^)]*\.message/);
      expect(submissionSource).not.toMatch(/console\.(?:log|warn|error)\([^)]*,\s*(?:error|err)\b/);
    }
    for (const profileSource of [profilePageSource, profileModalSource, mypageSidebarSource]) {
      expect(profileSource).not.toContain('console.');
      expect(profileSource).not.toContain('error instanceof Error');
      expect(profileSource).not.toContain('toast.error(errorMessage)');
      expect(profileSource).not.toContain('err.message');
    }
  });

  test('bounds depth, entries, strings, cyclic values, and invalid limits', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    const result = sanitizePrivacyValue({
      first: 'kept',
      nested: { tooDeep: { secret: 'password=not-for-a-sink' } },
      cyclic,
      oversized: 'x'.repeat(12),
      omitted: 'not-visited',
    }, {
      maxDepth: 1,
      maxEntries: 4,
      maxStringLength: 8,
    });

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['bounded_value']),
    );
    expect(JSON.stringify(result)).not.toContain('password=not-for-a-sink');

    const invalidLimitResult = sanitizePrivacyValue(
      { nested: { value: 'kept' } },
      { maxDepth: Number.NaN, maxEntries: Number.POSITIVE_INFINITY },
    );
    expect(invalidLimitResult.findings.map((finding) => finding.kind)).toContain(
      'bounded_value',
    );
  });
  test('hard-clamps hostile overrides and stops deep, wide, oversized, shared, cyclic, and accessor input', () => {
    const deep: { next?: unknown } = {};
    let cursor = deep;
    for (let index = 0; index < 80; index += 1) {
      const next: { next?: unknown } = {};
      cursor.next = next;
      cursor = next;
    }

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const shared = { access_token: 'shared-token-must-not-reach-a-sink' };
    let getterWasCalled = false;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'session', {
      enumerable: true,
      get: () => {
        getterWasCalled = true;
        return 'accessor-session-must-not-reach-a-sink';
      },
    });

    const hugeFiniteLimits = {
      maxDepth: Number.MAX_SAFE_INTEGER,
      maxEntries: Number.MAX_SAFE_INTEGER,
      maxStringLength: Number.MAX_SAFE_INTEGER,
    };
    const deepResult = sanitizePrivacyValue(deep, hugeFiniteLimits);
    const wideResult = sanitizePrivacyValue(
      Array.from({ length: 10_000 }, () => 'bounded-wide-value'),
      hugeFiniteLimits,
    );
    const oversizedResult = sanitizePrivacyValue(
      'x'.repeat(8_192),
      hugeFiniteLimits,
    );
    const graphResult = sanitizePrivacyValue(
      { first: shared, second: shared, cyclic, accessor },
      hugeFiniteLimits,
    );

    for (const result of [deepResult, wideResult, oversizedResult, graphResult]) {
      expect(result.findings.map((finding) => finding.kind)).toContain('bounded_value');
    }
    expect(getterWasCalled).toBe(false);
    expect(JSON.stringify(graphResult)).not.toContain('shared-token-must-not-reach-a-sink');
    expect(JSON.stringify(graphResult)).not.toContain('accessor-session-must-not-reach-a-sink');

    for (const limits of [
      {
        maxDepth: Number.POSITIVE_INFINITY,
        maxEntries: Number.POSITIVE_INFINITY,
        maxStringLength: Number.POSITIVE_INFINITY,
      },
      { maxDepth: -1, maxEntries: -1, maxStringLength: -1 },
    ]) {
      const result = sanitizePrivacyValue({ nested: { value: 'kept' } }, limits);
      expect(result.findings.map((finding) => finding.kind)).toContain('bounded_value');
    }
  });
  test('truncates aggregate input and output before wide safe strings can exceed byte budgets', () => {
    const safeChunk = 'a'.repeat(4_096);
    const result = sanitizePrivacyValue(
      { entries: Array.from({ length: 100 }, () => safeChunk) },
      {
        maxDepth: Number.MAX_SAFE_INTEGER,
        maxEntries: Number.MAX_SAFE_INTEGER,
        maxStringLength: Number.MAX_SAFE_INTEGER,
      },
    );

    expect(result.findings.map((finding) => finding.kind)).toContain('bounded_value');
    expect(JSON.stringify(result.value)).toContain('[REDACTED:bounded_value]');
  });
  test('rejects omitted secrets after output capacity is exhausted', () => {
    const password = 'output-ceiling-password-must-not-reach-a-sink';
    const result = sanitizePrivacyValue({
      entries: Array.from({ length: 4 }, () => 'a'.repeat(4_096)),
      password,
    });
    const rendered = JSON.stringify(result);

    expect(result.findings.map((finding) => finding.kind)).toContain('bounded_value');
    expect(result.findings.map((finding) => finding.kind)).not.toContain('credential');
    expect(rendered).not.toContain(password);
    expect(() => assertPrivacySafe({
      entries: Array.from({ length: 4 }, () => 'a'.repeat(4_096)),
      password,
    })).toThrow(PrivacyUnsafeValueError);
  });
  test('inventories non-enumerable, symbol, and array expando secrets without retaining them', () => {
    const password = 'non-enumerable-password-must-not-reach-a-sink';
    const symbolToken = 'symbol-token-must-not-reach-a-sink';
    const expandoToken = 'array-expando-token-must-not-reach-a-sink';
    const tokenKey = Symbol('access_token');
    const array: unknown[] = [];
    const source: { array: unknown[] } = { array };

    Object.defineProperty(source, 'password', {
      enumerable: false,
      value: password,
    });
    Object.defineProperty(source, tokenKey, {
      enumerable: false,
      value: symbolToken,
    });
    Object.defineProperty(array, 'access_token', {
      enumerable: true,
      value: expandoToken,
    });

    const result = sanitizePrivacyValue(source);
    const rendered = JSON.stringify(result);

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['credential', 'token', 'bounded_value']),
    );
    for (const rawValue of [password, symbolToken, expandoToken]) {
      expect(rendered).not.toContain(rawValue);
    }
    expect(() => assertPrivacySafe(source)).toThrow(PrivacyUnsafeValueError);
  });
  test('inspects non-enumerable accessor descriptors without invoking their getters', () => {
    let getterWasCalled = false;
    const accessorValue: Record<string, unknown> = {};

    Object.defineProperty(accessorValue, 'password', {
      enumerable: false,
      get: () => {
        getterWasCalled = true;
        return 'getter-password-must-not-reach-a-sink';
      },
    });

    const result = sanitizePrivacyValue(accessorValue);

    expect(getterWasCalled).toBe(false);
    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['credential', 'bounded_value']),
    );
    expect(JSON.stringify(result)).not.toContain('getter-password-must-not-reach-a-sink');
    expect(() => assertPrivacySafe(accessorValue)).toThrow(PrivacyUnsafeValueError);
  });
  test('rejects proxy containers before hostile ownKeys materializes an unbounded key list', () => {
    let ownKeysCalls = 0;
    let materializedKeys = 0;
    const hostile = new Proxy({}, {
      ownKeys: () => {
        ownKeysCalls += 1;
        const keys = Array.from({ length: 100_000 }, (_, index) => `key_${index}`);
        materializedKeys += keys.length;
        return keys;
      },
    });

    const result = sanitizePrivacyValue(hostile);

    expect(ownKeysCalls).toBe(0);
    expect(materializedKeys).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([{ kind: 'bounded_value', path: '$', count: 1 }]),
    );
    expect(() => assertPrivacySafe(hostile)).toThrow(PrivacyUnsafeValueError);
    expect(ownKeysCalls).toBe(0);
    expect(materializedKeys).toBe(0);
  });
  test('keeps browser JSON-data sanitization available without a native proxy detector', () => {
    const processLike = (globalThis as { process?: object }).process;
    if (!processLike) throw new Error('test runtime must expose process');

    const detectorDescriptor = Object.getOwnPropertyDescriptor(
      processLike,
      'getBuiltinModule',
    );
    Object.defineProperty(processLike, 'getBuiltinModule', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      const safeValue = { nested: ['browser-safe-value', { count: 1 }] };
      const exoticSecret = 'exotic-access-token-must-not-reach-a-sink';
      const exotic = Object.create({}) as Record<string, unknown>;
      exotic.access_token = exoticSecret;
      let getterWasCalled = false;
      const accessorSecret = 'accessor-token-must-not-reach-a-sink';
      const accessorContainer: Record<string, unknown> = {};

      Object.defineProperty(accessorContainer, 'access_token', {
        enumerable: true,
        get: () => {
          getterWasCalled = true;
          return accessorSecret;
        },
      });

      expect(sanitizePrivacyValue(safeValue)).toEqual({
        findings: [],
        value: safeValue,
      });
      expect(() => assertPrivacySafe(safeValue)).not.toThrow();

      const exoticResult = sanitizePrivacyValue(exotic);
      const accessorResult = sanitizePrivacyValue(accessorContainer);
      const rendered = JSON.stringify([exoticResult, accessorResult]);

      expect(exoticResult.findings).toEqual(
        expect.arrayContaining([{ kind: 'bounded_value', path: '$', count: 1 }]),
      );
      expect(accessorResult.findings.map((finding) => finding.kind)).toEqual(
        expect.arrayContaining(['token', 'bounded_value']),
      );
      expect(getterWasCalled).toBe(false);
      expect(rendered).not.toContain(exoticSecret);
      expect(rendered).not.toContain(accessorSecret);
      expect(() => assertPrivacySafe(exotic)).toThrow(PrivacyUnsafeValueError);
      expect(() => assertPrivacySafe(accessorContainer)).toThrow(PrivacyUnsafeValueError);
    } finally {
      if (detectorDescriptor) {
        Object.defineProperty(processLike, 'getBuiltinModule', detectorDescriptor);
      } else {
        delete (processLike as { getBuiltinModule?: unknown }).getBuiltinModule;
      }
    }
  });
  test('does not invoke sensitive accessors while sanitizing', () => {
    let getterWasCalled = false;
    const accessorValue: Record<string, unknown> = {};
    Object.defineProperty(accessorValue, 'session', {
      enumerable: true,
      get: () => {
        getterWasCalled = true;
        return 'opaque-accessor-session';
      },
    });

    const result = sanitizePrivacyValue(accessorValue);

    expect(getterWasCalled).toBe(false);
    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['session', 'bounded_value']),
    );
    expect(JSON.stringify(result)).not.toContain('opaque-accessor-session');
  });

  test('keeps business coordinates distinct from device coordinates', () => {
    const business = { latitude: 37.5665, longitude: 126.978 };

    expect(sanitizePrivacyValue(business, { locationClass: 'business' })).toEqual({
      findings: [],
      value: business,
    });
    expect(
      sanitizePrivacyValue(business).findings.map((finding) => finding.kind),
    ).toEqual(expect.arrayContaining(['precise_location']));
  });
  test('redacts coordinate-bearing device containers but keeps only explicit business opt-in', () => {
    const deviceLocation = {
      nested: {
        coords: [90, 180],
        coordinates: { latitude: -90, longitude: -180 },
        position: { x: 126.978, y: 37.5665 },
        devicePosition: { currentPosition: { coords: [37.5665, 126.978] } },
        currentCoordinates: [-90, -180],
      },
    };
    const renderedDeviceResult = JSON.stringify(sanitizePrivacyValue(deviceLocation));

    expect(
      sanitizePrivacyValue(deviceLocation).findings.map((finding) => finding.kind),
    ).toEqual(expect.arrayContaining(['precise_location']));
    for (const coordinate of ['37.5665', '126.978', '90', '180', '-90', '-180']) {
      expect(renderedDeviceResult).not.toContain(coordinate);
    }
    expect(() => assertPrivacySafe(deviceLocation)).toThrow(PrivacyUnsafeValueError);
    expect(() => assertPrivacySafe({ metrics: [37.5665, 126.978] })).toThrow(
      PrivacyUnsafeValueError,
    );
    expect(() => assertPrivacySafe({ coordinates: [90.0001, 180.0001] })).not.toThrow();

    expect(sanitizePrivacyValue(deviceLocation, { locationClass: 'business' })).toEqual({
      findings: [],
      value: deviceLocation,
    });
    expect(() => assertPrivacySafe(deviceLocation, { locationClass: 'business' })).not.toThrow();
  });
  test('redacts coordinate-pair nodes at root and under unlabeled properties', () => {
    const rootArray = [37.5665, 126.978];
    const rootXy = { x: 126.978, y: 37.5665 };
    const nested = {
      envelope: {
        numericPair: [37.5665, 126.978],
        xyPair: { x: 126.978, y: 37.5665 },
      },
    };
    const rootResults = [sanitizePrivacyValue(rootArray), sanitizePrivacyValue(rootXy)];
    const nestedResult = sanitizePrivacyValue(nested);
    const rendered = JSON.stringify([...rootResults, nestedResult]);

    for (const result of rootResults) {
      expect(result.findings).toEqual(
        expect.arrayContaining([{ kind: 'precise_location', path: '$', count: 1 }]),
      );
      expect(result.value).toBe('[REDACTED:precise_location]');
    }
    expect(nestedResult.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['precise_location']),
    );
    for (const coordinate of ['37.5665', '126.978']) {
      expect(rendered).not.toContain(coordinate);
    }
    for (const value of [rootArray, rootXy, nested]) {
      expect(() => assertPrivacySafe(value)).toThrow(PrivacyUnsafeValueError);
    }

    expect(sanitizePrivacyValue(rootArray, { locationClass: 'business' })).toEqual({
      findings: [],
      value: rootArray,
    });
    expect(sanitizePrivacyValue(rootXy, { locationClass: 'business' })).toEqual({
      findings: [],
      value: rootXy,
    });
    expect(() => assertPrivacySafe(rootArray, { locationClass: 'business' })).not.toThrow();
    expect(() => assertPrivacySafe({
      locationClass: 'business',
      numericPair: rootArray,
    })).toThrow(PrivacyUnsafeValueError);
  });
  test('inventories sensitive coordinate siblings without changing whole-node redaction', () => {
    const password = 'coordinate-sibling-password-must-not-reach-a-sink';
    const email = 'coordinate-sibling@example.com';
    const apiKey = 'coordinate-sibling-api-key-must-not-reach-a-sink';
    const root = { x: 126.978, y: 37.5665, password };
    const nested = {
      envelope: {
        location: {
          coords: [37.5665, 126.978],
          email,
          providerApiKey: apiKey,
        },
      },
    };
    let accessorWasCalled = false;
    const accessorCoordinate = { x: 126.978, y: 37.5665 };
    const accessorSecret = 'coordinate-accessor-email-must-not-reach-a-sink';
    Object.defineProperty(accessorCoordinate, 'email', {
      enumerable: true,
      get: () => {
        accessorWasCalled = true;
        return accessorSecret;
      },
    });

    const rootResult = sanitizePrivacyValue(root);
    const nestedResult = sanitizePrivacyValue(nested);
    const accessorResult = sanitizePrivacyValue(accessorCoordinate);
    const boundedResult = sanitizePrivacyValue(root, { maxEntries: 2 });
    const rendered = JSON.stringify([
      rootResult,
      nestedResult,
      accessorResult,
      boundedResult,
    ]);

    expect(rootResult.value).toBe('[REDACTED:precise_location]');
    expect(nestedResult.value).toEqual({
      envelope: { location: '[REDACTED:precise_location]' },
    });
    expect(rootResult.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['precise_location', 'credential']),
    );
    expect(nestedResult.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['precise_location', 'email', 'credential']),
    );
    expect(accessorWasCalled).toBe(false);
    expect(accessorResult.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['precise_location', 'email', 'bounded_value']),
    );
    expect(boundedResult.value).toBe('[REDACTED:precise_location]');
    expect(boundedResult.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['precise_location', 'bounded_value']),
    );
    for (const rawValue of [
      password,
      email,
      apiKey,
      accessorSecret,
      '37.5665',
      '126.978',
    ]) {
      expect(rendered).not.toContain(rawValue);
    }
  });
  test('normalizes location container variants and requires an explicit business context', () => {
    const locations = {
      Location: [37.5665, 126.978],
      'device-location': { x: 126.978, y: 37.5665 },
      current_location: [-90, -180],
      GEO_location: { Latitude: 37.5665, Longitude: 126.978 },
      GPS: [37.5665, 126.978],
    };
    const deviceResult = sanitizePrivacyValue(locations);

    expect(deviceResult.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['precise_location']),
    );
    for (const coordinate of ['37.5665', '126.978', '-90', '-180']) {
      expect(JSON.stringify(deviceResult)).not.toContain(coordinate);
    }
    expect(() => assertPrivacySafe(locations)).toThrow(PrivacyUnsafeValueError);
    expect(() => assertPrivacySafe({
      locationClass: 'business',
      location: [37.5665, 126.978],
    })).toThrow(PrivacyUnsafeValueError);

    expect(sanitizePrivacyValue(locations, { locationClass: 'business' })).toEqual({
      findings: [],
      value: locations,
    });
    expect(() => assertPrivacySafe(locations, { locationClass: 'business' })).not.toThrow();
  });
  test('redacts API-key value variants without treating identifier metadata as credentials', () => {
    const xApiKey = 'opaque-x-api-key-value';
    const apiKeyValue = 'opaque-api-key-value';
    const providerApiKey = 'opaque-provider-api-key';
    const xSupabaseApiKey = 'opaque-supabase-api-key';
    const accessKey = 'opaque-access-key-value';
    const xAccessKey = 'opaque-x-access-key-value';
    const proxyAuthorization = 'Basic cHJveHk6YXV0aG9yaXphdGlvbg==';
    const apiKeyId = 'public-api-key-id';
    const apiKeyIdentifier = 'public-api-key-identifier';
    const providerApiKeyId = 'public-provider-api-key-id';
    const xSupabaseApiKeyIdentifier = 'public-supabase-api-key-identifier';
    const credentialValues = [
      xApiKey,
      apiKeyValue,
      providerApiKey,
      xSupabaseApiKey,
      accessKey,
      xAccessKey,
      proxyAuthorization,
    ];
    const identifierMetadata = {
      apiKeyId,
      apiKeyIdentifier,
      providerApiKeyId,
      xSupabaseApiKeyIdentifier,
    };
    const result = sanitizePrivacyValue({
      headers: {
        'X-API-Key': xApiKey,
        apiKeyValue,
        providerApiKey,
        xSupabaseApiKey,
        'access-key': accessKey,
        'X-Access-Key': xAccessKey,
        'Proxy-Authorization': proxyAuthorization,
        ...identifierMetadata,
      },
    });
    const rendered = JSON.stringify(result);

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['credential']),
    );
    for (const rawValue of credentialValues) {
      expect(rendered).not.toContain(rawValue);
    }
    for (const value of Object.values(identifierMetadata)) {
      expect(rendered).toContain(value);
    }
    expect(sanitizePrivacyValue(identifierMetadata)).toEqual({
      findings: [],
      value: identifierMetadata,
    });
    expect(() => assertPrivacySafe(identifierMetadata)).not.toThrow();
    expect(() => assertPrivacySafe({
      headers: {
        apiKeyValue,
        providerApiKey,
        xSupabaseApiKey,
      },
    })).toThrow(PrivacyUnsafeValueError);
  });

  test('redacts Korean 070 phone numbers without matching unprefixed numeric identifiers', () => {
    for (const phone of ['070-1234-5678', '07012345678']) {
      const result = sanitizePrivacyValue(phone);

      expect(result.findings).toEqual(
        expect.arrayContaining([{ kind: 'phone', path: '$', count: 1 }]),
      );
      expect(JSON.stringify(result)).not.toContain(phone);
      expect(() => assertPrivacySafe(phone)).toThrow(PrivacyUnsafeValueError);
    }

    for (const identifier of ['70-1234-5678', '7012345678', 'order=17012345678']) {
      expect(() => assertPrivacySafe(identifier)).not.toThrow();
    }
  });
  test('rejects precise coordinates embedded in labeled text and URLs', () => {
    for (const value of [
      'lat=37.56650 lng=126.97800',
      '위도: 37.56650, 경도: 126.97800',
      '좌표=37.56650,126.97800',
      'https://example.invalid/map?lat=37.56650&lng=126.97800',
    ]) {
      const result = sanitizePrivacyValue(value);
      expect(result.findings.map((finding) => finding.kind)).toContain('precise_location');
      expect(JSON.stringify(result)).not.toContain('37.56650');
      expect(() => assertPrivacySafe(value)).toThrow(PrivacyUnsafeValueError);
    }

    for (const safeValue of ['가격=37.5665원', '버전 1.2345', '21:00~08:00', '주문번호 123456']) {
      expect(() => assertPrivacySafe(safeValue)).not.toThrow();
    }
  });
  test('fails closed with category, path, and count only', () => {
    const rrn = '900101-1234567';
    let thrown: unknown;

    try {
      assertPrivacySafe({ rrn });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivacyUnsafeValueError);
    const privacyError = thrown as PrivacyUnsafeValueError;
    expect(privacyError.code).toBe('PRIVACY_UNSAFE_VALUE');
    expect(privacyError.findings).toEqual([
      { kind: 'rrn', path: '$.rrn', count: 1 },
    ]);
    expect(JSON.stringify({
      code: privacyError.code,
      findings: privacyError.findings,
      message: privacyError.message,
    })).not.toContain(rrn);
  });
});
