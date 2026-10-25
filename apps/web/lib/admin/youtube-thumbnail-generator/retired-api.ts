import { requireAdmin } from '@/lib/auth/require-admin';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { STORYBOARD_GEMINI_IMAGE_MODELS } from '../storyboard/gemini-models';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff' };
/** Stale clients fail closed instead of reaching removed image providers. No body/provider/key is read. */
export function createRetiredThumbnailGenerationApi(authorize: typeof requireAdmin = requireAdmin) {
  return {
    GET: async () => {
      const auth = await authorize(); if (!auth.ok) return auth.response;
      return Response.json({ execution: 'durable-queue', providerId: 'gemini-api',
        models: STORYBOARD_GEMINI_IMAGE_MODELS, availability: 'unverified' }, { headers });
    },
    POST: async (request: Request) => {
      const auth = await authorize(); if (!auth.ok) return auth.response;
      const scoped = new Headers(request.headers); scoped.delete('authorization');
      if (!isTrustedSameOriginMutation(new Request(request.url, { method: 'POST', headers: scoped }))) {
        return Response.json({ error: 'origin_forbidden' }, { status: 403, headers });
      }
      return Response.json({ error: 'thumbnail_legacy_generation_retired',
        detail: '이미지 생성 방식이 변경되었습니다. 페이지를 새로고침해 주세요.' }, { status: 410, headers });
    },
  };
}
export const retiredThumbnailGenerationApi = createRetiredThumbnailGenerationApi();
