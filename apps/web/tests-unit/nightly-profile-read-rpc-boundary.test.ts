import { describe, expect, test } from 'bun:test';

import {
  hasEncodedOrMalformedPath,
  hasDuplicateOrInvalidJsonMemberNames,
  isAllowedLocalProfileReadRpcPreflightRequest,
  isAllowedLocalProfileReadRpcRequest,
  isExactLocalProfileReadRpcPath,
  LOCAL_PROFILE_LEADERBOARD_RPC_PATH,
  LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH,
  LOCAL_PROFILE_READ_RPC_PATHS,
  LOCAL_PROFILE_SUMMARIES_RPC_PATH,
} from '../tests/nightly/local-profile-read-rpc-boundary';

const ORIGIN = 'http://127.0.0.1:38000';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const APP_ORIGIN = 'http://127.0.0.1:8080';

function accepts(path: string, body: unknown, overrides: Partial<{
  origin: string;
  method: string;
  contentType: string;
  search: string;
}> = {}) {
  return isAllowedLocalProfileReadRpcRequest({
    allowedOrigin: overrides.origin ?? ORIGIN,
    url: new URL(`${ORIGIN}${path}${overrides.search ?? ''}`),
    method: overrides.method ?? 'POST',
    contentType: overrides.contentType ?? 'application/json',
    postData: Buffer.from(JSON.stringify(body), 'utf8'),
  });
}

function acceptsRaw(path: string, rawBody: string) {
  return isAllowedLocalProfileReadRpcRequest({
    allowedOrigin: ORIGIN,
    url: new URL(`${ORIGIN}${path}`),
    method: 'POST',
    contentType: 'application/json',
    postData: Buffer.from(rawBody, 'utf8'),
  });
}

