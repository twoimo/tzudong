import { describe, expect, test } from 'bun:test';

import {
  isAllowedLocalProfileMutationRpcPreflightRequest,
  isAllowedLocalProfileMutationRpcRequest,
  isExactLocalDirectProfileTablePath,
  isExactLocalProfileMutationRpcPath,
  LOCAL_DIRECT_PROFILE_TABLE_PATH,
  LOCAL_PROFILE_AVATAR_CAS_RPC_PATH,
  LOCAL_PROFILE_MUTATION_RPC_PATHS,
  LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH,
} from '../tests/nightly/local-profile-mutation-rpc-boundary';

const ORIGIN = 'http://127.0.0.1:40000';
const APP_ORIGIN = 'http://127.0.0.1:18080';
const OPERATION_ID = '00000000-0000-4000-8000-000000000905';

function acceptsRaw(path: string, rawBody: string, overrides: Partial<{
  method: string;
  contentType: string;
  search: string;
  origin: string | undefined;
}> = {}) {
  return isAllowedLocalProfileMutationRpcRequest({
    allowedOrigin: overrides.origin === undefined ? ORIGIN : overrides.origin,
    url: new URL(`${ORIGIN}${path}${overrides.search ?? ''}`),
    method: overrides.method ?? 'POST',
    contentType: overrides.contentType ?? 'application/json',
    postData: Buffer.from(rawBody, 'utf8'),
  });
}

function accepts(path: string, body: unknown) {
  return acceptsRaw(path, JSON.stringify(body));
}

describe('nightly current-profile mutation RPC boundary', () => {
  test('accepts exact nickname and avatar CAS requests', () => {
    expect(accepts(LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH, {
      p_nickname: 'Nightly CI 검증',
    })).toBe(true);
    expect(accepts(LOCAL_PROFILE_AVATAR_CAS_RPC_PATH, {
      p_expected_avatar_reference: null,
      p_next_avatar_operation_id: OPERATION_ID,
    })).toBe(true);
    expect(accepts(LOCAL_PROFILE_AVATAR_CAS_RPC_PATH, {
      p_expected_avatar_reference: '',
      p_next_avatar_operation_id: null,
    })).toBe(true);
    expect(accepts(LOCAL_PROFILE_AVATAR_CAS_RPC_PATH, {
      p_expected_avatar_reference: 'legacy\nopaque',
      p_next_avatar_operation_id: OPERATION_ID,
    })).toBe(true);
  });

  test('rejects nickname validation and exact-key drift', () => {
    for (const nickname of ['', 'a', ' padded ', '탈퇴한 사용자', 'bad\nname', 'x'.repeat(21)]) {
      expect(accepts(LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH, {
        p_nickname: nickname,
      }), nickname).toBe(false);
    }
    expect(accepts(LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH, {
      p_nickname: 'Nightly CI',
      extra: true,
    })).toBe(false);
    expect(acceptsRaw(
      LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH,
      '{"p_nickname":"Nightly CI","\\u0070_nickname":"other"}',
    )).toBe(false);
  });

  test('accepts the full opaque expected-reference contract and rejects overflow', () => {
    const exactAscii = 'a'.repeat(4_096);
    const exactMultibyte = '한'.repeat(1_365);
    const escapedControls = '\u0000'.repeat(4_096);
    for (const expectedReference of [exactAscii, exactMultibyte, escapedControls]) {
      expect(accepts(LOCAL_PROFILE_AVATAR_CAS_RPC_PATH, {
        p_expected_avatar_reference: expectedReference,
        p_next_avatar_operation_id: OPERATION_ID,
      })).toBe(true);
    }
    expect(accepts(LOCAL_PROFILE_AVATAR_CAS_RPC_PATH, {
      p_expected_avatar_reference: 'a'.repeat(4_097),
      p_next_avatar_operation_id: OPERATION_ID,
    })).toBe(false);
    expect(accepts(LOCAL_PROFILE_AVATAR_CAS_RPC_PATH, {
      p_expected_avatar_reference: null,
      p_next_avatar_operation_id: 'not-a-uuid',
    })).toBe(false);
    expect(accepts(LOCAL_PROFILE_AVATAR_CAS_RPC_PATH, {
      p_expected_avatar_reference: null,
      p_next_avatar_operation_id: OPERATION_ID,
      extra: true,
    })).toBe(false);
  });

  test('rejects origin, method, query, content-type, raw duplicate, and oversized body drift', () => {
    const body = JSON.stringify({ p_nickname: 'Nightly CI' });
    expect(acceptsRaw(LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH, body, { method: 'GET' })).toBe(false);
    expect(acceptsRaw(LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH, body, { search: '?x=1' })).toBe(false);
    expect(acceptsRaw(LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH, body, { contentType: 'text/plain' })).toBe(false);
    expect(acceptsRaw(LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH, body, { origin: '' })).toBe(false);
    expect(acceptsRaw(
      LOCAL_PROFILE_AVATAR_CAS_RPC_PATH,
      `{"p_expected_avatar_reference":null,"p_next_avatar_operation_id":"${OPERATION_ID}","\\u0070_next_avatar_operation_id":null}`,
    )).toBe(false);
    expect(isAllowedLocalProfileMutationRpcRequest({
      allowedOrigin: ORIGIN,
      url: new URL(`${ORIGIN}${LOCAL_PROFILE_AVATAR_CAS_RPC_PATH}`),
      method: 'POST',
      contentType: 'application/json',
      postData: Buffer.alloc(32_769, 0x20),
    })).toBe(false);
  });

  test('accepts only exact POST preflight requests', () => {
    const request = (overrides: Partial<{
      method: string;
      path: string;
      search: string;
      postData: Buffer | null;
      headers: Record<string, string>;
    }> = {}) => isAllowedLocalProfileMutationRpcPreflightRequest({
      allowedOrigin: ORIGIN,
      allowedApplicationOrigin: APP_ORIGIN,
      url: new URL(`${ORIGIN}${overrides.path ?? LOCAL_PROFILE_AVATAR_CAS_RPC_PATH}${overrides.search ?? ''}`),
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
  });

  test('rejects percent aliases and the direct profiles table boundary', () => {
    const encodedPaths = [
      '/rest/v1/rpc/%75pdate_current_profile_nickname',
      '/rest/v1/rpc/update%5fcurrent_profile_nickname',
      '/rest/v1/rpc%2fcompare_and_set_current_profile_avatar',
      '/rest/v1/rpc/%GGcompare_and_set_current_profile_avatar',
    ];
    for (const path of encodedPaths) {
      expect(isExactLocalProfileMutationRpcPath(new URL(`${ORIGIN}${path}`)), path).toBe(false);
      expect(accepts(path, { p_nickname: 'Nightly CI' }), path).toBe(false);
    }
    expect(isExactLocalDirectProfileTablePath(
      new URL(`${ORIGIN}${LOCAL_DIRECT_PROFILE_TABLE_PATH}`),
    )).toBe(true);
    expect(isExactLocalDirectProfileTablePath(
      new URL(`${ORIGIN}/rest/v1/%70rofiles`),
    )).toBe(false);
    expect(LOCAL_PROFILE_MUTATION_RPC_PATHS.size).toBe(2);
  });
});
