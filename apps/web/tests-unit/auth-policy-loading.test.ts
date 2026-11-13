import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.createSourceFile("AuthModal.tsx", readFileSync(
  new URL("../components/auth/AuthModal.tsx", import.meta.url), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error("AUTH_POLICY_BOUNDARY_MISSING");
  return found;
}

function execute<T>(node: ts.Node, bindings: Record<string, unknown> = {}): T {
  const compiled = ts.transpileModule(`return (${node.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as T;
}

const effect = (find((node) => ts.isCallExpression(node)
  && node.expression.getText(source) === "useEffect"
  && node.arguments[0]?.getText(source).includes('fetch("/api/privacy/onboarding"')) as ts.CallExpression).arguments[0];
const constants = Object.fromEntries([
  "POLICY_VERSION_ID_PATTERN", "POLICY_CONTENT_SHA256_PATTERN", "POLICY_LOAD_TIMEOUT_MS",
].map((name) => {
  const declaration = find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name) as ts.VariableDeclaration;
  return [name, execute(declaration.initializer!)];
}));
const validPolicy = { id: "11111111-1111-4111-8111-111111111111", contentSha256: "a".repeat(64) };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const flush = () => Bun.sleep(0);

function request(pending: Promise<Response>, state = { phase: "", id: null as string | null, hash: null as string | null }) {
  let timeout = () => {};
  let timeoutCleared = false;
  let options: RequestInit | undefined;
  let url = "";
  const run = execute<() => () => void>(effect, {
    ...constants, isOpen: true, AbortController,
    fetch: (input: string, init: RequestInit) => { url = input; options = init; return pending; },
    setPolicyLoadState: (value: string) => { state.phase = value; },
    setPolicyVersion: (value: string | null) => { state.id = value; },
    setPolicyContentSha256: (value: string | null) => { state.hash = value; },
    setTimeout: (callback: () => void) => { timeout = callback; return 1; },
    clearTimeout: () => { timeoutCleared = true; },
  });
  const cleanup = run();
  return { state, cleanup, timeout: () => timeout(), request: () => ({ url, options }), timeoutCleared: () => timeoutCleared };
}

describe("authentication policy read lifecycle", () => {
  test("a failed read becomes an error and a valid retry supplies both validated policy fields", async () => {
    const first = request(Promise.resolve(response({}, 503)));
    expect(first.state).toEqual({ phase: "loading", id: null, hash: null });
    await flush();
    expect(first.state).toEqual({ phase: "error", id: null, hash: null });
    expect(first.request().url).toBe("/api/privacy/onboarding");
    expect(first.request().options?.method ?? "GET").toBe("GET");
    expect(first.request().options?.cache).toBe("no-store");
    first.cleanup();
    const retry = request(Promise.resolve(response(validPolicy)), first.state);
    await flush();
    expect(retry.state).toEqual({ phase: "ready", id: validPolicy.id, hash: validPolicy.contentSha256 });
    expect(retry.timeoutCleared()).toBe(true);
    retry.cleanup();
  });

  test("malformed or incomplete policy responses remain fail closed", async () => {
    for (const body of [null, [], {}, { ...validPolicy, id: "invalid" }, { ...validPolicy, contentSha256: "invalid" }]) {
      const f = request(Promise.resolve(response(body)));
      await flush();
      expect(f.state).toEqual({ phase: "error", id: null, hash: null });
      f.cleanup();
    }
  });

  test("transport failure becomes a retryable error", async () => {
    const f = request(Promise.reject(new Error("synthetic read failure")));
    await flush();
    expect(f.state).toEqual({ phase: "error", id: null, hash: null });
    expect(f.timeoutCleared()).toBe(true);
    f.cleanup();
  });

  test("timeout aborts the read and ignores a late success even if fetch ignores abort", async () => {
    let resolve!: (value: Response) => void;
    const f = request(new Promise<Response>((done) => { resolve = done; }));
    f.timeout();
    expect(f.state).toEqual({ phase: "error", id: null, hash: null });
    expect(f.request().options?.signal?.aborted).toBe(true);
    resolve(response(validPolicy));
    await flush();
    expect(f.state).toEqual({ phase: "error", id: null, hash: null });
    f.cleanup();
  });

  test("closing aborts a pending request without applying its later result", async () => {
    let resolve!: (value: Response) => void;
    const f = request(new Promise<Response>((done) => { resolve = done; }));
    f.cleanup();
    expect(f.request().options?.signal?.aborted).toBe(true);
    resolve(response(validPolicy));
    await flush();
    expect(f.state).toEqual({ phase: "loading", id: null, hash: null });
  });

  test("a replaced request cannot clear a newer valid policy", async () => {
    let resolve!: (value: Response) => void;
    const first = request(new Promise<Response>((done) => { resolve = done; }));
    first.cleanup();
    const second = request(Promise.resolve(response(validPolicy)), first.state);
    await flush();
    resolve(response({}, 503));
    await flush();
    expect(second.state).toEqual({ phase: "ready", id: validPolicy.id, hash: validPolicy.contentSha256 });
    second.cleanup();
  });
});
