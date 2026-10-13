#!/usr/bin/env node
/**
 * Source-pinned port of Supabase CLI v2.109.1 parser SplitAndTrim.
 * Upstream commit/path/blob identities are part of this executable contract.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export const UPSTREAM_COMMIT = "6d4c19870ed213ba7f682f117d0345c8a40bfa94";
export const UPSTREAM_VERSION = "v2.109.1";
export const TOKEN_PATH = "apps/cli-go/pkg/parser/token.go";
export const TOKEN_BLOB = "db008434246be335b9f7abaf0cb66a99a2b40378";
export const STATE_PATH = "apps/cli-go/pkg/parser/state.go";
export const STATE_BLOB = "47775390d1731c0ad29e10b20fb2fe16c8cfcadb";
const fail = message => { process.stderr.write(`g037 parser: ${message}\n`); process.exit(2); };
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

/* Exact port of parser.State.Next over the same UTF-8 byte prefixes supplied by
 * tokenizer.ScanToken.  Unsupported invalid UTF-8 and non-default scanner
 * configuration fail closed rather than silently changing Go's byte contract. */
const MAX_SCANNER_CAPACITY = 256 * 1024;
const GO_SPACE = /\p{White_Space}/u;
const IDENTIFIER_RUNE = /[\p{L}\p{Nd}_$]/u;
const TAG_RUNE = /[\p{L}\p{Nd}_]/u;
const trimSpace = value => {
  const runes = Array.from(value); let left = 0, right = runes.length;
  while (left < right && GO_SPACE.test(runes[left])) left++;
  while (right > left && GO_SPACE.test(runes[right - 1])) right--;
  return runes.slice(left, right).join("");
};
const trimRightSpace = value => {
  const runes = Array.from(value); let right = runes.length;
  while (right > 0 && GO_SPACE.test(runes[right - 1])) right--;
  return runes.slice(0, right).join("");
};
const trimRightSemicolons = value => {
  let right = value.length;
  while (right > 0 && value[right - 1] === ";") right--;
  return value.slice(0, right);
};
const equalFold = (bytes, value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "iu").test(bytes.toString("utf8"));
const lastRune = bytes => Array.from(bytes.toString("utf8")).at(-1);
const isBeginAtomic = bytes => {
  const atomic = Buffer.from("ATOMIC");
  let offset = bytes.length - atomic.length;
  if (offset < 0 || !equalFold(bytes.subarray(offset), "ATOMIC")) return false;
  if (offset > 0 && IDENTIFIER_RUNE.test(lastRune(bytes.subarray(0, offset)))) return false;
  const prefix = trimRightSpace(bytes.subarray(0, offset).toString("utf8"));
  offset = Buffer.byteLength(prefix) - 5;
  if (offset < 0 || !equalFold(Buffer.from(prefix, "utf8").subarray(offset), "BEGIN")) return false;
  return offset === 0 || !IDENTIFIER_RUNE.test(lastRune(Buffer.from(prefix, "utf8").subarray(0, offset)));
};
const ready = () => ({ kind: "ready" });
const next = (state, rune, data) => {
  if (state.kind === "ready") {
    if (rune === "$") return { kind: "tag", offset: data.length - Buffer.byteLength(rune) };
    if (rune === "'" || rune === '"') return { kind: "quote", delimiter: rune, escape: false };
    if (rune === "-") return { kind: "comment" };
    if (rune === "/") return { kind: "block", depth: 0 };
    if (rune === "\\") return { kind: "escape" };
    if (rune === ";") return null;
    if (rune === "(") return { kind: "atomic", previous: state, delimiter: Buffer.from(")") };
    if ((rune === "c" || rune === "C") && isBeginAtomic(data)) return { kind: "atomic", previous: state, delimiter: Buffer.from("END") };
    return state;
  }
  if (state.kind === "comment") return rune === "-" ? { kind: "dollar", delimiter: Buffer.from("\n") } : next(ready(), rune, data);
  if (state.kind === "block") {
    const window = data.subarray(data.length - 2);
    if (window.equals(Buffer.from("/*"))) { state.depth++; return state; }
    if (state.depth === 0) return next(ready(), rune, data);
    if (window.equals(Buffer.from("*/"))) { state.depth--; if (state.depth === 0) return ready(); }
    return state;
  }
  if (state.kind === "quote") {
    if (state.escape) return rune === state.delimiter ? { ...state, escape: false } : next(ready(), rune, data);
    if (rune === state.delimiter) state.escape = true;
    return state;
  }
  if (state.kind === "dollar") return data.subarray(data.length - state.delimiter.length).equals(state.delimiter) ? ready() : state;
  if (state.kind === "tag") {
    if (rune === "$") return { kind: "dollar", delimiter: Buffer.from(data.subarray(state.offset)) };
    return TAG_RUNE.test(rune) ? state : next(ready(), rune, data);
  }
  if (state.kind === "escape") return ready();
  if (state.kind === "atomic") {
    const current = next(state.previous, rune, data);
    if (current !== null) state.previous = current;
    if (state.previous.kind === "ready" && equalFold(data.subarray(data.length - state.delimiter.length), state.delimiter.toString("ascii"))) return ready();
    return state;
  }
  throw new Error("unknown parser state");
};
export function splitAndTrim(raw) {
  if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw, "utf8");
  if (!Buffer.from(raw.toString("utf8"), "utf8").equals(raw)) throw new Error("invalid UTF-8 is unsupported");
  if (process.env.SUPABASE_SCANNER_BUFFER_SIZE) throw new Error("non-default SUPABASE_SCANNER_BUFFER_SIZE is unsupported");
  const statements = []; let start = 0, offset = 0, state = ready();
  while (offset < raw.length) {
    const first = raw[offset]; let width = 1;
    if (first >= 0x80) {
      if ((first & 0xe0) === 0xc0) width = 2;
      else if ((first & 0xf0) === 0xe0) width = 3;
      else if ((first & 0xf8) === 0xf0) width = 4;
    }
    const end = offset + width, rune = raw.subarray(offset, end).toString("utf8");
    state = next(state, rune, raw.subarray(start, end));
    // bufio.Scanner permits a max-sized token only when Split emits it before
    // it requires another buffer growth; an unterminated max-sized token fails.
    if (state !== null && end - start >= MAX_SCANNER_CAPACITY) throw new Error("statement exceeds pinned default scanner capacity");
    if (state === null) {
      const token = trimSpace(trimRightSemicolons(raw.subarray(start, end).toString("utf8")));
      if (token) statements.push(token);
      start = end; state = ready();
    }
    offset = end;
  }
  const tail = trimSpace(trimRightSemicolons(raw.subarray(start).toString("utf8")));
  if (tail) statements.push(tail);
  return statements;
}
function main() {
  const a = process.argv.slice(2);
  if (a.length !== 8 || a[0] !== "--source" || a[2] !== "--version" || a[4] !== "--sha256" || a[6] !== "--size" || !/^\d{14}$/.test(a[3]) || !new RegExp(`^${a[3]}_[A-Za-z0-9_]+\\.sql$`).test(a[1].replace(/^.*[\\/]/, "")) || !/^[a-f0-9]{64}$/.test(a[5]) || !/^\d+$/.test(a[7])) fail("expected pinned source identity");
  let raw, size;
  try { raw = readFileSync(a[1]); size = statSync(a[1]).size; } catch { fail("source unreadable"); }
  if (size !== Number(a[7]) || createHash("sha256").update(raw).digest("hex") !== a[5]) fail("source size/hash mismatch");
  let statements; try { statements = splitAndTrim(raw); } catch { fail("unsupported parser input"); }
  if (!statements.length) fail("empty migration vector");
  process.stdout.write(canonical({ schema:"g037-supabase-statement-vector-v1", upstream:{commit:UPSTREAM_COMMIT,version:UPSTREAM_VERSION,token:{path:TOKEN_PATH,blob:TOKEN_BLOB},state:{path:STATE_PATH,blob:STATE_BLOB}}, version:a[3], source_sha256:a[5], source_size:size, statements }) + "\n");
}
main();
