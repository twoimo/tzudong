import { describe, expect, test } from 'bun:test';
import { prepareThumbnailBrowserReferences } from '../lib/admin/youtube-thumbnail-generator/browser-references';
import { TZUYANG_THUMBNAIL_CHANNEL_ID } from '../lib/admin/youtube-thumbnail-generator/queue-contract';

const ownerId = '6f5d42d6-d122-4d32-b8bb-2779de58b423';
const brief = { topic: '쯔양 한상', headline: '한상 검증', stylePreset: 'tzuyang-food-travel-collage' as const, acknowledgedSafety: true as const };
const file = () => new File([new Uint8Array(32)], 'manual.png', { type: 'image/png' });
const metadata = (channelId = TZUYANG_THUMBNAIL_CHANNEL_ID) => ({ channelId, bucketStartedAt: '2026-10-23T12:00:00Z',
  references: [{ videoId: 'video000001', title: '한상', role: 'host' }] });

describe('bounded collected thumbnail reference preparation', () => {
  test('one bounded quality fallback keeps the selected bytes, role and original owner header', async () => {
    // Decoder seam only: actual bitmap decoding is exercised by thumbnail-editor-browser.
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'); let closed = 0;
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 640, height: 360, close() { closed++; } }) });
    const calls: Array<{ path: string; body: unknown; owner: string | null }> = [];
    try {
      const result = await prepareThumbnailBrowserReferences(brief, [], { ownerId, fetch: (async (path, init) => {
        calls.push({ path: String(path), body: JSON.parse(String(init?.body)), owner: new Headers(init?.headers).get('X-Thumbnail-Owner') });
        if (String(path).endsWith('reference-candidates')) return Response.json(metadata());
        if (String(init?.body).includes('maxresdefault')) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(32), { headers: { 'Content-Type': 'image/png' } });
      }) as typeof fetch });
      expect(calls).toHaveLength(3); expect(calls.every((call) => call.owner === ownerId)).toBe(true);
      expect(calls[2].body).toEqual({ url: 'https://img.youtube.com/vi/video000001/sddefault.jpg' });
      expect(result.references[0].role).toBe('host'); expect(result.references[0].file.size).toBe(32);
      expect(result.automatic).toEqual([{ videoId: 'video000001', title: '한상' }]); expect(closed).toBe(1);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
      else Reflect.deleteProperty(globalThis, 'createImageBitmap');
    }
  });
  test('foreign channel metadata cannot supply a host; an existing manual host still works on lookup failure', async () => {
    let calls = 0; const fetcher = (async () => { calls++; return Response.json(metadata('foreign')); }) as typeof fetch;
    await expect(prepareThumbnailBrowserReferences(brief, [], { fetch: fetcher })).rejects.toThrow('host_reference_required');
    expect(calls).toBe(1);
    const manual = { file: file(), role: 'host' as const };
    expect((await prepareThumbnailBrowserReferences(brief, [manual], { fetch: fetcher })).references).toEqual([manual]);
    expect(calls).toBe(2);
  });
  test('oversized inputs stop before lookup and cancellation does not fall back to manual success', async () => {
    let calls = 0; const fetcher = (async () => { calls++; throw new Error('unavailable'); }) as typeof fetch;
    await expect(prepareThumbnailBrowserReferences(brief, Array.from({ length: 9 }, () => ({ file: file(), role: 'host' as const })),
      { fetch: fetcher })).rejects.toThrow('reference_limit');
    expect(calls).toBe(0);
    const controller = new AbortController(); controller.abort();
    await expect(prepareThumbnailBrowserReferences(brief, [{ file: file(), role: 'host' }],
      { fetch: fetcher, signal: controller.signal })).rejects.toThrow();
  });
});
