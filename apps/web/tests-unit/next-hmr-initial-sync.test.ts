import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Run the real Next module in a Node subprocess, outside Bun's shared module/mock registry.
// Both exact revisions are evaluated in memory; this test never edits node_modules.
const modulePath = join(import.meta.dir, '..', 'node_modules', 'next', 'dist', 'server', 'dev', 'hot-middleware.js');
const probe = String.raw`
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');

const file = process.argv[1];
const originalSha = 'dfe8d350b7d13436f8409892c992cf90f20d7795a25235c4ca30764353b6afcc';
const patchedSha = 'a8e1623f41b8df1d17e6e90c4ae3d439b24b654ba035a03b3d91e8b22c11d56c';
const oldCall = '                this.publish({\n                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC,';
const newCall = '                this.publishToClient(client, {\n                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC,';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const exactReplace = (source, from, to) => {
  if (source.split(from).length !== 2) throw new Error('source_shape');
  return source.replace(from, to);
};
const moduleRequire = createRequire(file);
const load = (source) => {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(moduleRequire, module, module.exports);
  return module.exports.WebpackHotMiddleware;
};
const hook = () => {
  const callbacks = [];
  return {
    tap(_name, callback) { callbacks.push(callback); },
    call(...args) { for (const callback of callbacks) callback(...args); },
  };
};
const compiler = () => ({ hooks: { invalid: hook(), done: hook() } });
const stats = (revision, errors = [], warnings = [], middleware = false) => ({
  hasErrors() { return errors.length > 0; },
  toJson() { return { hash: revision, errors, warnings }; },
  compilation: { entrypoints: new Map(middleware ? [['middleware', {}]] : []) },
});
class Socket {
  messages = [];
  listeners = [];
  terminations = 0;
  addEventListener(event, callback) { if (event === 'close') this.listeners.push(callback); }
  send(data) { this.messages.push(JSON.parse(data)); }
  terminate() { this.terminations++; this.close(); }
  close() { for (const callback of this.listeners) callback(); }
  count(type) { return this.messages.filter((message) => message.type === type).length; }
  last(type) { return this.messages.filter((message) => message.type === type).at(-1); }
}
const harness = (Middleware) => {
  const compilers = [compiler(), compiler(), compiler()];
  const middleware = new Middleware(compilers, {}, '',
    { experimental: { requestInsights: false }, cacheComponents: false }, {});
  return { compilers, middleware };
};
function evaluate(Middleware) {
  const result = {};
  const { compilers, middleware } = harness(Middleware);
  const first = new Socket();
  const second = new Socket();
  const legacy = new Socket();
  compilers[0].hooks.done.call(stats('client-1', ['client-error'], ['client-warning']));
  middleware.onHMR(first, 'first-request');
  const initial = first.last('sync');
  result.firstPayload = first.count('sync') === 1 && first.count('built') === 0
    && initial?.hash === 'client-1'
    && initial.errors?.length === 1 && initial.errors[0] === 'client-error'
    && initial.warnings?.length === 1 && initial.warnings[0] === 'client-warning';
  middleware.onHMR(second, 'second-request');
  result.initialTargeted = first.count('sync') === 1 && second.count('sync') === 1;
  compilers[0].hooks.done.call(stats('client-2', ['client-error'], ['client-warning']));
  result.buildBroadcast = first.count('built') === 1 && second.count('built') === 1
    && [first, second].every((socket) => socket.last('built')?.hash === 'client-2');
  middleware.onHMR(legacy);
  result.legacyTargeted = first.count('sync') === 1 && second.count('sync') === 1
    && legacy.count('sync') === 1;
  compilers[0].hooks.done.call(stats('client-3'));
  result.legacyBuildBroadcast = first.count('built') === 2 && second.count('built') === 2
    && legacy.count('built') === 1;
  compilers[1].hooks.done.call(stats('server-error', ['server-error']));
  result.errorBuildBroadcast = first.count('built') === 3 && second.count('built') === 3
    && legacy.count('built') === 2
    && [first, second, legacy].every((socket) => socket.last('built')?.errors?.[0] === 'server-error');
  const beforeClose = [first, second, legacy].map((socket) => socket.messages.length);
  middleware.close();
  compilers[0].hooks.done.call(stats('after-close'));
  result.closeStops = middleware.getClientCount() === 0 && !middleware.hasClients()
    && [first, second, legacy].every((socket, index) => socket.terminations === 1
      && socket.messages.length === beforeClose[index]);

  const payload = harness(Middleware);
  const payloadFirst = new Socket();
  const payloadSecond = new Socket();
  const payloadThird = new Socket();
  payload.compilers[0].hooks.done.call(stats('payload-client', ['client-error'], ['client-warning']));
  payload.middleware.onHMR(payloadFirst, 'payload-first');
  payload.compilers[2].hooks.done.call(stats('middleware-error', ['middleware-error'], ['middleware-warning'], true));
  result.middlewareBuilt = payloadFirst.count('built') === 1
    && payloadFirst.last('built')?.errors?.[0] === 'middleware-error';
  payload.middleware.onHMR(payloadSecond, 'payload-second');
  const combined = payloadSecond.last('sync');
  result.middlewareSyncPayload = combined?.hash === 'payload-client'
    && combined.errors?.length === 2
    && combined.errors.includes('client-error') && combined.errors.includes('middleware-error')
    && combined.warnings?.length === 2
    && combined.warnings.includes('client-warning') && combined.warnings.includes('middleware-warning');
  payload.compilers[2].hooks.invalid.call();
  result.middlewareRecoveryBuilt = payloadFirst.count('built') === 2
    && payloadSecond.count('built') === 1
    && [payloadFirst, payloadSecond].every((socket) => socket.last('built')?.hash === 'payload-client'
      && socket.last('built')?.errors?.length === 1);
  payload.middleware.onHMR(payloadThird, 'payload-third');
  const recovered = payloadThird.last('sync');
  result.middlewareRecoverySync = recovered?.errors?.length === 1
    && recovered.errors[0] === 'client-error'
    && recovered.warnings?.length === 1
    && recovered.warnings[0] === 'client-warning';
  payload.middleware.close();

  const lifecycle = harness(Middleware);
  const stale = new Socket();
  const other = new Socket();
  const reconnected = new Socket();
  lifecycle.compilers[0].hooks.done.call(stats('lifecycle-1'));
  lifecycle.middleware.onHMR(stale, 'lifecycle-first');
  lifecycle.middleware.onHMR(other, 'lifecycle-other');
  stale.close();
  lifecycle.compilers[0].hooks.done.call(stats('lifecycle-2'));
  result.individualClose = lifecycle.middleware.getClientCount() === 1
    && stale.count('built') === 0 && other.count('built') === 1;
  lifecycle.middleware.onHMR(reconnected, 'lifecycle-first');
  result.reconnectSync = reconnected.count('sync') === 1
    && reconnected.last('sync')?.hash === 'lifecycle-2'
    && lifecycle.middleware.getClient('lifecycle-first') === reconnected;
  lifecycle.compilers[0].hooks.done.call(stats('lifecycle-3'));
  result.reconnectBroadcast = stale.count('built') === 0 && other.count('built') === 2
    && reconnected.count('built') === 1;
  lifecycle.middleware.close();

  // A stale socket closing after replacement under the same HTML request ID can
  // remove that replacement in both exact versions. That pre-existing race is
  // outside this initial-SYNC fix; do not make the bug an expected behavior.
  return result;
}
try {
  const installed = readFileSync(file);
  const installedSha = hash(installed);
  if (installedSha !== originalSha && installedSha !== patchedSha) throw new Error('source_sha');
  const installedText = installed.toString('utf8');
  const original = installedSha === originalSha
    ? installedText : exactReplace(installedText, newCall, oldCall);
  const patched = installedSha === patchedSha
    ? installedText : exactReplace(installedText, oldCall, newCall);
  if (hash(original) !== originalSha || hash(patched) !== patchedSha) throw new Error('pair_sha');
  process.stdout.write(JSON.stringify({ binding: true,
    original: evaluate(load(original)), patched: evaluate(load(patched)) }));
} catch {
  process.stdout.write(JSON.stringify({ binding: false }));
  process.exitCode = 1;
}
`;

