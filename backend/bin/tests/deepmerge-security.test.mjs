import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const merge = require('deepmerge');
const lock = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package-lock.json'), 'utf8'));
const payload = () => JSON.parse('{"__proto__":{"admin":true},"safe":true}');

function assertSafe(result) {
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.admin, undefined);
  assert.equal(Object.hasOwn(result, '__proto__'), false);
  assert.equal(result.safe, true);
  assert.equal(Object.prototype.admin, undefined);
}

test('patched key filtering blocks source and target __proto__ poisoning', () => {
  const source = payload();
  for (const target of [Object.create(null), null, undefined, false, 0, '', {}]) {
    assertSafe(merge(target, source));
  }
  const targetWithOwnProto = payload();
  const beforeProto = Object.getPrototypeOf(targetWithOwnProto);
  const cloned = merge(targetWithOwnProto, { added: true });
  assertSafe(cloned);
  assert.equal(cloned.added, true);
  assert.equal(Object.getPrototypeOf(targetWithOwnProto), beforeProto);
  assert.equal(targetWithOwnProto.__proto__.admin, true);
  assert.equal(source.__proto__.admin, true);
});

test('nested placeholder replacement and merge.all cannot introduce a poisoned prototype', () => {
  const nested = JSON.parse('{"session":{"__proto__":{"admin":true},"safe":true}}');
  for (const placeholder of [null, undefined, false, 0, '', Object.create(null)]) {
    assertSafe(merge({ session: placeholder }, nested).session);
  }
  assertSafe(merge.all([{ session: null }, nested, { session: { added: true } }]).session);
});

test('constructor, prototype, arrayMerge, customMerge, clone and symbols retain behavior', () => {
  const symbol = Symbol('retained');
  const target = { constructor: { first: true }, prototype: { first: true }, list: [1], nested: { left: true } };
  target[symbol] = { first: true };
  const source = { constructor: { second: true }, prototype: { second: true }, list: [2], nested: { right: true } };
  source[symbol] = { second: true };
  const combined = merge(target, source, {
    customMerge(key) {
      if (key === 'nested') return (a, b) => ({ custom: true, ...a, ...b });
    },
  });
  assert.deepEqual(combined.constructor, { first: true, second: true });
  assert.deepEqual(combined.prototype, { first: true, second: true });
  assert.deepEqual(combined.list, [1, 2]);
  assert.deepEqual(combined.nested, { custom: true, left: true, right: true });
  assert.deepEqual(combined[symbol], { first: true, second: true });
  assert.notEqual(combined[symbol], source[symbol]);

  const reference = { value: true };
  const cloned = merge({}, { reference }, { clone: false });
  assert.equal(cloned.reference, reference);
});

test('deepmerge physical-install census matches the lockfile fork entry', () => {
  const locked = Object.keys(lock.packages)
    .filter((key) => /(^|\/)node_modules\/deepmerge$/.test(key))
    .sort();
  const installed = [];
  function visit(nodeModulesDir) {
    for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
      if (entry.name === '.bin') continue;
      const packageDir = path.join(nodeModulesDir, entry.name);
      assert.equal(entry.isSymbolicLink(), false, `unexpected package symlink at ${packageDir}`);
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('@')) {
        visit(packageDir);
      } else {
        if (entry.name === 'deepmerge') installed.push(`${path.relative(backendRoot, packageDir).split(path.sep).join('/')}/package.json`);
        const nested = path.join(packageDir, 'node_modules');
        if (fs.existsSync(nested)) visit(nested);
      }
    }
  }
  visit(path.join(backendRoot, 'node_modules'));
  installed.sort();
  assert.deepEqual(locked, ['node_modules/deepmerge']);
  assert.deepEqual(installed, locked.map((key) => `${key}/package.json`));
  const installedPackage = JSON.parse(fs.readFileSync(path.join(backendRoot, installed[0]), 'utf8'));
  assert.equal(installedPackage.name, '@tzudong/deepmerge');
  assert.equal(installedPackage.version, '4.3.1-tzudong.1');
});

test('both transitive callers resolve the top-level fork without changing stealth packages', () => {
  const fork = lock.packages['node_modules/deepmerge'];
  assert.equal(fork.name, '@tzudong/deepmerge');
  assert.equal(fork.version, '4.3.1-tzudong.1');
  assert.equal(fork.resolved, 'file:vendor/deepmerge-4.3.1-tzudong.1.tgz');
  for (const caller of ['node_modules/puppeteer-extra', 'node_modules/puppeteer-extra-plugin-user-preferences']) {
    assert.match(lock.packages[caller].dependencies.deepmerge, /^\^4\./);
    assert.equal(require.resolve('deepmerge', { paths: [path.join(backendRoot, caller)] }), require.resolve('deepmerge'));
  }
  assert.ok(lock.packages['node_modules/puppeteer-extra-plugin-stealth']);
  const extra = require('puppeteer-extra');
  const use = extra.default || extra;
  const stealthExport = require('puppeteer-extra-plugin-stealth');
  const stealth = (stealthExport.default || stealthExport)();
  use.use(stealth);
  assert.ok(use.plugins.some((plugin) => plugin.name === 'stealth'));
  assert.ok(stealth.enabledEvasions.has('navigator.webdriver'));
  assert.ok(stealth.enabledEvasions.has('user-agent-override'));

  const userPreferences = require('puppeteer-extra-plugin-user-preferences');
  const preferences = userPreferences({ userPrefs: { fonts: { size: 14 } } });
  preferences._userPrefsFromPlugins = merge.all([{ fonts: { family: 'Fixture' } }, { safe: true }]);
  assert.deepEqual(preferences.combinedPrefs, {
    fonts: { size: 14, family: 'Fixture' }, safe: true,
  });
});


test('installed fork retains tracked entrypoints, declarations and MIT license', () => {
  const sourceRoot = path.join(backendRoot, 'vendor/tzudong-deepmerge-4.3.1-tzudong.1');
  const installedRoot = path.join(backendRoot, 'node_modules/deepmerge');
  for (const name of ['index.js', 'dist/cjs.js', 'dist/umd.js', 'index.d.ts', 'license.txt']) {
    assert.deepEqual(fs.readFileSync(path.join(installedRoot, name)), fs.readFileSync(path.join(sourceRoot, name)), name);
  }
});
