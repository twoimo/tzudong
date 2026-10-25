import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { supabaseThumbnailStorage, ThumbnailPrivateStore } from '../../lib/admin/youtube-thumbnail-generator/private-store';

// Actual pinned SDK with synthetic HTTP. The parent additionally uses macOS
// OS egress denial when available; this fixture alone does not prove it.
const objects = new Map<string, Buffer>(); let uploads = 0; let deletes = 0; let cancelled = false;
const uploadHeaders: string[] = []; const caches: (RequestCache | undefined)[] = [];
let startRpcRequests = 0;
const json = (value: unknown, status = 200) => Response.json(value, { status });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init); const url = new URL(request.url);
  assert.equal(url.origin, 'https://fixture.supabase.co');
  if (url.pathname === '/rest/v1/rpc/thumbnail_production_worker') {
    assert.equal(request.method, 'POST'); const body = await request.json(); assert.equal(body.p_action, 'start');
    startRpcRequests++; return json({ message: 'synthetic unknown transient failure' }, 503);
  }
  assert.ok(url.pathname.startsWith('/storage/v1/object/youtube-thumbnail-jobs/'));
  const path = url.pathname.split('/youtube-thumbnail-jobs/')[1];
  if (request.method === 'DELETE') { deletes++; throw new Error('synthetic delete forbidden'); }
  if (request.method === 'GET') {
    caches.push(init?.cache);
    if (path === 'missing-bucket') return json({ code: 'NoSuchBucket', message: 'synthetic missing bucket' }, 404);
    if (path === 'legacy-ambiguous') return json({ code: 'not_found', message: 'synthetic ambiguous missing resource' }, 404);
    if (path === 'oversized') return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; },
    }));
    const bytes = objects.get(path);
    return bytes ? new Response(new Uint8Array(bytes)) : json({ code: 'NoSuchKey', message: 'synthetic missing key' }, 404);
  }
  assert.equal(request.method, 'POST'); uploads++;
  const upsert = request.headers.get('x-upsert'); uploadHeaders.push(String(upsert)); assert.equal(upsert, 'false');
  if (objects.has(path)) return json({ code: 'KeyAlreadyExists', message: 'synthetic immutable object' }, 409);
  objects.set(path, Buffer.from(await request.arrayBuffer()));
  throw new Error('synthetic lost upload ACK');
}) as typeof fetch;
const storage = supabaseThumbnailStorage();
assert.equal(await storage.read('missing', 100), null);
await assert.rejects(storage.read('missing-bucket', 100), { code: 'storage_unavailable' });
await assert.rejects(storage.read('legacy-ambiguous', 100), { code: 'storage_unavailable' });
const original = Buffer.from('synthetic original immutable pixels');
await assert.rejects(storage.upload('image.png', original, 'image/png'), { code: 'write_unconfirmed' });
assert.deepEqual(await storage.read('image.png', 100), original);
await assert.rejects(storage.upload('image.png', Buffer.from('changed'), 'image/png'), { code: 'write_unconfirmed' });
assert.deepEqual(objects.get('image.png'), original);
await assert.rejects(storage.read('oversized', 16), { code: 'object_conflict' });
assert.equal(cancelled, true); assert.ok(caches.every((cache) => cache === 'no-store'));
await assert.rejects(new ThumbnailPrivateStore().workerOperation({ id: randomUUID(), ownerId: randomUUID(),
  models: ['gemini-3.1-flash-image'], tokenHash: 'a'.repeat(64) }, 'start', {
  jobId: randomUUID(), attemptId: randomUUID(), fence: 1, inputSha256: 'b'.repeat(64),
}), { code: 'write_unconfirmed' });
assert.equal(startRpcRequests, 1);
process.stdout.write(JSON.stringify({ actualSdk: true, syntheticHttp: true, uploads, deletes,
  uploadHeaders, noStore: true, oversizedStreamCancelled: cancelled, originalPreserved: true, startRpcRequests }) + '\n');
