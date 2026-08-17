import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildTranscriptYtDlpInvocation,
  extractTrustedYoutubeVideoId,
  isTrustedYoutubeVideoId,
  resolveTrustedPythonCommand,
  runTranscriptYtDlp,
} from '../transcript-command.mjs';
import { collectChannelTranscripts, fetchTranscriptYtDlp, getTranscript } from '../03-collect-transcript.js';

const VIDEO_ID = 'AbCdEf123_-';

test('accepts only exact HTTPS YouTube URLs with an 11-character video ID', () => {
  assert.equal(isTrustedYoutubeVideoId(VIDEO_ID), true);
  assert.equal(extractTrustedYoutubeVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`), VIDEO_ID);
  assert.equal(extractTrustedYoutubeVideoId(`https://youtu.be/${VIDEO_ID}`), VIDEO_ID);
  for (const value of [
    'http://www.youtube.com/watch?v=AbCdEf123_-',
    'https://evil.example/watch?v=AbCdEf123_-',
    'https://www.youtube.com.evil.example/watch?v=AbCdEf123_-',
    'https://www.youtube.com/watch?v=AbCdEf123_-;calc',
    'https://youtu.be/../../victim',
  ]) assert.equal(extractTrustedYoutubeVideoId(value), null, value);
});

test('builds literal shell-free yt-dlp arguments and rejects hostile executable or path values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-command-'));
  try {
    const outputPrefix = path.join(root, `temp_${VIDEO_ID}`);
    const invocation = buildTranscriptYtDlpInvocation({
      videoId: VIDEO_ID,
      outputPrefix,
      mode: 'stealth',
      userAgent: 'Mozilla/5.0 safe test agent',
      pythonCommand: 'python3',
      nodePath: process.execPath,
    });
    assert.equal(invocation.executable, 'python3');
    assert.deepEqual(invocation.args.slice(0, 3), ['-m', 'yt_dlp', '--js-runtimes']);
    assert.equal(invocation.args.at(-1), `https://www.youtube.com/watch?v=${VIDEO_ID}`);
    assert.equal(invocation.args[invocation.args.indexOf('--output') + 1], outputPrefix);

    for (const command of ['python;calc', 'python && touch sentinel', '../python', ' python']) {
      assert.throws(() => resolveTrustedPythonCommand(command), { code: 'TRANSCRIPT_PYTHON_COMMAND_INVALID' });
    }
    assert.throws(() => buildTranscriptYtDlpInvocation({
      videoId: 'bad;touch', outputPrefix, mode: 'stealth', userAgent: 'Mozilla/5.0 safe test agent',
    }), { code: 'TRANSCRIPT_VIDEO_ID_INVALID' });
    assert.throws(() => buildTranscriptYtDlpInvocation({
      videoId: VIDEO_ID, outputPrefix: path.join(root, '..', 'victim'), mode: 'stealth', userAgent: 'Mozilla/5.0 safe test agent',
    }), { code: 'TRANSCRIPT_OUTPUT_PATH_INVALID' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('resolveTrustedPythonCommand follows a venv-style symlink to a regular file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-python-'));
  try {
    const realPython = path.join(root, 'python3.14');
    const venvPython = path.join(root, 'python');
    fs.writeFileSync(realPython, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(realPython, 0o755);
    fs.symlinkSync(realPython, venvPython);

    assert.equal(resolveTrustedPythonCommand(venvPython), fs.realpathSync.native(venvPython));
    assert.throws(() => resolveTrustedPythonCommand(`${venvPython};calc`), { code: 'TRANSCRIPT_PYTHON_COMMAND_INVALID' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const TREE_TIMEOUT_MS = 12_000;

test('runner preserves exact argv and ignored stdin inside an isolated boundary with a minimal environment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-command-'));
  const recordPath = path.join(root, 'invocation.json');
  const literalArgument = 'literal & "not a shell command"';
  const targetSource = [
    "const fs = require('node:fs');",
    "const stdin = fs.readFileSync(0, 'utf8');",
    "fs.writeFileSync(process.argv.at(-1), JSON.stringify({ args: process.argv.slice(1, -1), stdin, hasServiceRoleKey: Object.hasOwn(process.env, 'SUPABASE_SERVICE_ROLE_KEY') }));",
  ].join('\n');
  let observed;
  const spawnImpl = (executable, args, options) => {
    observed = { executable, args, options };
    return spawn(executable, args, options);
  };
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'must-not-reach-child';
  try {
    await runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', targetSource, literalArgument, recordPath],
    }, {
      timeoutMs: TREE_TIMEOUT_MS,
      spawnImpl,
    });
    const record = await readProcessRecord(recordPath);
    assert.deepEqual(record.args, [literalArgument]);
    assert.equal(record.stdin, '');
    assert.equal(record.hasServiceRoleKey, false);
  } finally {
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  if (process.platform === 'win32') {
    assert.match(observed.executable, /\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
    assert.deepEqual(observed.options.stdio, ['pipe', 'ignore', 'ignore']);
    assert.equal(observed.options.detached, false);
    const targetEnvironment = Buffer.from(
      observed.options.env.TRANSCRIPT_JOB_ENVIRONMENT_B64,
      'base64',
    ).toString('utf16le');
    assert.equal(targetEnvironment.includes('SUPABASE_SERVICE_ROLE_KEY='), false);
  } else {
    assert.equal(observed.options.detached, true);
    assert.equal(observed.options.stdio, 'ignore');
    assert.deepEqual(observed.args, ['-e', targetSource, literalArgument, recordPath]);
  }
});

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const WINDOWS_FAKE_TIMEOUT_MS = 1_000;
const WINDOWS_FAKE_SETTLEMENT_LIMIT_MS = 2_500;

function createFakeWindowsSupervisor({
  onSpawn = () => {},
  closeOnKill = true,
  killResult = true,
} = {}) {
  const state = {
    closeCount: 0,
    killCount: 0,
    unrefCount: 0,
  };
  const spawnImpl = (executable, args, options) => {
    const child = new EventEmitter();
    child.pid = 42_424;
    child.stdin = new PassThrough();
    child.kill = () => {
      state.killCount += 1;
      if (closeOnKill) queueMicrotask(() => close());
      return killResult;
    };
    child.unref = () => {
      state.unrefCount += 1;
    };
    const close = (code = null) => {
      if (state.closeCount > 0) return;
      state.closeCount += 1;
      child.emit('close', code);
    };
    state.child = child;
    state.executable = executable;
    state.args = args;
    state.options = options;
    queueMicrotask(() => onSpawn({ child, close, options, state }));
    return child;
  };
  return { spawnImpl, state };
}

function connectFakeWindowsSupervisor(options, onConnect) {
  const pipeName = Buffer.from(
    options.env.TRANSCRIPT_JOB_CONTROL_PIPE_B64,
    'base64',
  ).toString('utf8');
  const nonce = options.env.TRANSCRIPT_JOB_CONTROL_NONCE;
  const deadline = options.env.TRANSCRIPT_JOB_CONTROL_DEADLINE;
  const socket = connect(`\\\\.\\pipe\\${pipeName}`);
  socket.on('error', () => {});
  socket.once('connect', () => onConnect({ socket, nonce, deadline }));
  return socket;
}

function readFakeControlFrames(socket, onFrame) {
  let pending = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    pending += chunk;
    const frames = pending.split('\n');
    pending = frames.pop();
    for (const frame of frames) onFrame(frame);
  });
}

function fakeWindowsInvocation() {
  return {
    executable: process.execPath,
    args: ['-e', ''],
  };
}

function assertFakeWindowsSettlement(started) {
  assert.ok(
    Date.now() - started < WINDOWS_FAKE_SETTLEMENT_LIMIT_MS,
    'Windows supervisor settlement exceeded its bounded cleanup deadline',
  );
}

async function readProcessRecord(recordPath) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    } catch {
      await pause(10);
    }
  }
  throw new Error('process record was not written');
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (!processExists(pid)) return;
    await pause(10);
  }
  assert.fail(`process ${pid} survived cleanup`);
}

