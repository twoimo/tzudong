import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectChannelTranscripts, isValidTranscriptRecord } from '../restaurant-crawling/scripts/03-collect-transcript.js';

// Reuse the existing collector in run-owned scratch only. A missing transcript
// never changes the shared permanent-skip list or an operator's local corpus.
export async function repairTranscript(channel, dataPath, { collect = collectChannelTranscripts } = {}) {
  if (typeof channel !== 'string' || !/^[A-Za-z0-9_-]+$/.test(channel)) return 24;
  let videoId;
  try {
    if (typeof dataPath !== 'string' || !path.isAbsolute(dataPath) || fs.realpathSync(dataPath) !== dataPath) return 23;
    const info = fs.statSync(dataPath);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) return 23;
    const corpus = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../restaurant-crawling/data');
    if (dataPath === corpus || dataPath.startsWith(corpus + path.sep)) return 23;
    for (const entry of ['urls.txt', 'meta', 'transcript', '.stage-locks']) {
      const candidate = path.join(dataPath, entry);
      if (fs.lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) return 23;
    }
    const urls = fs.readFileSync(path.join(dataPath, 'urls.txt'), 'utf8').trim().split('\n');
    if (urls.length !== 1 || !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(urls[0])) return 23;
    videoId = urls[0].slice(-11);
    const metaPath = path.join(dataPath, 'meta', videoId + '.jsonl');
    if (fs.lstatSync(metaPath).isSymbolicLink()) return 23;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8').trim().split('\n').at(-1));
    if (meta.youtube_link !== urls[0] || meta.channel_name !== channel) return 20;
    if (!Number.isSafeInteger(meta.recollect_id) || meta.recollect_id < 0) return 23;
    // Repair is missing-only; existing bytes must be checked by the caller.
    const output = path.join(dataPath, 'transcript', videoId + '.jsonl');
    if (fs.lstatSync(output, { throwIfNoEntry: false })) return 23;
  } catch { return 23; }
  try {
    const result = await collect(channel, { name: channel }, {
      dataPath, videoId, recordNoTranscript: () => {},
    });
    // No transcript is not proof of permanent deletion/unrecoverability.
    if (result?.success !== 1 || result.failed) return 22;
    const output = path.join(dataPath, 'transcript', videoId + '.jsonl');
    const info = fs.lstatSync(output);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) return 23;
    const stored = JSON.parse(fs.readFileSync(output, 'utf8').trim().split('\n').at(-1));
    return isValidTranscriptRecord(stored, videoId, channel) ? 0 : 23;
  } catch (error) {
    if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(error?.code)) return 21;
    return 22;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const result = args.length === 2 ? await repairTranscript(...args) : 23;
  if (result) console.error('REVIEW_RECHECK_TRANSCRIPT_UNAVAILABLE');
  process.exitCode = result;
}
