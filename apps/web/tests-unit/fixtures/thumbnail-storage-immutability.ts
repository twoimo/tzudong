import { thumbnailReleaseFixture } from './thumbnail-release-fixture';
import { publishThumbnailDurableRelease } from '../../lib/admin/youtube-thumbnail-generator/release-registry';

// Fresh actual Supabase/Storage clients with synthetic HTTP. The parent also
// checks macOS OS egress denial; the portable run does not claim that isolation.
const f = await thumbnailReleaseFixture();
const original = Buffer.from('synthetic-existing-published-object');
let stored = original;
let uploadCount = 0, publishCalls = 0, deleteCount = 0;
let upsertHeader: string | null = null;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== 'https://fixture.supabase.co') throw new Error('FIXTURE_HTTP_TARGET_REJECTED');
  if (request.method === 'POST' && url.pathname.startsWith('/storage/v1/object/')) {
    uploadCount++;
    upsertHeader = request.headers.get('x-upsert');
    if (upsertHeader !== 'true') return json({ statusCode: '409', error: 'Duplicate', message: 'fixture object already exists' }, 409);
    stored = Buffer.from(await request.arrayBuffer());
    return json({ Key: 'fixture', Id: f.options.releaseId });
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/publish_youtube_thumbnail_release') {
    publishCalls++;
    return json({ code: '23505', message: 'fixture duplicate release' }, 409);
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/youtube_thumbnail_releases') return json([]);
  if (request.method === 'DELETE' && url.pathname.startsWith('/storage/v1/object/')) {
    deleteCount++; stored = Buffer.alloc(0); return json([]);
  }
  throw new Error('FIXTURE_HTTP_PATH_REJECTED');
}) as typeof fetch;
try {
  await publishThumbnailDurableRelease({ candidateId: 'fixture' }, process.env, f.options).catch(() => undefined);
  process.stdout.write(JSON.stringify({ unmodified: stored.equals(original), uploadCount, publishCalls, deleteCount, upsertHeader }) + '\n');
} finally { f.cleanup(); }