function treeParentSource({ exitCode = null, detached = false } = {}) {
  const descendantSource = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);";
  return [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "process.on('SIGTERM', () => {});",
    `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore', detached: ${detached} });`,
    `fs.writeFileSync(process.argv.at(-1), JSON.stringify({ parent: process.pid, descendant: descendant.pid }));`,
    exitCode === null ? 'setInterval(() => {}, 1_000);' : `process.exit(${exitCode});`,
  ].join('\n');
}

function stopTree(pids) {
  for (const pid of [pids?.descendant, pids?.parent]) {
    if (!Number.isSafeInteger(pid) || pid < 1) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The runner is expected to have already terminated this process.
    }
  }
}

async function assertTreeExited(pids) {
  await waitForProcessExit(pids.parent);
  await waitForProcessExit(pids.descendant);
}

test('normal success drains a root-exits-first descendant before the caller can clean files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tree-'));
  const recordPath = path.join(root, 'pids.json');
  let pids = null;
  try {
    const completion = runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', treeParentSource({ exitCode: 0 }), recordPath],
    }, { timeoutMs: TREE_TIMEOUT_MS });
    pids = await readProcessRecord(recordPath);
    await completion;
    await assertTreeExited(pids);
  } finally {
    stopTree(pids);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fast nonzero exit drains descendants before reporting failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tree-'));
  const recordPath = path.join(root, 'pids.json');
  let pids = null;
  try {
    const completion = runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', treeParentSource({ exitCode: 23 }), recordPath],
    }, { timeoutMs: TREE_TIMEOUT_MS });
    pids = await readProcessRecord(recordPath);
    await assert.rejects(completion, { code: 'TRANSCRIPT_YTDLP_FAILED' });
    await assertTreeExited(pids);
  } finally {
    stopTree(pids);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows Job Object contains a detached descendant after its root exits', async (t) => {
  if (process.platform !== 'win32') t.skip('Windows Job Object coverage');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tree-'));
  const recordPath = path.join(root, 'pids.json');
  let pids = null;
  try {
    const completion = runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', treeParentSource({ exitCode: 0, detached: true }), recordPath],
    }, { timeoutMs: TREE_TIMEOUT_MS });
    pids = await readProcessRecord(recordPath);
    await completion;
    await assertTreeExited(pids);
  } finally {
    stopTree(pids);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('Windows forces a stalled waiting or READY supervisor to close within its timeout', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows supervisor coverage');
    return;
  }

  const waiting = createFakeWindowsSupervisor();
  let started = Date.now();
  await assert.rejects(
    runTranscriptYtDlp(fakeWindowsInvocation(), {
      timeoutMs: WINDOWS_FAKE_TIMEOUT_MS,
      spawnImpl: waiting.spawnImpl,
    }),
    { code: 'TRANSCRIPT_YTDLP_TIMEOUT' },
  );
  assertFakeWindowsSettlement(started);
  assert.equal(waiting.state.killCount, 1);

  let acknowledged = false;
  const ready = createFakeWindowsSupervisor({
    onSpawn: ({ options, state }) => {
      state.socket = connectFakeWindowsSupervisor(options, ({ socket, nonce, deadline }) => {
        readFakeControlFrames(socket, (frame) => {
          if (frame === `ACK ${nonce} ${deadline}`) acknowledged = true;
        });
        socket.write(`READY ${nonce} ${deadline}\n`);
      });
    },
  });
  started = Date.now();
  await assert.rejects(
    runTranscriptYtDlp(fakeWindowsInvocation(), {
      timeoutMs: WINDOWS_FAKE_TIMEOUT_MS,
      spawnImpl: ready.spawnImpl,
    }),
    { code: 'TRANSCRIPT_YTDLP_TIMEOUT' },
  );
  assertFakeWindowsSettlement(started);
  assert.equal(acknowledged, true);
  assert.equal(ready.state.killCount, 1);
});

