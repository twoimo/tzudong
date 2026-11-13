import { mock } from 'bun:test';
import sharp from 'sharp';
let authorized = false;
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => authorized
  ? { ok: true, userId: 'synthetic-test-admin' }
  : { ok: false, response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }) } }));
const { GET, POST } = await import('../../app/api/admin/ocr-receipts/preview/route');
const url = 'http://localhost:18795/api/admin/ocr-receipts/preview';
const request = (body: unknown, origin = 'http://localhost:18795') => new Request(url, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const statuses: Record<string, number> = {};
statuses.unauthenticated = (await POST(request({}))).status;
authorized = true;
statuses.crossOrigin = (await POST(request({}, 'https://invalid.example'))).status;
process.env.OCR_PREVIEW_LOCAL_ENABLED = 'false';
statuses.disabled = (await POST(request({}))).status;
process.env.OCR_PREVIEW_LOCAL_ENABLED = 'true';
if (process.platform === 'darwin') {
  statuses.providerInjection = (await POST(request({ imageBase64: 'eA==', mimeType: 'image/png', provider: 'openai' }))).status;
  statuses.invalidImage = (await POST(request({ imageBase64: 'eA==', mimeType: 'image/png' }))).status;
  const image = await sharp(Buffer.from('<svg width="1000" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="60" y="120" font-family="Apple SD Gothic Neo, sans-serif" font-size="42">상호: 테스트식당</text><text x="60" y="240" font-family="Apple SD Gothic Neo, sans-serif" font-size="42">합계 15,000원</text></svg>')).png().toBuffer();
  const response = await POST(request({ imageBase64: image.toString('base64'), mimeType: 'image/png' }));
  statuses.preview = response.status;
  const payload = await response.json();
  if (payload.result?.total_amount !== 15000 || payload.cloudCalls !== 0 || payload.manualReviewRequired !== true) throw new Error('REAL_NATIVE_ROUTE_RESULT_INVALID');
  if (!response.headers.get('Cache-Control')?.includes('no-store')) throw new Error('RESULT_CACHE_NOT_DISABLED');
}
const capability = await (await GET()).json();
console.log(JSON.stringify({ statuses, actualLocalVision: process.platform === 'darwin', cloudAvailable: capability.cloudAvailable, mockedBoundary: 'requireAdmin only; no hosted DB or provider' }));
