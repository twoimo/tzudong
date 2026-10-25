import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ThumbnailWorkerOutbox } from '../../lib/admin/youtube-thumbnail-generator/worker-outbox';
const directory = process.env.FIXTURE_OUTBOX!; const identity = JSON.parse(process.env.FIXTURE_IDENTITY!);
const box = new ThumbnailWorkerOutbox(directory);
if (process.argv[2] === 'begin') {
  writeFileSync(`${directory}/ready-${process.pid}`, 'ready');
  const deadline = Date.now() + 5000;
  while (!existsSync(`${directory}/release`)) { if (Date.now() > deadline) throw new Error('fixture barrier timeout'); await delay(5); }
  console.log(JSON.stringify({ admitted: box.begin(identity) })); box.close();
} else if (process.argv[2] === 'save-and-kill') {
  const bytes = Buffer.from(process.env.FIXTURE_BYTES!, 'base64');
  box.save(identity, bytes, JSON.parse(process.env.FIXTURE_BUNDLE!));
  process.kill(process.pid, 'SIGKILL');
} else throw new Error('fixture mode rejected');