test('Windows forces a supervisor after a contained control write failure', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows supervisor coverage');
    return;
  }

  let acknowledged = false;
  const fake = createFakeWindowsSupervisor({
    onSpawn: ({ options, state }) => {
      state.socket = connectFakeWindowsSupervisor(options, ({ socket, nonce, deadline }) => {
        readFakeControlFrames(socket, (frame) => {
          if (frame !== `ACK ${nonce} ${deadline}`) return;
          acknowledged = true;
          socket.write(`CONTAINED ${nonce} ${deadline}\n`);
          socket.end();
        });
        socket.write(`READY ${nonce} ${deadline}\n`);
      });
    },
  });
  const started = Date.now();
  await assert.rejects(
    runTranscriptYtDlp(fakeWindowsInvocation(), {
      timeoutMs: WINDOWS_FAKE_TIMEOUT_MS,
      spawnImpl: fake.spawnImpl,
    }),
    { code: 'TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED' },
  );
  assertFakeWindowsSettlement(started);
  assert.equal(acknowledged, true);
  assert.equal(fake.state.killCount, 1);
});

test('Windows returns a fixed bounded cleanup failure when a contained supervisor cannot close', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows supervisor coverage');
    return;
  }

  let runRequested = false;
  const fake = createFakeWindowsSupervisor({
    closeOnKill: false,
    killResult: false,
    onSpawn: ({ options, state }) => {
      state.socket = connectFakeWindowsSupervisor(options, ({ socket, nonce, deadline }) => {
        readFakeControlFrames(socket, (frame) => {
          if (frame === `ACK ${nonce} ${deadline}`) {
            socket.write(`CONTAINED ${nonce} ${deadline}\n`);
          } else if (frame === `RUN ${nonce} ${deadline}`) {
            runRequested = true;
          }
        });
        socket.write(`READY ${nonce} ${deadline}\n`);
      });
    },
  });
  const started = Date.now();
  await assert.rejects(
    runTranscriptYtDlp(fakeWindowsInvocation(), {
      timeoutMs: WINDOWS_FAKE_TIMEOUT_MS,
      spawnImpl: fake.spawnImpl,
    }),
    { code: 'TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED' },
  );
  assertFakeWindowsSettlement(started);
  assert.equal(runRequested, true);
  assert.ok(fake.state.killCount >= 1);
  assert.equal(fake.state.unrefCount, 1);
});
test('Windows transcript callsite propagates uncertain cleanup without a second invocation or temp-root deletion', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows supervisor coverage');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-callsite-'));
  const tempRoot = path.join(root, 'temporary');
  const cookiesPath = path.join(root, 'cookies.txt');
  fs.mkdirSync(tempRoot);
  fs.writeFileSync(cookiesPath, '# test cookies\n');
  let runRequested = false;
  let invocations = 0;
  const fake = createFakeWindowsSupervisor({
    closeOnKill: false,
    killResult: false,
    onSpawn: ({ options, state }) => {
      state.socket = connectFakeWindowsSupervisor(options, ({ socket, nonce, deadline }) => {
        readFakeControlFrames(socket, (frame) => {
          if (frame === `ACK ${nonce} ${deadline}`) {
            socket.write(`CONTAINED ${nonce} ${deadline}\n`);
          } else if (frame === `RUN ${nonce} ${deadline}`) {
            runRequested = true;
          }
        });
        socket.write(`READY ${nonce} ${deadline}\n`);
      });
    },
  });
  const previousTimeout = process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS;
  process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS = String(WINDOWS_FAKE_TIMEOUT_MS);
  const started = Date.now();

  try {
    await assert.rejects(
      fetchTranscriptYtDlp(VIDEO_ID, {
        cookiesPath,
        tempRoot,
        runYtDlp: (invocation, options) => {
          invocations += 1;
          return runTranscriptYtDlp(invocation, { ...options, spawnImpl: fake.spawnImpl });
        },
      }),
      { code: 'TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED' },
    );
    assertFakeWindowsSettlement(started);
    assert.equal(runRequested, true);
    assert.equal(invocations, 1);
    assert.equal(fs.readdirSync(tempRoot).length, 1);
    assert.ok(fs.existsSync(path.join(tempRoot, fs.readdirSync(tempRoot)[0])));
    assert.ok(fake.state.killCount >= 1);
    assert.equal(fake.state.unrefCount, 1);
  } finally {
    if (previousTimeout === undefined) delete process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS;
    else process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS = previousTimeout;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('Windows collection loop releases its slot and stops after uncertain cleanup', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows supervisor coverage');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-collection-loop-'));
  const dataPath = path.join(root, 'channel');
  const tempRoot = path.join(root, 'temporary');
  const cookiesPath = path.join(root, 'cookies.txt');
  const nextVideoId = 'ZyXwVu987_-';
  const attemptedVideoIds = [];
  const slotEvents = [];
  fs.mkdirSync(path.join(dataPath, 'meta'), { recursive: true });
  fs.mkdirSync(tempRoot);
  fs.writeFileSync(cookiesPath, '# test cookies\n');
  fs.writeFileSync(
    path.join(dataPath, 'urls.txt'),
    [
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://www.youtube.com/watch?v=${nextVideoId}`,
    ].join('\n'),
  );
  for (const videoId of [VIDEO_ID, nextVideoId]) {
    fs.writeFileSync(
      path.join(dataPath, 'meta', `${videoId}.jsonl`),
      `${JSON.stringify({ recollect_id: 1 })}\n`,
    );
  }

  let invocations = 0;
  let runRequested = false;
  let browserInvocations = 0;
  let delayInvocations = 0;
  const fake = createFakeWindowsSupervisor({
    closeOnKill: false,
    killResult: false,
    onSpawn: ({ options, state }) => {
      state.socket = connectFakeWindowsSupervisor(options, ({ socket, nonce, deadline }) => {
        readFakeControlFrames(socket, (frame) => {
          if (frame === `ACK ${nonce} ${deadline}`) {
            socket.write(`CONTAINED ${nonce} ${deadline}\n`);
          } else if (frame === `RUN ${nonce} ${deadline}`) {
            runRequested = true;
          }
        });
        socket.write(`READY ${nonce} ${deadline}\n`);
      });
    },
  });
  const previousTimeout = process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS;
  process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS = String(WINDOWS_FAKE_TIMEOUT_MS);
  const started = Date.now();

  try {
    await assert.rejects(
      collectChannelTranscripts('test', { name: 'test', data_path: 'ignored' }, {
        dataPath,
        acquireSlot: async () => {
          slotEvents.push('acquire');
        },
        releaseSlot: () => {
          slotEvents.push('release');
        },
        waitForDelay: async () => {
          delayInvocations += 1;
        },
        getTranscriptForVideo: async (videoId) => {
          attemptedVideoIds.push(videoId);
          return getTranscript(videoId, {
            fetchYtDlpTranscript: (ytDlpVideoId) => fetchTranscriptYtDlp(ytDlpVideoId, {
              cookiesPath,
              tempRoot,
              runYtDlp: (invocation, options) => {
                invocations += 1;
                return runTranscriptYtDlp(invocation, { ...options, spawnImpl: fake.spawnImpl });
              },
            }),
            getTranscriptFromPuppeteer: async () => {
              browserInvocations += 1;
              return null;
            },
          });
        },
      }),
      { code: 'TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED' },
    );
    assertFakeWindowsSettlement(started);
    assert.equal(runRequested, true);
    assert.deepEqual(attemptedVideoIds, [VIDEO_ID]);
    assert.equal(invocations, 1);
    assert.equal(browserInvocations, 0);
    assert.equal(delayInvocations, 0);
    assert.deepEqual(slotEvents, ['acquire', 'release']);
    assert.equal(fs.readdirSync(tempRoot).length, 1);
    assert.ok(fake.state.killCount >= 1);
    assert.equal(fake.state.unrefCount, 1);
  } finally {
    if (previousTimeout === undefined) delete process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS;
    else process.env.TRANSCRIPT_YTDLP_TIMEOUT_MS = previousTimeout;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('collection loop counts ordinary video failures and continues', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-collection-loop-'));
  const dataPath = path.join(root, 'channel');
  const nextVideoId = 'ZyXwVu987_-';
  const attemptedVideoIds = [];
  const slotEvents = [];
  fs.mkdirSync(path.join(dataPath, 'meta'), { recursive: true });
  fs.writeFileSync(
    path.join(dataPath, 'urls.txt'),
    [
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://www.youtube.com/watch?v=${nextVideoId}`,
    ].join('\n'),
  );
  for (const videoId of [VIDEO_ID, nextVideoId]) {
    fs.writeFileSync(
      path.join(dataPath, 'meta', `${videoId}.jsonl`),
      `${JSON.stringify({ recollect_id: 1 })}\n`,
    );
  }

  const ordinaryFailure = Object.assign(new Error('TRANSCRIPT_TEST_PROVIDER_FAILED'), {
    code: 'TRANSCRIPT_TEST_PROVIDER_FAILED',
  });

  try {
    const result = await collectChannelTranscripts('test', { name: 'test', data_path: 'ignored' }, {
      dataPath,
      acquireSlot: async () => {
        slotEvents.push('acquire');
      },
      releaseSlot: () => {
        slotEvents.push('release');
      },
      waitForDelay: async () => {},
      getTranscriptForVideo: async (videoId) => {
        attemptedVideoIds.push(videoId);
        if (videoId === VIDEO_ID) throw ordinaryFailure;
        return {
          language: 'korean',
          transcript: [{ text: 'test', start: 0, duration: 1 }],
          source: 'test',
        };
      },
    });

    assert.deepEqual(attemptedVideoIds, [VIDEO_ID, nextVideoId]);
    assert.deepEqual(slotEvents, ['acquire', 'release', 'acquire', 'release']);
    assert.equal(result.failed, 1);
    assert.equal(result.success, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('transcript callsite retries after a drained runner failure and removes its temp root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-callsite-'));
  const tempRoot = path.join(root, 'temporary');
  const cookiesPath = path.join(root, 'cookies.txt');
  fs.mkdirSync(tempRoot);
  fs.writeFileSync(cookiesPath, '# test cookies\n');
  let invocations = 0;

  try {
    const result = await fetchTranscriptYtDlp(VIDEO_ID, {
      cookiesPath,
      tempRoot,
      runYtDlp: (_invocation, options) => {
        invocations += 1;
        return runTranscriptYtDlp({
          executable: process.execPath,
          args: ['-e', 'process.exit(23)'],
        }, options);
      },
    });
    assert.equal(result, null);
    assert.equal(invocations, 2);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows timeout drains a detached descendant through the Job Object', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows Job Object coverage');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tree-'));
  const recordPath = path.join(root, 'pids.json');
  let pids = null;
  try {
    const completion = runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', treeParentSource({ detached: true }), recordPath],
    }, { timeoutMs: TREE_TIMEOUT_MS });
    pids = await readProcessRecord(recordPath);
    await assert.rejects(completion, { code: 'TRANSCRIPT_YTDLP_TIMEOUT' });
    await assertTreeExited(pids);
  } finally {
    stopTree(pids);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows abort drains a detached descendant through the Job Object', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows Job Object coverage');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tree-'));
  const recordPath = path.join(root, 'pids.json');
  const controller = new AbortController();
  let pids = null;
  try {
    const completion = runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', treeParentSource({ detached: true }), recordPath],
    }, { timeoutMs: TREE_TIMEOUT_MS, signal: controller.signal });
    pids = await readProcessRecord(recordPath);
    controller.abort();
    await assert.rejects(completion, { code: 'TRANSCRIPT_YTDLP_ABORTED' });
    await assertTreeExited(pids);
  } finally {
    stopTree(pids);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timeout kills an uncooperative descendant before the caller can clean temporary files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tree-'));
  const recordPath = path.join(root, 'pids.json');
  let pids = null;
  try {
    const completion = runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', treeParentSource(), recordPath],
    }, { timeoutMs: TREE_TIMEOUT_MS });
    pids = await readProcessRecord(recordPath);
    assert.equal(processExists(pids.parent), true);
    assert.equal(processExists(pids.descendant), true);
    await assert.rejects(completion, { code: 'TRANSCRIPT_YTDLP_TIMEOUT' });
    await assertTreeExited(pids);
  } finally {
    stopTree(pids);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('abort kills an uncooperative descendant before the caller can clean temporary files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tree-'));
  const recordPath = path.join(root, 'pids.json');
  const controller = new AbortController();
  let pids = null;
  try {
    const completion = runTranscriptYtDlp({
      executable: process.execPath,
      args: ['-e', treeParentSource(), recordPath],
    }, { timeoutMs: TREE_TIMEOUT_MS, signal: controller.signal });
    pids = await readProcessRecord(recordPath);
    controller.abort();
    await assert.rejects(completion, { code: 'TRANSCRIPT_YTDLP_ABORTED' });
    await assertTreeExited(pids);
  } finally {
    stopTree(pids);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
