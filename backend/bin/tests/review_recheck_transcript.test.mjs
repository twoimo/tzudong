import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repairTranscript } from '../review_recheck_transcript.mjs';
import { collectChannelTranscripts } from '../../restaurant-crawling/scripts/03-collect-transcript.js';

const video = 'ABCDEFGHIJK';
const link = `https://www.youtube.com/watch?v=${video}`;
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'review-transcript-')));
  fs.mkdirSync(path.join(root, 'meta'));
  fs.writeFileSync(path.join(root, 'urls.txt'), link + '\n');
  fs.writeFileSync(path.join(root, 'meta', video + '.jsonl'), JSON.stringify({
    youtube_link: link, channel_name: 'tzuyang', recollect_id: 0,
  }) + '\n');
  return root;
}

test('real scoped collector repairs one video and keeps skip-list updates disabled', async () => {
  const root = fixture(); let calls = 0; let options;
  try {
    const result = await repairTranscript('tzuyang', root, { collect: (channel, config, opts) => {
      options = opts;
      return collectChannelTranscripts(channel, config, {
        ...opts, loadSkipUrls: () => new Set(), acquireSlot: async () => {},
        releaseSlot: () => {}, waitForDelay: async () => {},
        getTranscriptForVideo: async id => {
          calls++; assert.equal(id, video);
          return { language: 'ko', source: 'fixture', transcript: [{ start: 0, text: 'fixture evidence' }] };
        },
      });
    }});
    assert.equal(result, 0); assert.equal(calls, 1);
    assert.equal(options.dataPath, root); assert.equal(options.videoId, video);
    assert.equal(options.recordNoTranscript(link), undefined);
    const row = JSON.parse(fs.readFileSync(path.join(root, 'transcript', video + '.jsonl'), 'utf8'));
    assert.equal(row.youtube_link, link); assert.equal(row.channel_name, 'tzuyang');
    assert.equal(row.recollect_id, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('multiple videos and foreign metadata are rejected before collector execution', async () => {
  for (const problem of ['urls', 'identity', 'symlink', 'public-directory']) {
    const root = fixture(); let calls = 0;
    try {
      if (problem === 'urls') fs.appendFileSync(path.join(root, 'urls.txt'), 'https://www.youtube.com/watch?v=ZZZZZZZZZZZ\n');
      if (problem === 'identity') fs.writeFileSync(path.join(root, 'meta', video + '.jsonl'), JSON.stringify({ youtube_link: link, channel_name: 'other', recollect_id: 0 }));
      if (problem === 'symlink') fs.symlinkSync(path.join(root, 'absent'), path.join(root, 'transcript'));
      if (problem === 'public-directory') fs.chmodSync(root, 0o755);
      const result = await repairTranscript('tzuyang', root, { collect: async () => { calls++; } });
      assert.equal(result, problem === 'identity' ? 20 : 23); assert.equal(calls, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('existing transcript is never overwritten by repair', async () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'transcript'));
    const output = path.join(root, 'transcript', video + '.jsonl');
    fs.writeFileSync(output, 'original bytes');
    assert.equal(await repairTranscript('tzuyang', root, { collect: () => assert.fail('collector invoked') }), 23);
    assert.equal(fs.readFileSync(output, 'utf8'), 'original bytes');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('missing transcript and transient provider failure are distinct and not retried', async () => {
  const root = fixture();
  try {
    for (const [behavior, expected] of [
      [() => ({ success: 0, failed: 1 }), 22],
      [() => { throw Object.assign(new Error('private diagnostic'), { code: 'ETIMEDOUT' }); }, 21],
      [() => ({ success: 1 }), 22],
    ]) {
      let calls = 0;
      const code = await repairTranscript('tzuyang', root, { collect: async () => { calls++; return behavior(); } });
      assert.equal(code, expected); assert.equal(calls, 1);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unknown channel is never defaulted', async () => {
  const root = fixture();
  try {
    assert.equal(await repairTranscript(null, root, { collect: () => assert.fail('collector invoked') }), 24);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
