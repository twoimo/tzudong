import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { KNOWLEDGE_SHARD_MAX_BYTES, queryKnowledgeGraphExport, type KnowledgeShardReader } from './knowledge-graph-shards';

function unavailable(): never { throw new Error('knowledge_unavailable'); }

/** Only the route's fixed server directory (or an isolated test directory).
 * Request parameters never select paths. Every read is bounded, uncached and
 * checked again after reading, including the manifest publication boundary.
 */
export async function localKnowledgeGraphReader(directory: string): Promise<KnowledgeShardReader> {
  if ((await lstat(directory)).isSymbolicLink()) unavailable();
  const root = await realpath(directory);
  return async (name, maximum) => {
    if (name !== 'tzudong.json' && !/^shards\/(?:nodes|edges)(?:-index)?-[a-f0-9]{64}\.json$/.test(name)) unavailable();
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > KNOWLEDGE_SHARD_MAX_BYTES) unavailable();
    const path = join(root, name);
    if (name.startsWith('shards/') && (await lstat(join(root, 'shards'))).isSymbolicLink()) unavailable();
    if (await realpath(path) !== path) unavailable();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maximum) unavailable();
      const buffer = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat(), current = await lstat(path);
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
        || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
        || await realpath(path) !== path) unavailable();
      return buffer.subarray(0, length);
    } finally { await handle.close(); }
  };
}

export async function readLocalKnowledgeGraph(params: URLSearchParams, directory = resolve(process.cwd(), 'data/knowledge-graph')) {
  try {
    const reader = await localKnowledgeGraphReader(directory);
    const raw = await reader('tzudong.json', KNOWLEDGE_SHARD_MAX_BYTES);
    const snapshot: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    return await queryKnowledgeGraphExport(snapshot, params, reader);
  } catch (error) {
    if (error instanceof Error && ['knowledge_query_invalid', 'knowledge_cursor_stale'].includes(error.message)) throw error;
    unavailable();
  }
}
