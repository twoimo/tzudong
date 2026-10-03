import fs from 'node:fs';
import path from 'node:path';
import { collectChannelTranscripts } from '../restaurant-crawling/scripts/03-collect-transcript.js';

// Reuse the existing collector in run-owned scratch only. A missing transcript
// never changes the shared permanent-skip list or an operator's local corpus.
const [channel, dataPath] = process.argv.slice(2);
try {
  const urls = fs.readFileSync(path.join(dataPath, 'urls.txt'), 'utf8').trim().split('\n');
  if (!path.isAbsolute(dataPath) || urls.length !== 1 || !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(urls[0])) throw new Error('source');
  const result = await collectChannelTranscripts(channel, { name: channel }, { dataPath, recordNoTranscript: () => {} });
  if (result.success !== 1) throw new Error('source');
  process.exit(0);
} catch {
  console.error('REVIEW_RECHECK_TRANSCRIPT_UNAVAILABLE');
  process.exit(1);
}
