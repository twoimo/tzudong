// Deterministic shard selection for the web unit suite.
//
// The full suite runs 600+ test files in one Bun process, which makes the CI
// lane the longest job in the pipeline (about 16 minutes on a 4-core runner).
// Splitting the same inventory across parallel jobs keeps the inventory and
// the isolation rules unchanged: the caller still runs every file exactly once,
// and each shard receives a stable subset of the sorted list.
//
// Selection is index round-robin over the sorted inventory so that adding a
// file only moves that file and never reshuffles the rest of a shard.

const SHARD_PATTERN = /^([1-9][0-9]*)\/([1-9][0-9]*)$/;

export function parseShardArgument(argv) {
  const index = argv.indexOf('--shard');
  if (index === -1) return null;
  const value = argv[index + 1];
  const match = SHARD_PATTERN.exec(value ?? '');
  if (!match) throw new Error('SHARD_ARGUMENT_INVALID');
  const shard = Number(match[1]);
  const count = Number(match[2]);
  if (shard > count) throw new Error('SHARD_INDEX_OUT_OF_RANGE');
  return { shard, count };
}

export function selectShard(files, shard) {
  if (!shard) return [...files];
  const selected = files.filter((_file, index) => index % shard.count === shard.shard - 1);
  if (selected.length === 0) throw new Error('SHARD_EMPTY');
  return selected;
}
