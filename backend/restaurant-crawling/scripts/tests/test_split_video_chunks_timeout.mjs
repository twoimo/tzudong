import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OutputBudget,
  ChildSupervisor,
  SPLIT_VIDEO_LIMITS,
  assertBoundFile,
  bindTrustedExecutable,
  bindTrustedRegularFile,
  bindTrustedRoot,
  buildFfmpegArgs,
  clampChunkPlanToMedia,
  buildFfmpegEnv,
  computeTimeoutMs,
  prepareOutputRoot,
  resolveChunkOutputPaths,
  runSplitVideoChunks,
  publishOutputAtomically,
  reserveExclusiveTempFile,
  validateChunkPlan,
} from '../split_video_chunks.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPLITTER_PATH = path.resolve(TEST_DIR, '..', 'split_video_chunks.mjs');
const TRUSTED_TEMP_ROOT = path.resolve(TEST_DIR, '..', '..', 'temp');

function makeSandbox() {
  fs.mkdirSync(TRUSTED_TEMP_ROOT, { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(path.join(TRUSTED_TEMP_ROOT, '.split-video-test-'));
}

function removeSandbox(sandbox) {
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('computes bounded integer ffmpeg timeouts', () => {
  assert.equal(Number.isInteger(computeTimeoutMs(1805.6000000000004)), true);
  assert.equal(computeTimeoutMs(1805.6000000000004), 3731201);
  assert.equal(computeTimeoutMs(1), 15 * 60 * 1000);
  assert.equal(Number.isInteger(computeTimeoutMs(1807.8999999999996)), true);
  for (const value of [NaN, Infinity, -1, 0, 6 * 60 * 60 + 1]) {
    assert.throws(() => computeTimeoutMs(value), /SPLIT_VIDEO_DURATION_INVALID/);
  }
});

test('clamps a slightly overrun last chunk to probed media duration', () => {
  const clamped = clampChunkPlanToMedia([
    { chunk_index: 0, start_sec: 0, end_sec: 351 },
  ], 350);
  assert.equal(clamped[0].end_sec, 350);
  const plan = validateChunkPlan(clamped, 350);
  assert.equal(plan[0].end_sec, 350);
});
test('rejects overlap, media overrun, count, and aggregate-duration plan abuse', () => {
  const plan = validateChunkPlan([
    { chunk_index: 0, start_sec: 0, end_sec: 180 },
    { chunk_index: 1, start_sec: 180, end_sec: 350 },
  ], 350);
  assert.equal(plan.length, 2);

  for (const invalid of [
    [
      { chunk_index: 0, start_sec: 0, end_sec: 180 },
      { chunk_index: 1, start_sec: 170, end_sec: 350 },
    ],
    [{ chunk_index: 0, start_sec: 0, end_sec: 351 }],
    [{ chunk_index: '../../../victim', start_sec: 0, end_sec: 1 }],
    [{ chunk_index: 1, start_sec: 0, end_sec: 1 }],
    [{ chunk_index: 0, start_sec: NaN, end_sec: 1 }],
    [{ chunk_index: 0, start_sec: 0, end_sec: Infinity }],
  ]) {
    assert.throws(() => validateChunkPlan(invalid, 350), /SPLIT_VIDEO_CHUNK_PLAN_INVALID/);
  }

  const smallLimits = { ...SPLIT_VIDEO_LIMITS, maxAggregateDurationSec: 2 };
  assert.throws(() => validateChunkPlan([
    { chunk_index: 0, start_sec: 0, end_sec: 1.5 },
    { chunk_index: 1, start_sec: 1.5, end_sec: 3 },
  ], 3, smallLimits), /SPLIT_VIDEO_CHUNK_PLAN_INVALID/);
  assert.throws(
    () => validateChunkPlan(Array.from({ length: SPLIT_VIDEO_LIMITS.maxChunks + 1 }, (_, chunk_index) => ({
      chunk_index,
      start_sec: chunk_index,
      end_sec: chunk_index + 1,
    })), SPLIT_VIDEO_LIMITS.maxVideoDurationSec),
    /SPLIT_VIDEO_CHUNK_PLAN_INVALID/,
  );
});

test('derives final and random temporary paths strictly inside the output root', () => {
  const root = path.resolve('owned-output');
  const paths = resolveChunkOutputPaths(root, 7, '12345678-abcd');
  assert.equal(paths.outFile, path.join(root, 'chunk_7.mp4'));
  assert.equal(paths.tempOutFile, path.join(root, '.chunk_7.12345678-abcd.tmp.mp4'));
  assert.throws(() => resolveChunkOutputPaths(root, Number.NaN), /SPLIT_VIDEO_CHUNK_INDEX_INVALID/);
  assert.throws(() => resolveChunkOutputPaths(root, 1, '../escape'), /SPLIT_VIDEO_TEMP_NONCE_INVALID/);
});

test('uses a minimal private ffmpeg environment without caller secrets', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'split-video-home-'));
  try {
    const env = buildFfmpegEnv(sandbox);
    assert.deepEqual(Object.keys(env).sort(), process.platform === 'win32'
      ? ['HOME', 'PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE']
      : ['HOME', 'PATH', 'TEMP', 'TMP', 'TMPDIR']);
    assert.equal(env.HOME, sandbox);
    assert.equal('GEMINI_API_KEY' in env, false);
    assert.equal('SPLIT_VIDEO_TEST_SECRET' in env, false);
    assert.equal(fs.statSync(env.TMPDIR).isDirectory(), true);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('binds canonical no-follow handles and rejects links and deterministic source, plan, and executable swaps', () => {
  const sandbox = makeSandbox();
  const root = bindTrustedRoot(sandbox);
  try {
    const linkedTarget = path.join(sandbox, 'linked-target');
    const linkedFile = path.join(sandbox, 'linked-file');
    fs.writeFileSync(linkedTarget, 'safe');
    fs.symlinkSync(linkedTarget, linkedFile);
    assert.throws(
      () => bindTrustedRegularFile(linkedFile, [root]),
      /SPLIT_VIDEO_INPUT_INVALID/,
    );

    for (const [name, code, bind] of [
      ['source.mp4', 'SPLIT_VIDEO_SOURCE_SWAPPED', candidate => bindTrustedRegularFile(candidate, [root])],
      ['chunks.json', 'SPLIT_VIDEO_INPUT_SWAPPED', candidate => bindTrustedRegularFile(candidate, [root])],
      ['ffmpeg', 'SPLIT_VIDEO_FFMPEG_SWAPPED', candidate => bindTrustedExecutable(candidate, [root])],
    ]) {
      const candidate = path.join(sandbox, name);
      fs.writeFileSync(candidate, 'first');
      if (name === 'ffmpeg') fs.chmodSync(candidate, 0o700);
      const handle = bind(candidate);
      try {
        fs.renameSync(candidate, `${candidate}.old-${randomUUID()}`);
      } catch {
        // Windows may retain an open-file delete lock; an in-place replacement still changes the bound identity.
      }
      fs.writeFileSync(candidate, 'replacement');
      assert.throws(() => assertBoundFile(handle, code), new RegExp(code));
      fs.closeSync(handle.fd);
    }
  } finally {
    removeSandbox(sandbox);
  }
});

test('rejects output-root links and aborts exact output-byte overflow without publishing', () => {
  const sandbox = makeSandbox();
  const trustedRoot = bindTrustedRoot(TRUSTED_TEMP_ROOT);
  try {
    const safeOutput = prepareOutputRoot(path.join(sandbox, 'segments'), trustedRoot);
    const linkedOutput = path.join(sandbox, 'linked-segments');
    fs.symlinkSync(safeOutput.path, linkedOutput);
    assert.throws(
      () => prepareOutputRoot(linkedOutput, trustedRoot),
      /SPLIT_VIDEO_OUTPUT_ROOT_INVALID/,
    );

    const temporary = path.join(safeOutput.path, '.chunk_0.test.tmp.mp4');
    fs.writeFileSync(temporary, Buffer.alloc(5));
    const budget = new OutputBudget(safeOutput, 5);
    budget.add(temporary);
    assert.equal(budget.assertWithinLimit(), 5);
    fs.writeFileSync(temporary, Buffer.alloc(6));
    assert.throws(() => budget.assertWithinLimit(), /SPLIT_VIDEO_OUTPUT_BUDGET_EXCEEDED/);
    fs.unlinkSync(temporary);
    assert.equal(fs.existsSync(path.join(safeOutput.path, 'chunk_0.mp4')), false);
  } finally {
    removeSandbox(sandbox);
  }
});
test('fails closed when a publish link is renamed and replaced with an external sentinel', t => {
  const sandbox = makeSandbox();
  const sentinels = fs.mkdtempSync(path.join(TRUSTED_TEMP_ROOT, '.split-video-sentinel-'));
  let reservation;
  let originalLink;
  let replacementApplied = false;
  try {
    const outputRoot = prepareOutputRoot(path.join(sandbox, 'segments'), bindTrustedRoot(TRUSTED_TEMP_ROOT));
    const { outFile, tempOutFile } = resolveChunkOutputPaths(outputRoot, 0, '12345678-publish');
    const externalSentinel = path.join(sentinels, 'external.mp4');
    fs.writeFileSync(externalSentinel, 'external-sentinel');

    reservation = reserveExclusiveTempFile(outputRoot, tempOutFile);
    const expectedBytes = Buffer.from('descriptor-bound-output');
    fs.writeSync(reservation.fd, expectedBytes, 0, expectedBytes.length, 0);

    originalLink = fs.linkSync;
    fs.linkSync = (source, destination) => {
      originalLink(source, destination);
      fs.renameSync(destination, `${destination}.owned`);
      originalLink(externalSentinel, destination);
      replacementApplied = true;
    };
    assert.throws(
      () => publishOutputAtomically(outputRoot, reservation, outFile),
      /SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID/,
    );
    if (!replacementApplied) {
      t.skip('The platform retains a hard-link rename lock while the reservation descriptor is open.');
      return;
    }
    assert.equal(fs.readFileSync(externalSentinel, 'utf8'), 'external-sentinel');
    assert.equal(fs.readFileSync(outFile, 'utf8'), 'external-sentinel');
    assert.equal(fs.lstatSync(externalSentinel).nlink, 2);
  } finally {
    if (originalLink) fs.linkSync = originalLink;
    if (reservation) fs.closeSync(reservation.fd);
    removeSandbox(sandbox);
    fs.rmSync(sentinels, { recursive: true, force: true });
  }
});
test('rejects a symlink replacement of a reserved temporary path without touching its external sentinel', t => {
  const sandbox = makeSandbox();
  const sentinels = fs.mkdtempSync(path.join(TRUSTED_TEMP_ROOT, '.split-video-sentinel-'));
  let reservation;
  try {
    const outputRoot = prepareOutputRoot(path.join(sandbox, 'segments'), bindTrustedRoot(TRUSTED_TEMP_ROOT));
    const { outFile, tempOutFile } = resolveChunkOutputPaths(outputRoot, 0, '12345678-temp-swap');
    const externalSentinel = path.join(sentinels, 'external.mp4');
    fs.writeFileSync(externalSentinel, 'external-sentinel');

    reservation = reserveExclusiveTempFile(outputRoot, tempOutFile);
    fs.writeSync(reservation.fd, Buffer.from('descriptor-bound-output'));
    try {
      fs.renameSync(tempOutFile, `${tempOutFile}.held`);
      fs.symlinkSync(externalSentinel, tempOutFile, 'file');
    } catch {
      t.skip('The platform retains an exclusive temporary-file delete lock.');
      return;
    }

    assert.throws(
      () => publishOutputAtomically(outputRoot, reservation, outFile),
      /SPLIT_VIDEO_TEMP_OUTPUT_INVALID/,
    );
    assert.equal(fs.readFileSync(externalSentinel, 'utf8'), 'external-sentinel');
    assert.equal(fs.existsSync(outFile), false);
  } finally {
    if (reservation) fs.closeSync(reservation.fd);
    removeSandbox(sandbox);
    fs.rmSync(sentinels, { recursive: true, force: true });
  }
});

test('rejects hard-link, symlink, and directory-reparse chunk destinations before ffmpeg resolution', async () => {
  const sandbox = makeSandbox();
  const sentinels = fs.mkdtempSync(path.join(TRUSTED_TEMP_ROOT, '.split-video-sentinel-'));
  const previousFfmpegPath = process.env.FFMPEG_PATH;
  const previousAllowCustomFfmpeg = process.env.ALLOW_CUSTOM_FFMPEG;
  const previousFfmpegTrustedRoot = process.env.FFMPEG_TRUSTED_ROOT;
  try {
    const source = path.join(sandbox, 'video.mp4');
    const plan = path.join(sandbox, 'chunks.json');
    fs.writeFileSync(source, 'source');
    fs.writeFileSync(plan, JSON.stringify([{ chunk_index: 0, start_sec: 0, end_sec: 1 }]));
    process.env.ALLOW_CUSTOM_FFMPEG = '1';
    process.env.FFMPEG_PATH = path.join(sandbox, 'must-not-resolve-ffmpeg');
    process.env.FFMPEG_TRUSTED_ROOT = sandbox;

    for (const [name, createDestination, assertSentinel] of [
      [
        'hard-link',
        (destination, sentinel) => fs.linkSync(sentinel, destination),
        sentinel => assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external-sentinel'),
      ],
      [
        'symbolic-link',
        (destination, sentinel) => fs.symlinkSync(sentinel, destination, 'file'),
        sentinel => assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external-sentinel'),
      ],
      [
        'directory-reparse',
        (destination, sentinel) => fs.symlinkSync(sentinel, destination, process.platform === 'win32' ? 'junction' : 'dir'),
        sentinel => assert.equal(fs.readFileSync(path.join(sentinel, 'keep'), 'utf8'), 'external-sentinel'),
      ],
    ]) {
      const output = path.join(sandbox, `segments-${name}`);
      const destination = path.join(output, 'chunk_0.mp4');
      const sentinel = path.join(sentinels, name);
      fs.mkdirSync(output, { mode: 0o700 });
      if (name === 'directory-reparse') {
        fs.mkdirSync(sentinel, { mode: 0o700 });
        fs.writeFileSync(path.join(sentinel, 'keep'), 'external-sentinel');
      } else {
        fs.writeFileSync(sentinel, 'external-sentinel');
      }
      createDestination(destination, sentinel);

      await assert.rejects(
        () => runSplitVideoChunks({ videoPath: source, chunksJsonPath: plan, outputDir: output }),
        /SPLIT_VIDEO_EXISTING_OUTPUT_INVALID/,
      );
      assertSentinel(sentinel);
    }
  } finally {
    if (previousFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousFfmpegPath;
    if (previousAllowCustomFfmpeg === undefined) delete process.env.ALLOW_CUSTOM_FFMPEG;
    else process.env.ALLOW_CUSTOM_FFMPEG = previousAllowCustomFfmpeg;
    if (previousFfmpegTrustedRoot === undefined) delete process.env.FFMPEG_TRUSTED_ROOT;
    else process.env.FFMPEG_TRUSTED_ROOT = previousFfmpegTrustedRoot;
    removeSandbox(sandbox);
    fs.rmSync(sentinels, { recursive: true, force: true });
  }
});

test('caps source size before any ffmpeg dispatch', async () => {
  const sandbox = makeSandbox();
  try {
    const source = path.join(sandbox, 'oversized.mp4');
    const plan = path.join(sandbox, 'chunks.json');
    fs.writeFileSync(source, 'x');
    fs.truncateSync(source, SPLIT_VIDEO_LIMITS.maxSourceBytes + 1);
    fs.writeFileSync(plan, JSON.stringify([{ chunk_index: 0, start_sec: 0, end_sec: 1 }]));
    await assert.rejects(
      () => runSplitVideoChunks({ videoPath: source, chunksJsonPath: plan, outputDir: path.join(sandbox, 'segments') }),
      /SPLIT_VIDEO_SOURCE_TOO_LARGE/,
    );
  } finally {
    removeSandbox(sandbox);
  }
});
test('supervisor kills sibling trees and grandchildren while retaining its secret-free environment', async () => {
  const sandbox = makeSandbox();
  let sourceHandle;
  let executableHandle;
  const previousSecret = process.env.SPLIT_VIDEO_TEST_SECRET;
  process.env.SPLIT_VIDEO_TEST_SECRET = 'parent-only-secret';
  try {
    const source = path.join(sandbox, 'source.mp4');
    const fixture = path.join(sandbox, 'child-fixture.cjs');
    const marker = path.join(sandbox, 'grandchild-survived');
    fs.writeFileSync(source, 'source');
    fs.writeFileSync(fixture, `const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [mode, marker] = process.argv.slice(2);
if (process.env.SPLIT_VIDEO_TEST_SECRET) fs.writeFileSync(marker + '.secret', 'leaked');
if (mode === 'fail') {
  spawn(process.execPath, ['-e', \`setTimeout(() => require('node:fs').writeFileSync(\${JSON.stringify(marker)}, 'alive'), 350); setInterval(() => {}, 1000);\`], { stdio: 'ignore' });
  setTimeout(() => process.exit(9), 25);
} else {
  setTimeout(() => fs.writeFileSync(marker + '.slow', 'alive'), 600);
}
`);
    const sourceRoot = bindTrustedRoot(sandbox);
    const executableRoot = bindTrustedRoot(path.dirname(process.execPath), 'SPLIT_VIDEO_FFMPEG_PATH_INVALID');
    sourceHandle = bindTrustedRegularFile(source, [sourceRoot]);
    executableHandle = bindTrustedExecutable(process.execPath, [executableRoot]);
    const privateHome = path.join(sandbox, 'home');
    const env = buildFfmpegEnv(privateHome);
    assert.equal('SPLIT_VIDEO_TEST_SECRET' in env, false);
    const supervisor = new ChildSupervisor(env);
    const runOptions = {
      timeoutMs: 2_000,
      windowsExecutable: process.platform === 'win32',
    };
    const failing = supervisor.run(executableHandle, sourceHandle, [fixture, 'fail', marker], runOptions);
    const sibling = supervisor.run(executableHandle, sourceHandle, [fixture, 'slow', marker], runOptions);
    const siblingObserved = sibling.catch(error => error);
    await assert.rejects(failing, /SPLIT_VIDEO_FFMPEG_FAILED/);
    await supervisor.abortAll(new Error('SPLIT_VIDEO_FFMPEG_FAILED'));
    await Promise.all([failing.catch(error => error), siblingObserved]);
    await sleep(800);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(`${marker}.slow`), false);
    assert.equal(fs.existsSync(`${marker}.secret`), false);
  } finally {
    if (executableHandle) fs.closeSync(executableHandle.fd);
    if (sourceHandle) fs.closeSync(sourceHandle.fd);
    removeSandbox(sandbox);
    if (previousSecret === undefined) delete process.env.SPLIT_VIDEO_TEST_SECRET;
    else process.env.SPLIT_VIDEO_TEST_SECRET = previousSecret;
  }
});

test('aborts sibling process trees, removes temporary outputs, and never passes secrets to ffmpeg', async t => {
  if (process.platform === 'win32') {
    t.skip('The fake executable fixture is POSIX-only; Windows uses taskkill /T /F in production.');
    return;
  }
  const sandbox = makeSandbox();
  try {
    const tools = path.join(sandbox, 'tools');
    const source = path.join(sandbox, 'video.mp4');
    const plan = path.join(sandbox, 'chunks.json');
    const output = path.join(sandbox, 'segments');
    const fakeFfmpeg = path.join(tools, 'ffmpeg-fixture');
    fs.mkdirSync(tools, { mode: 0o700 });
    fs.writeFileSync(source, 'not-a-real-video');
    fs.writeFileSync(plan, JSON.stringify([
      { chunk_index: 0, start_sec: 0, end_sec: 5 },
      { chunk_index: 1, start_sec: 5, end_sec: 10 },
    ]));
    fs.writeFileSync(fakeFfmpeg, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('-hide_banner')) {
  console.error('Duration: 00:00:10.00');
  process.exit(1);
}
const output = args.at(-1);
const outputDir = path.dirname(output);
if (process.env.SPLIT_VIDEO_TEST_SECRET) fs.writeFileSync(path.join(outputDir, 'secret-leaked'), 'bad');
const start = args[args.indexOf('-ss') + 1];
if (start === '0') {
  const marker = path.join(outputDir, 'grandchild-survived');
  spawn(process.execPath, ['-e', \`setTimeout(() => require('node:fs').writeFileSync(\${JSON.stringify(marker)}, 'alive'), 350); setInterval(() => {}, 1000);\`], { stdio: 'ignore' });
  setTimeout(() => process.exit(9), 25);
} else {
  setTimeout(() => { fs.writeFileSync(output, Buffer.alloc(4)); process.exit(0); }, 500);
}
`);
    fs.chmodSync(fakeFfmpeg, 0o700);

    const run = spawnSync(process.execPath, [SPLITTER_PATH, source, plan, output], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ALLOW_CUSTOM_FFMPEG: '1',
        FFMPEG_PATH: fakeFfmpeg,
        FFMPEG_TRUSTED_ROOT: tools,
        SPLIT_VIDEO_TEST_SECRET: 'must-not-reach-ffmpeg',
      },
      timeout: 10_000,
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.notEqual(run.status, 0);
    await sleep(700);
    assert.equal(fs.existsSync(path.join(output, 'secret-leaked')), false);
    assert.equal(fs.existsSync(path.join(output, 'grandchild-survived')), false);
    const outputEntries = fs.existsSync(output) ? fs.readdirSync(output) : [];
    assert.deepEqual(outputEntries.filter(name => name.endsWith('.tmp.mp4') || /^chunk_\d+\.mp4$/.test(name)), []);
  } finally {
    removeSandbox(sandbox);
  }
});
test('re-encodes every chunk instead of stream-copying YouTube mp4s', () => {
  const args = buildFfmpegArgs(
    { chunk_index: 0, start_sec: 0, end_sec: 2 },
    '/tmp/source.mp4',
    '/tmp/.chunk_0.tmp.mp4',
    false,
  );
  assert.equal(args.includes('-c'), false);
  assert.equal(args.includes('copy'), false);
  assert.equal(args.includes('libx264'), true);
  assert.equal(args.includes('scale=-2:240:force_original_aspect_ratio=decrease'), true);
  assert.equal(args.includes('48k'), true);
});

test('split logs a fixed error code when ffmpeg cannot decode the source', async () => {
  const sandbox = makeSandbox();
  try {
    const source = path.join(sandbox, 'source.mp4');
    const plan = path.join(sandbox, 'chunks.json');
    const output = path.join(sandbox, 'segments');
    fs.writeFileSync(source, 'not-a-real-video');
    fs.writeFileSync(plan, JSON.stringify([{ chunk_index: 0, start_sec: 0, end_sec: 1 }]));
    const run = spawnSync(process.execPath, [SPLITTER_PATH, source, plan, output], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /SPLIT_VIDEO_PROCESS_FAILED error=Error code=SPLIT_VIDEO_/);
  } finally {
    removeSandbox(sandbox);
  }
});
