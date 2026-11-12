import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseShardArgument, selectShard } from "../scripts/unit-test-shards.mjs";

const root = resolve(import.meta.dir, "../../..");
const workflow = readFileSync(resolve(root, ".github/workflows/web-admin-ci.yml"), "utf8");

describe("unit test shard selection", () => {
  test("keeps the unsharded invocation unchanged", () => {
    expect(parseShardArgument([])).toBeNull();
    expect(parseShardArgument(["other"])).toBeNull();
  });

  test("parses an explicit shard argument and rejects malformed values", () => {
    expect(parseShardArgument(["--shard", "2/4"])).toEqual({ shard: 2, count: 4 });
    for (const value of ["0/4", "5/4", "2/0", "2", "2/4/1", "", "a/b"]) {
      if (value === "") {
        expect(() => parseShardArgument(["--shard"])).toThrow("SHARD_ARGUMENT_INVALID");
        continue;
      }
      expect(() => parseShardArgument(["--shard", value])).toThrow();
    }
  });

  test("partitions every file exactly once and preserves sorted order", () => {
    const files = Array.from({ length: 10 }, (_value, index) => `tests-unit/file-${String(index).padStart(2, "0")}.test.ts`);
    const shards = [1, 2, 3, 4].map((shard) => selectShard(files, { shard, count: 4 }));
    const flattened = shards.flat().sort();
    expect(flattened).toEqual([...files].sort());
    expect(new Set(flattened).size).toBe(files.length);
    for (const shardFiles of shards) {
      const indexes = shardFiles.map((file) => files.indexOf(file));
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    }
    expect(shards.map((shardFiles) => shardFiles.length)).toEqual([3, 3, 2, 2]);
    for (let index = 0; index < files.length; index += 1) {
      const owners = [1, 2, 3, 4].filter((shard) => selectShard(files, { shard, count: 4 }).includes(files[index]));
      expect(owners).toHaveLength(1);
    }
  });

  test("refuses a shard that would run nothing", () => {
    expect(selectShard(["only.test.ts"], null)).toEqual(["only.test.ts"]);
    expect(() => selectShard(["only.test.ts"], { shard: 4, count: 4 })).toThrow("SHARD_EMPTY");
  });

  test("CI runs the unit suite in eight shards instead of one blocking step", () => {
    expect(workflow).toContain("  ubuntu-npm-unit:\n");
    expect(workflow).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8]");
    expect(workflow).toContain("run: npm run test:unit -- --shard ${{ matrix.shard }}/8");
    const authority = workflow.slice(workflow.indexOf("  ubuntu-npm-authority:\n"), workflow.indexOf("\n  ubuntu-npm-unit:\n"));
    expect(authority).not.toContain("npm run test:unit");
    expect(authority).not.toContain("npm run build");
    expect(workflow).toContain("  ubuntu-npm-build:\n");
  });
});