const runProbe = () => {
  const child = spawnSync('node', ['-e', probe, modulePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024,
    timeout: 15_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout) as {
    binding: boolean;
    original: Record<string, boolean>;
    patched: Record<string, boolean>;
  };
};

describe('Next 16.3.8 initial HMR SYNC targeting', () => {
  let result: ReturnType<typeof runProbe>;
  beforeAll(() => { result = runProbe(); });

  test('binds both in-memory revisions to exact installed-source hashes', () => {
    expect(result.binding).toBe(true);
  });

  test('new and legacy sockets receive only their own initial SYNC', () => {
    const { original, patched } = result;
    expect(original.initialTargeted).toBe(false);
    expect(original.legacyTargeted).toBe(false);
    expect(patched.initialTargeted).toBe(true);
    expect(patched.legacyTargeted).toBe(true);
  });

  test('retains payloads, build/error broadcasts, middleware recovery, reconnect, and close', () => {
    const { original, patched } = result;
    const preserved = [
      'firstPayload', 'buildBroadcast', 'legacyBuildBroadcast', 'errorBuildBroadcast',
      'middlewareBuilt', 'middlewareSyncPayload', 'middlewareRecoveryBuilt',
      'middlewareRecoverySync', 'individualClose', 'reconnectSync',
      'reconnectBroadcast', 'closeStops',
    ];
    for (const behavior of preserved) {
      expect(original[behavior]).toBe(true);
      expect(patched[behavior]).toBe(true);
    }
  });
});
