import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadEnvironment } from '../03-collect-transcript.js';

function makeVenv(root) {
  const bin = path.join(root, '.venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'python3'), '#!/bin/sh\n');
  const site = path.join(root, '.venv', 'lib', 'python3.12', 'site-packages');
  fs.mkdirSync(site, { recursive: true });
  return { python: path.join(bin, 'python3'), site };
}

async function withEnv(overrides, fn) {
  const keys = ['PYTHON_CMD', 'PYTHONPATH', 'PATH'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) {
    if (k in overrides) process.env[k] = overrides[k];
    else delete process.env[k];
  }
  try {
    await fn();
    return Object.fromEntries(keys.map(k => [k, process.env[k]]));
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('unset PYTHON_CMD falls back to the repo .venv and binds same-root site-packages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-env-'));
  const venv = makeVenv(root);
  const env = await withEnv({ PATH: '/usr/bin' }, () => loadEnvironment([root]));
  assert.equal(env.PYTHON_CMD, venv.python);
  assert.equal(env.PYTHONPATH, venv.site);
});

test('unset PYTHON_CMD without any .venv leaves the environment untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-env-'));
  const env = await withEnv({ PATH: '/usr/bin', PYTHONPATH: '/operator/lib' }, () => loadEnvironment([root]));
  assert.equal(env.PYTHON_CMD, undefined);
  assert.equal(env.PYTHONPATH, '/operator/lib');
});

test('explicit command name is preserved and gets no venv package injection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-env-'));
  makeVenv(root);
  const env = await withEnv({ PATH: '/usr/bin', PYTHON_CMD: 'python3' }, () => loadEnvironment([root]));
  assert.equal(env.PYTHON_CMD, 'python3');
  assert.equal(env.PYTHONPATH, undefined);
});

test('explicit absolute interpreter outside the repo is preserved with no injection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-env-'));
  makeVenv(root);
  const env = await withEnv({ PATH: '/usr/bin', PYTHON_CMD: '/opt/external/bin/python3' }, () => loadEnvironment([root]));
  assert.equal(env.PYTHON_CMD, '/opt/external/bin/python3');
  assert.equal(env.PYTHONPATH, undefined);
});

test('venv fallback keeps an operator PYTHONPATH and never modifies PATH', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-env-'));
  const venv = makeVenv(root);
  const before = '/usr/bin:/bin';
  const env = await withEnv({ PATH: before, PYTHONPATH: '/operator/lib' }, () => loadEnvironment([root]));
  assert.equal(env.PYTHON_CMD, venv.python);
  assert.equal(env.PYTHONPATH, '/operator/lib');
  assert.equal(env.PATH, before);
});