describe('nightly public-profile read RPC boundary', () => {
  test('accepts only bounded distinct UUID summary requests', () => {
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, { p_user_ids: [USER_A, USER_B] })).toBe(true);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, { p_user_ids: [] })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, { p_user_ids: [USER_A, USER_A] })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, { p_user_ids: ['not-a-uuid'] })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, { p_user_ids: [USER_A], extra: true })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, {
      p_user_ids: Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`),
    })).toBe(false);
  });

  test('accepts only exact bounded leaderboard requests', () => {
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_RPC_PATH, { p_period: 'all', p_limit: 100 })).toBe(true);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_RPC_PATH, { p_period: 'monthly', p_limit: 1 })).toBe(true);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_RPC_PATH, { p_period: 'week', p_limit: 10 })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_RPC_PATH, { p_period: 'all', p_limit: 0 })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_RPC_PATH, { p_period: 'all', p_limit: 101 })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_RPC_PATH, { p_period: 'all', p_limit: 10, extra: true })).toBe(false);
  });

  test('accepts only exact null-or-paired leaderboard page cursors', () => {
    const base = {
      p_period: 'all',
      p_limit: 100,
      p_after_quality_score: null,
      p_after_user_id: null,
    };
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, base)).toBe(true);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, {
      ...base,
      p_period: 'monthly',
      p_after_quality_score: 7.5,
      p_after_user_id: USER_A,
    })).toBe(true);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, {
      ...base,
      p_after_quality_score: 7.5,
    })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, {
      ...base,
      p_after_user_id: USER_A,
    })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, {
      ...base,
      p_after_quality_score: -1,
      p_after_user_id: USER_A,
    })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, {
      ...base,
      p_after_quality_score: 0,
      p_after_user_id: 'not-a-uuid',
    })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, { ...base, extra: true })).toBe(false);
    expect(accepts(LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH, { ...base, p_limit: 101 })).toBe(false);
  });

  test('rejects raw duplicate JSON member names including escaped aliases', () => {
    const cases = [
      [
        LOCAL_PROFILE_SUMMARIES_RPC_PATH,
        `{"p_user_ids":["${USER_A}"],"\\u0070_user_ids":["${USER_B}"]}`,
      ],
      [
        LOCAL_PROFILE_LEADERBOARD_RPC_PATH,
        '{"p_period":"all","p_limit":10,"\\u0070_limit":10}',
      ],
      [
        LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH,
        `{"p_period":"all","p_limit":100,"p_after_quality_score":null,"p_after_user_id":null,"\\u0070_after_user_id":"${USER_A}"}`,
      ],
    ] as const;
    for (const [path, rawBody] of cases) {
      expect(hasDuplicateOrInvalidJsonMemberNames(rawBody)).toBe(true);
      expect(acceptsRaw(path, rawBody)).toBe(false);
    }
    expect(hasDuplicateOrInvalidJsonMemberNames('{"outer":{"value":1,"\\u0076alue":2}}')).toBe(true);
  });

  test('accepts only exact POST profile RPC preflights', () => {
    const request = (overrides: Partial<{
      method: string;
      search: string;
      postData: Buffer | null;
      headers: Record<string, string>;
    }> = {}) => isAllowedLocalProfileReadRpcPreflightRequest({
      allowedOrigin: ORIGIN,
      allowedApplicationOrigin: APP_ORIGIN,
      url: new URL(`${ORIGIN}${LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH}${overrides.search ?? ''}`),
      method: overrides.method ?? 'OPTIONS',
      postData: overrides.postData ?? null,
      headers: overrides.headers ?? {
        origin: APP_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'apikey, authorization, content-type, x-client-info',
      },
    });
    expect(request()).toBe(true);
    expect(request({ method: 'GET' })).toBe(false);
    expect(request({ search: '?x=1' })).toBe(false);
    expect(request({ postData: Buffer.from('{}') })).toBe(false);
    expect(request({ headers: {
      origin: APP_ORIGIN,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'content-type',
    } })).toBe(false);
    expect(request({ headers: {
      origin: APP_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, x-unlisted',
    } })).toBe(false);
    expect(request({ headers: {
      origin: APP_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'apikey, authorization',
    } })).toBe(false);
    expect(request({ headers: {
      origin: 'http://evil.invalid',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    } })).toBe(false);
  });

  test('rejects percent-encoded and malformed profile RPC path aliases', () => {
    const canonicalUrl = new URL(`${ORIGIN}${LOCAL_PROFILE_LEADERBOARD_PAGE_RPC_PATH}`);
    expect(hasEncodedOrMalformedPath(canonicalUrl)).toBe(false);
    expect(isExactLocalProfileReadRpcPath(canonicalUrl)).toBe(true);

    const encodedOrMalformedPaths = [
      '/rest/v1/rpc/%72ead_public_profile_leaderboard_page',
      '/rest/v1/rpc/read%5fpublic_profile_leaderboard_page',
      '/rest/v1/rpc/read%5Fpublic_profile_leaderboard_page',
      '/rest/v1/rpc%2fread_public_profile_leaderboard_page',
      '/rest/v1/rpc%2Fread_public_profile_leaderboard_page',
      '/rest/v1/rpc/%2eread_public_profile_leaderboard_page',
      '/rest/v1/rpc/%2Eread_public_profile_leaderboard_page',
      '/rest/v1/rpc/%read_public_profile_leaderboard_page',
      '/rest/v1/rpc/%GGread_public_profile_leaderboard_page',
    ];
    const pageBody = {
      p_period: 'all',
      p_limit: 100,
      p_after_quality_score: null,
      p_after_user_id: null,
    };
    for (const path of encodedOrMalformedPaths) {
      const url = new URL(`${ORIGIN}${path}`);
      expect(hasEncodedOrMalformedPath(url), path).toBe(true);
      expect(isExactLocalProfileReadRpcPath(url), path).toBe(false);
      expect(accepts(path, pageBody), path).toBe(false);
      expect(isAllowedLocalProfileReadRpcPreflightRequest({
        allowedOrigin: ORIGIN,
        allowedApplicationOrigin: APP_ORIGIN,
        url,
        method: 'OPTIONS',
        postData: null,
        headers: {
          origin: APP_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      }), path).toBe(false);
    }
  });

  test('rejects origin, method, query, content-type, path, and size drift', () => {
    const body = { p_user_ids: [USER_A] };
    expect(isAllowedLocalProfileReadRpcRequest({
      allowedOrigin: undefined,
      url: new URL(`${ORIGIN}${LOCAL_PROFILE_SUMMARIES_RPC_PATH}`),
      method: 'POST',
      contentType: 'application/json',
      postData: Buffer.from(JSON.stringify(body), 'utf8'),
    })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, body, { origin: 'http://127.0.0.1:48000' })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, body, { method: 'GET' })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, body, { search: '?x=1' })).toBe(false);
    expect(accepts(LOCAL_PROFILE_SUMMARIES_RPC_PATH, body, { contentType: 'text/plain' })).toBe(false);
    for (const path of LOCAL_PROFILE_READ_RPC_PATHS) {
      const exactBody = path === LOCAL_PROFILE_SUMMARIES_RPC_PATH
        ? body
        : path === LOCAL_PROFILE_LEADERBOARD_RPC_PATH
          ? { p_period: 'all', p_limit: 100 }
          : {
              p_period: 'all',
              p_limit: 100,
              p_after_quality_score: null,
              p_after_user_id: null,
            };
      expect(accepts(path, exactBody, { method: 'GET' }), path).toBe(false);
      expect(accepts(path, exactBody, { search: '?unexpected=1' }), path).toBe(false);
    }
    expect(accepts('/rest/v1/rpc/unlisted', body)).toBe(false);
    expect(isAllowedLocalProfileReadRpcRequest({
      allowedOrigin: ORIGIN,
      url: new URL(`${ORIGIN}${LOCAL_PROFILE_SUMMARIES_RPC_PATH}`),
      method: 'POST',
      contentType: 'application/json',
      postData: Buffer.alloc(4_097, 0x20),
    })).toBe(false);
  });
});
