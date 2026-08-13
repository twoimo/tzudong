import { expect, test } from './nightly/nightly-test';
import {
  ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
  buildAdminMapOverlayPayloadHash,
  buildAdminMapOverlayPreviewHash,
  mapAdminMapOverlayRouteActionToRpcAction,
  normalizeAdminMapOverlayPreviewRequest,
} from '../lib/admin-map-overlays';
import {
  LOCAL_DIRECT_PROFILE_TABLE_PATH,
  LOCAL_PROFILE_AVATAR_CAS_RPC_PATH,
  LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH,
} from './nightly/local-profile-mutation-rpc-boundary';
import { LOCAL_PROFILE_SUMMARIES_RPC_PATH } from './nightly/local-profile-read-rpc-boundary';

const isLocalNightly = process.env.NIGHTLY_MODE === 'local';
const localSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const localSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const localAppOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:18080').origin;
const localSupabaseOrigin = new URL(localSupabaseUrl || 'http://127.0.0.1').origin;
const localStorageUploadPath = /^\/storage\/v1\/object\/review-photos\/[0-9a-f-]{36}\/nightly-browser-cors\/review\.webp$/;
const localStoragePublicPath = /^\/storage\/v1\/object\/public\/review-photos\/[0-9a-f-]{36}\/nightly-browser-cors\/review\.webp$/;
const localProfileAvatarOperationId = '00000000-0000-4000-8000-000000000905';
const localProfileAvatarJpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

test.describe('real local Supabase and admin lifecycle', () => {
  test.skip(!isLocalNightly, 'This contract is restricted to the disposable local stack.');

  test('reads the seeded catalog from the real local REST boundary', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ supabaseUrl, anonKey }) => {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/restaurants?select=id,approved_name,status&order=id.asc`,
        {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
        },
      );
      const body = await response.json();
      return {
        status: response.status,
        exactFixture: JSON.stringify(body) === JSON.stringify([
          { id: '00000000-0000-4000-8000-000000000101', approved_name: '정원분식', status: 'approved' },
          { id: '00000000-0000-4000-8000-000000000102', approved_name: '명동칼국수', status: 'approved' },
        ]),
      };
    }, { supabaseUrl: localSupabaseUrl, anonKey: localSupabaseAnonKey });
    expect(result.status).toBe(200);
    expect(result.exactFixture).toBe(true);
  });

  test('proves real browser CORS for the local function, owned Storage lifecycle, and Realtime self-broadcast', async ({ page }) => {
    const email = process.env.NIGHTLY_ADMIN_EMAIL;
    const password = process.env.NIGHTLY_ADMIN_PASSWORD;
    expect(email).toBe('nightly-ci@local.invalid');
    expect(password?.length).toBeGreaterThanOrEqual(16);

    const corsEvidence = {
      authCredentialed: false,
      function: false,
      storageUpload: false,
      storagePublicRead: false,
      storageDelete: false,
    };
    page.on('response', (response) => {
      let url: URL;
      try {
        url = new URL(response.url());
      } catch {
        return;
      }
      if (url.origin !== localSupabaseOrigin) return;
      const headers = response.headers();
      const hasExactCors = headers['access-control-allow-origin'] === localAppOrigin
        && headers['access-control-allow-credentials'] === undefined;
      const method = response.request().method();
      if (
        method === 'POST'
        && url.pathname === '/auth/v1/token'
        && url.search === '?grant_type=password'
      ) {
        corsEvidence.authCredentialed ||= headers['access-control-allow-origin'] === localAppOrigin
          && headers['access-control-allow-credentials'] === 'true';
      } else if (method === 'POST' && url.pathname === '/functions/v1/naver-geocode' && !url.search) {
        corsEvidence.function ||= hasExactCors;
      } else if (method === 'POST' && localStorageUploadPath.test(url.pathname) && !url.search) {
        corsEvidence.storageUpload ||= hasExactCors;
      } else if (method === 'GET' && localStoragePublicPath.test(url.pathname) && !url.search) {
        corsEvidence.storagePublicRead ||= hasExactCors;
      } else if (
        method === 'DELETE'
        && url.pathname === '/storage/v1/object/review-photos'
        && !url.search
      ) {
        corsEvidence.storageDelete ||= hasExactCors;
      }
    });

    await page.goto('/');
    const httpBoundary = await page.evaluate(async ({
      anonKey,
      email: loginEmail,
      password: loginPassword,
      supabaseUrl,
    }) => {
      const loginResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const loginPayload = await loginResponse.json() as {
        access_token?: string;
        user?: { id?: string };
      };
      const accessToken = loginPayload.access_token ?? '';
      const userId = loginPayload.user?.id ?? '';
      const authenticated = loginResponse.ok
        && accessToken.length > 0
        && /^[0-9a-f-]{36}$/.test(userId);
      if (!authenticated) {
        return {
          authenticated: false,
          functionOk: false,
          functionExactFixture: false,
          functionProvenance: false,
          functionNoStore: false,
          storageUploadOk: false,
          storagePublicReadOk: false,
          storageCleanupOk: false,
        };
      }

      const functionResponse = await fetch(`${supabaseUrl}/functions/v1/naver-geocode`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '서울특별시 중구 세종대로 110', count: 1 }),
      });
      let functionExactFixture = false;
      try {
        const payload = await functionResponse.json() as {
          addresses?: Array<{ roadAddress?: string; x?: string; y?: string }>;
        };
        functionExactFixture = payload.addresses?.length === 1
          && payload.addresses[0]?.roadAddress === '서울특별시 중구 세종대로 110'
          && payload.addresses[0]?.x === '126.978'
          && payload.addresses[0]?.y === '37.5665';
      } catch {
        functionExactFixture = false;
      }

      const objectPrefix = `${userId}/nightly-browser-cors/review.webp`;
      const objectUrl = `${supabaseUrl}/storage/v1/object/review-photos/${objectPrefix}`;
      const publicObjectUrl = `${supabaseUrl}/storage/v1/object/public/review-photos/${objectPrefix}`;
      const webpBase64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/v89WAAAAA==';
      const webpBytes = Uint8Array.from(atob(webpBase64), (character) => character.charCodeAt(0));
      let storageUploadOk = false;
      let storagePublicReadOk = false;
      let storageCleanupOk = false;
      try {
        const uploadResponse = await fetch(objectUrl, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            'cache-control': 'max-age=3600',
            'Content-Type': 'image/webp',
            'x-upsert': 'false',
          },
          body: webpBytes,
        });
        storageUploadOk = uploadResponse.ok;
        if (storageUploadOk) {
          const publicReadResponse = await fetch(publicObjectUrl);
          storagePublicReadOk = publicReadResponse.ok;
          await publicReadResponse.body?.cancel();
        }
      } finally {
        const cleanupResponse = await fetch(`${supabaseUrl}/storage/v1/object/review-photos`, {
          method: 'DELETE',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes: [objectPrefix] }),
        });
        storageCleanupOk = cleanupResponse.ok;
        await cleanupResponse.body?.cancel();
      }
      return {
        authenticated,
        functionOk: functionResponse.ok,
        functionExactFixture,
        functionProvenance: functionResponse.headers.get('x-tzudong-local-fixture')
          === 'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:naver-geocode-fixture-v1',
        functionNoStore: functionResponse.headers.get('cache-control') === 'no-store',
        storageUploadOk,
        storagePublicReadOk,
        storageCleanupOk,
      };
    }, {
      anonKey: localSupabaseAnonKey,
      email,
      password,
      supabaseUrl: localSupabaseUrl,
    });
    expect(httpBoundary).toEqual({
      authenticated: true,
      functionOk: true,
      functionExactFixture: true,
      functionProvenance: true,
      functionNoStore: true,
      storageUploadOk: true,
      storagePublicReadOk: true,
      storageCleanupOk: true,
    });
    expect(corsEvidence).toEqual({
      authCredentialed: true,
      function: true,
      storageUpload: true,
      storagePublicRead: true,
      storageDelete: true,
    });

    const realtimeBoundary = await page.evaluate(async ({ anonKey, supabaseUrl }) => {
      const endpoint = new URL(supabaseUrl);
      endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
      endpoint.pathname = '/realtime/v1/websocket';
      endpoint.search = '';
      endpoint.searchParams.set('apikey', anonKey);
      endpoint.searchParams.set('vsn', '2.0.0');
      const topic = 'realtime:local-browser-cors-v1';
      const marker = 'local-browser-cors-marker-v1';
      const joinRef = '1';
      const broadcastRef = '2';
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const encodeBroadcast = () => {
        const topicBytes = encoder.encode(topic);
        const eventBytes = encoder.encode('local_fixture');
        const joinRefBytes = encoder.encode(joinRef);
        const refBytes = encoder.encode(broadcastRef);
        const payloadBytes = encoder.encode(JSON.stringify({ marker }));
        const headerLength = 7 + joinRefBytes.length + refBytes.length + topicBytes.length + eventBytes.length;
        const output = new Uint8Array(headerLength + payloadBytes.length);
        let offset = 0;
        output[offset++] = 3;
        output[offset++] = joinRefBytes.length;
        output[offset++] = refBytes.length;
        output[offset++] = topicBytes.length;
        output[offset++] = eventBytes.length;
        output[offset++] = 0;
        output[offset++] = 1;
        output.set(joinRefBytes, offset); offset += joinRefBytes.length;
        output.set(refBytes, offset); offset += refBytes.length;
        output.set(topicBytes, offset); offset += topicBytes.length;
        output.set(eventBytes, offset); offset += eventBytes.length;
        output.set(payloadBytes, offset);
        return output;
      };
      const decodeBinary = (input: ArrayBuffer) => {
        const bytes = new Uint8Array(input);
        if (bytes[0] === 4 && bytes.length >= 5) {
          const topicLength = bytes[1] ?? 0;
          const eventLength = bytes[2] ?? 0;
          const metadataLength = bytes[3] ?? 0;
          const encoding = bytes[4];
          let offset = 5;
          const decodedTopic = decoder.decode(bytes.slice(offset, offset + topicLength));
          offset += topicLength;
          const event = decoder.decode(bytes.slice(offset, offset + eventLength));
          offset += eventLength + metadataLength;
          let payload: unknown;
          try {
            payload = encoding === 1 ? JSON.parse(decoder.decode(bytes.slice(offset))) : null;
          } catch {
            payload = null;
          }
          return { kind: 'broadcast', topic: decodedTopic, event, payload };
        }
        if (bytes[0] === 1 && bytes.length >= 5) {
          const joinLength = bytes[1] ?? 0;
          const refLength = bytes[2] ?? 0;
          const topicLength = bytes[3] ?? 0;
          const statusLength = bytes[4] ?? 0;
          let offset = 5 + joinLength;
          const ref = decoder.decode(bytes.slice(offset, offset + refLength));
          offset += refLength;
          const decodedTopic = decoder.decode(bytes.slice(offset, offset + topicLength));
          offset += topicLength;
          const status = decoder.decode(bytes.slice(offset, offset + statusLength));
          return { kind: 'reply', topic: decodedTopic, ref, status, payload: null };
        }
        return null;
      };

      return new Promise<{
        opened: boolean;
        subscribed: boolean;
        sendAcknowledged: boolean;
        selfBroadcastReceived: boolean;
      }>((resolve) => {
        const result = {
          opened: false,
          subscribed: false,
          sendAcknowledged: false,
          selfBroadcastReceived: false,
        };
        let settled = false;
        const socket = new WebSocket(endpoint);
        socket.binaryType = 'arraybuffer';
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.close(1000, 'complete');
          resolve(result);
        };
        const maybeFinish = () => {
          if (result.subscribed && result.sendAcknowledged && result.selfBroadcastReceived) finish();
        };
        const timer = setTimeout(finish, 7_000);
        socket.addEventListener('open', () => {
          result.opened = true;
          socket.send(JSON.stringify([
            null,
            joinRef,
            topic,
            'phx_join',
            {
              config: {
                broadcast: { ack: true, self: true },
                presence: { key: '', enabled: false },
                postgres_changes: [],
                private: false,
              },
            },
          ]));
        });
        socket.addEventListener('message', async (event) => {
          let decoded: unknown = null;
          if (typeof event.data === 'string') {
            try {
              decoded = JSON.parse(event.data);
            } catch {
              decoded = null;
            }
          } else if (event.data instanceof ArrayBuffer) {
            decoded = decodeBinary(event.data);
          } else if (event.data instanceof Blob) {
            decoded = decodeBinary(await event.data.arrayBuffer());
          }
          if (Array.isArray(decoded)) {
            const [, ref, decodedTopic, eventName, payload] = decoded as unknown[];
            const status = payload && typeof payload === 'object' && !Array.isArray(payload)
              ? (payload as { status?: unknown }).status
              : undefined;
            if (decodedTopic === topic && eventName === 'phx_reply' && status === 'ok') {
              if (ref === joinRef && !result.subscribed) {
                result.subscribed = true;
                socket.send(encodeBroadcast());
              } else if (ref === broadcastRef) {
                result.sendAcknowledged = true;
              }
            }
          } else if (decoded && typeof decoded === 'object') {
            const message = decoded as {
              kind?: string;
              topic?: string;
              event?: string;
              ref?: string;
              status?: string;
              payload?: unknown;
            };
            if (
              message.kind === 'reply'
              && message.topic === topic
              && message.ref === broadcastRef
              && message.status === 'ok'
            ) {
              result.sendAcknowledged = true;
            }
            if (
              message.kind === 'broadcast'
              && message.topic === topic
              && message.event === 'local_fixture'
              && message.payload
              && typeof message.payload === 'object'
              && !Array.isArray(message.payload)
              && (message.payload as { marker?: unknown }).marker === marker
            ) {
              result.selfBroadcastReceived = true;
            }
          }
          maybeFinish();
        });
        socket.addEventListener('error', finish);
        socket.addEventListener('close', finish);
      });
    }, { anonKey: localSupabaseAnonKey, supabaseUrl: localSupabaseUrl });
    expect(realtimeBoundary).toEqual({
      opened: true,
      subscribed: true,
      sendAcknowledged: true,
      selfBroadcastReceived: true,
    });
  });

  test('proves authenticated profile nickname and avatar CAS with exact readback and cleanup', async ({ page }) => {
    const email = process.env.NIGHTLY_ADMIN_EMAIL;
    const password = process.env.NIGHTLY_ADMIN_PASSWORD;
    expect(email).toBe('nightly-ci@local.invalid');
    expect(password?.length).toBeGreaterThanOrEqual(16);

    await page.goto('/');
    const evidence = await page.evaluate(async ({
      anonKey,
      avatarJpegBase64,
      avatarOperationId,
      avatarRpcPath,
      directProfilePath,
      email: loginEmail,
      nicknameRpcPath,
      password: loginPassword,
      profileSummaryPath,
      supabaseUrl,
    }) => {
      const fixedHeaders = (accessToken: string) => ({
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      });
      const postJson = async (
        accessToken: string,
        path: string,
        body: Readonly<Record<string, unknown>>,
      ) => {
        const response = await fetch(`${supabaseUrl}${path}`, {
          method: 'POST',
          headers: fixedHeaders(accessToken),
          body: JSON.stringify(body),
        });
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        return { ok: response.ok, payload };
      };
      const isRecord = (value: unknown): value is Record<string, unknown> => (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
      const isExactProfile = (
        value: unknown,
        userId: string,
        nickname: string,
        avatarReference: string | null,
      ) => isRecord(value)
        && value.user_id === userId
        && value.nickname === nickname
        && value.avatar_url === avatarReference
        && Object.keys(value).length === 3;
      const readProfile = async (accessToken: string, userId: string) => {
        const result = await postJson(accessToken, profileSummaryPath, { p_user_ids: [userId] });
        return {
          ok: result.ok,
          row: Array.isArray(result.payload) && result.payload.length === 1
            ? result.payload[0]
            : null,
        };
      };
      const result = {
        authenticated: false,
        directProfilesDenied: false,
        initialReadback: false,
        nicknameApplied: false,
        uploadStored: false,
        avatarApplied: false,
        avatarReadback: false,
        avatarPublicRead: false,
        avatarCleared: false,
        objectAbsent: false,
        nicknameRestored: false,
        finalReadback: false,
      };
      let accessToken = '';
      let userId = '';
      let marker = '';
      let storageKey = '';
      try {
        const loginResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: loginEmail, password: loginPassword }),
        });
        const loginPayload = await loginResponse.json() as {
          access_token?: unknown;
          user?: { id?: unknown };
        };
        accessToken = typeof loginPayload.access_token === 'string'
          ? loginPayload.access_token
          : '';
        userId = typeof loginPayload.user?.id === 'string' ? loginPayload.user.id : '';
        result.authenticated = loginResponse.ok
          && accessToken.length > 0
          && /^[0-9a-f-]{36}$/.test(userId);
        if (!result.authenticated) return result;

        try {
          await fetch(`${supabaseUrl}${directProfilePath}?select=user_id&limit=1`, {
            headers: fixedHeaders(accessToken),
          });
        } catch {
          result.directProfilesDenied = true;
        }

        const initial = await readProfile(accessToken, userId);
        result.initialReadback = initial.ok
          && isExactProfile(initial.row, userId, 'Nightly CI', null);

        const nickname = await postJson(accessToken, nicknameRpcPath, {
          p_nickname: 'Nightly CI 검증',
        });
        result.nicknameApplied = nickname.ok
          && isRecord(nickname.payload)
          && nickname.payload.status === 'applied'
          && nickname.payload.reasonCode === 'PROFILE_NICKNAME_UPDATED'
          && isRecord(nickname.payload.profile)
          && nickname.payload.profile.nickname === 'Nightly CI 검증'
          && nickname.payload.profile.avatarReference === null;

        storageKey = `${userId}/avatar-${avatarOperationId}.jpg`;
        marker = `profile-avatar://${storageKey}`;
        const objectUrl = `${supabaseUrl}/storage/v1/object/profile-avatars/${storageKey}`;
        const publicObjectUrl = `${supabaseUrl}/storage/v1/object/public/profile-avatars/${storageKey}`;
        const cleanupBody = JSON.stringify({ prefixes: [storageKey] });
        await fetch(`${supabaseUrl}/storage/v1/object/profile-avatars`, {
          method: 'DELETE',
          headers: fixedHeaders(accessToken),
          body: cleanupBody,
        });
        const jpegBytes = Uint8Array.from(
          atob(avatarJpegBase64),
          (character) => character.charCodeAt(0),
        );
        const upload = await fetch(objectUrl, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            'cache-control': 'max-age=3600',
            'Content-Type': 'image/jpeg',
            'x-upsert': 'false',
          },
          body: jpegBytes,
        });
        result.uploadStored = upload.ok;
        await upload.body?.cancel();

        const avatar = await postJson(accessToken, avatarRpcPath, {
          p_expected_avatar_reference: null,
          p_next_avatar_operation_id: avatarOperationId,
        });
        result.avatarApplied = avatar.ok
          && isRecord(avatar.payload)
          && avatar.payload.status === 'applied'
          && avatar.payload.reasonCode === 'PROFILE_AVATAR_UPDATED'
          && isRecord(avatar.payload.profile)
          && avatar.payload.profile.avatarReference === marker;

        const avatarReadback = await readProfile(accessToken, userId);
        result.avatarReadback = avatarReadback.ok
          && isExactProfile(avatarReadback.row, userId, 'Nightly CI 검증', marker);
        const publicRead = await fetch(publicObjectUrl);
        result.avatarPublicRead = publicRead.ok;
        await publicRead.body?.cancel();

        const clear = await postJson(accessToken, avatarRpcPath, {
          p_expected_avatar_reference: marker,
          p_next_avatar_operation_id: null,
        });
        result.avatarCleared = clear.ok
          && isRecord(clear.payload)
          && clear.payload.status === 'applied'
          && clear.payload.reasonCode === 'PROFILE_AVATAR_UPDATED'
          && isRecord(clear.payload.profile)
          && clear.payload.profile.avatarReference === null;
        const cleanup = await fetch(`${supabaseUrl}/storage/v1/object/profile-avatars`, {
          method: 'DELETE',
          headers: fixedHeaders(accessToken),
          body: cleanupBody,
        });
        await cleanup.body?.cancel();
        const absence = await fetch(objectUrl, {
          method: 'HEAD',
          headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
        });
        result.objectAbsent = cleanup.ok && (absence.status === 400 || absence.status === 404);
        await absence.body?.cancel();

        const restore = await postJson(accessToken, nicknameRpcPath, {
          p_nickname: 'Nightly CI',
        });
        result.nicknameRestored = restore.ok
          && isRecord(restore.payload)
          && (restore.payload.status === 'applied' || restore.payload.status === 'unchanged')
          && isRecord(restore.payload.profile)
          && restore.payload.profile.nickname === 'Nightly CI';
        const finalProfile = await readProfile(accessToken, userId);
        result.finalReadback = finalProfile.ok
          && isExactProfile(finalProfile.row, userId, 'Nightly CI', null);
        return result;
      } finally {
        if (accessToken && userId) {
          if (marker) {
            try {
              await postJson(accessToken, avatarRpcPath, {
                p_expected_avatar_reference: marker,
                p_next_avatar_operation_id: null,
              });
            } catch {
              // The bounded final readback below remains authoritative.
            }
          }
          if (storageKey) {
            try {
              await fetch(`${supabaseUrl}/storage/v1/object/profile-avatars`, {
                method: 'DELETE',
                headers: fixedHeaders(accessToken),
                body: JSON.stringify({ prefixes: [storageKey] }),
              });
            } catch {
              // The test's explicit cleanup/absence evidence decides success.
            }
          }
          try {
            await postJson(accessToken, nicknameRpcPath, { p_nickname: 'Nightly CI' });
          } catch {
            // The test's explicit final readback decides success.
          }
        }
      }
    }, {
      anonKey: localSupabaseAnonKey,
      avatarJpegBase64: localProfileAvatarJpegBase64,
      avatarOperationId: localProfileAvatarOperationId,
      avatarRpcPath: LOCAL_PROFILE_AVATAR_CAS_RPC_PATH,
      directProfilePath: LOCAL_DIRECT_PROFILE_TABLE_PATH,
      email,
      nicknameRpcPath: LOCAL_PROFILE_NICKNAME_MUTATION_RPC_PATH,
      password,
      profileSummaryPath: LOCAL_PROFILE_SUMMARIES_RPC_PATH,
      supabaseUrl: localSupabaseUrl,
    });
    expect(evidence).toEqual({
      authenticated: true,
      directProfilesDenied: true,
      initialReadback: true,
      nicknameApplied: true,
      uploadStored: true,
      avatarApplied: true,
      avatarReadback: true,
      avatarPublicRead: true,
      avatarCleared: true,
      objectAbsent: true,
      nicknameRestored: true,
      finalReadback: true,
    });
  });

  test('authenticates the real synthetic admin, hydrates the console, and proves guarded read, preview, apply, readback and audit', async ({ page }) => {
    const email = process.env.NIGHTLY_ADMIN_EMAIL;
    const password = process.env.NIGHTLY_ADMIN_PASSWORD;
    expect(email).toBe('nightly-ci@local.invalid');
    expect(password?.length).toBeGreaterThanOrEqual(16);

    await page.goto('/');
    const unauthenticatedStatus = await page.evaluate(async () => {
      const response = await fetch('/api/admin/evaluations');
      return response.status;
    });
    expect(unauthenticatedStatus).toBe(401);

    const login = await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const response = await fetch(
        `${supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        },
      );
      const body = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        user?: { id?: string };
      };
      const hasAccessToken = typeof body.access_token === 'string' && body.access_token.length > 0;
      const hasRefreshToken = typeof body.refresh_token === 'string' && body.refresh_token.length > 0;
      const userIdIsUuid = /^[0-9a-f-]{36}$/.test(body.user?.id ?? '');
      if (response.status === 200 && hasAccessToken && hasRefreshToken && userIdIsUuid) {
        const raw = JSON.stringify({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: body.user,
        });
        const binary = Array.from(new TextEncoder().encode(raw), (byte) => String.fromCharCode(byte)).join('');
        const cookieValue = `base64-${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
        const supabaseHost = new URL(supabaseUrl).hostname.split('.')[0];
        document.cookie = `sb-${supabaseHost}-auth-token=${cookieValue}; Path=/; SameSite=Lax`;
      }
      return { status: response.status, hasAccessToken, hasRefreshToken, userIdIsUuid };
    }, {
      email,
      password,
      supabaseUrl: localSupabaseUrl,
      anonKey: localSupabaseAnonKey,
    });
    expect(login.status).toBe(200);
    expect(login.hasAccessToken).toBe(true);
    expect(login.hasRefreshToken).toBe(true);
    expect(login.userIdIsUuid).toBe(true);

    const pendingCountsResponsePromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return url.origin === localAppOrigin
          && url.pathname === '/api/admin/pending-counts'
          && response.request().method() === 'GET';
      },
      { timeout: 30_000 },
    );
    const dashboardSummaryResponsePromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return url.origin === localAppOrigin
          && url.pathname === '/api/dashboard/summary'
          && response.request().method() === 'GET';
      },
      { timeout: 30_000 },
    );
    await page.goto('/admin');
    const [pendingCountsResponse, dashboardSummaryResponse] = await Promise.all([
      pendingCountsResponsePromise,
      dashboardSummaryResponsePromise,
    ]);
    expect(pendingCountsResponse.status()).toBe(200);
    expect(dashboardSummaryResponse.status()).toBe(200);
    const dashboardSummary = await dashboardSummaryResponse.json() as {
      totals?: { restaurants?: number };
    };
    expect(dashboardSummary.totals?.restaurants).toBe(2);
    await expect(page.locator('[data-admin-dashboard-management="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-admin-dashboard-kpi-value-size="bounded"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-admin-dashboard-management-skeleton="true"]')).toHaveCount(0);

    const guarded = await page.evaluate(async () => {
      const response = await fetch('/api/admin/evaluations');
      const body = await response.json() as { records?: unknown[] };
      return { status: response.status, recordCount: body.records?.length ?? -1 };
    });
    expect(guarded.status).toBe(200);
    expect(guarded.recordCount).toBe(2);

    const normalized = {
      action: 'upsert',
      restaurantId: '00000000-0000-4000-8000-000000000101',
      overlayType: 'trend',
      label: '로컬 나이틀리',
      description: '실제 로컬 관리자 회귀',
      activeFrom: null,
      activeUntil: null,
      evidence: { source: 'local-nightly' },
      reason: 'local regression lifecycle',
    };
    const expectedNormalized = normalizeAdminMapOverlayPreviewRequest(normalized);
    const expectedPreviewHash = buildAdminMapOverlayPreviewHash(expectedNormalized);
    const expectedPayloadHash = buildAdminMapOverlayPayloadHash({
      normalized: expectedNormalized,
      rpcAction: mapAdminMapOverlayRouteActionToRpcAction(expectedNormalized.action),
      previewHash: expectedPreviewHash,
      confirmationText: ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
    });
    const lifecycle = await page.evaluate(async ({ payload, payloadHash, previewHash }) => {
      const previewResponse = await fetch('/api/admin/map-overlays/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const preview = await previewResponse.json() as {
        normalized: typeof payload;
        confirmation: { requiredText: string; previewHash: string; expiresAt: string };
      };
      if (previewResponse.status !== 200) {
        return { previewStatus: previewResponse.status };
      }
      const correlationId = '00000000-0000-4000-8000-000000000904';
      const applyBody = {
        normalized: preview.normalized,
        confirmationText: preview.confirmation.requiredText,
        previewHash: preview.confirmation.previewHash,
        previewExpiresAt: preview.confirmation.expiresAt,
        payloadHash,
        correlationId,
        idempotencyKey: 'local-nightly-map-overlay-v1',
      };
      const applyResponse = await fetch('/api/admin/map-overlays/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(applyBody),
      });
      const applied = await applyResponse.json() as {
        ok?: boolean;
        replayed?: boolean;
        audit?: { auditId?: string; correlationId?: string; payloadHash?: string };
        readback?: { matchedPayloadHash?: boolean; matchedPreviewHash?: boolean };
      };
      const replayResponse = await fetch('/api/admin/map-overlays/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(applyBody),
      });
      const replayed = await replayResponse.json() as {
        ok?: boolean;
        replayed?: boolean;
        audit?: { auditId?: string };
      };
      const readbackResponse = await fetch(
        '/api/admin/map-overlays?restaurantIds=00000000-0000-4000-8000-000000000101&types=trend',
      );
      const readback = await readbackResponse.json() as { overlays?: Array<{ label?: string }> };
      return {
        previewStatus: previewResponse.status,
        previewTextMatches: preview.confirmation.requiredText === '오버레이 적용',
        previewHashMatches: preview.confirmation.previewHash === previewHash,
        applyStatus: applyResponse.status,
        appliedOk: applied.ok === true,
        auditIdIsUuid: /^[0-9a-f-]{36}$/.test(applied.audit?.auditId ?? ''),
        correlationMatches: applied.audit?.correlationId === correlationId,
        payloadHashMatches: applied.audit?.payloadHash === payloadHash,
        readbackMatchedPayloadHash: applied.readback?.matchedPayloadHash === true,
        readbackMatchedPreviewHash: applied.readback?.matchedPreviewHash === true,
        replayStatus: replayResponse.status,
        replayedOk: replayed.ok === true && replayed.replayed === true,
        replayAuditMatches: replayed.audit?.auditId === applied.audit?.auditId,
        readbackStatus: readbackResponse.status,
        readbackHasFixture: readback.overlays?.some((overlay) => overlay.label === '로컬 나이틀리') === true,
      };
    }, { payload: normalized, payloadHash: expectedPayloadHash, previewHash: expectedPreviewHash });
    expect(lifecycle).toEqual({
      previewStatus: 200,
      previewTextMatches: true,
      previewHashMatches: true,
      applyStatus: 200,
      appliedOk: true,
      auditIdIsUuid: true,
      correlationMatches: true,
      payloadHashMatches: true,
      readbackMatchedPayloadHash: true,
      readbackMatchedPreviewHash: true,
      replayStatus: 200,
      replayedOk: true,
      replayAuditMatches: true,
      readbackStatus: 200,
      readbackHasFixture: true,
    });
  });
});
