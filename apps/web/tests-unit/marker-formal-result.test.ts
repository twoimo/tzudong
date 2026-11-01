import { expect, test } from 'bun:test';
import { isExpectedMutationFailure } from '../scripts/marker-formal-result.mjs';

const name = 'every pool/click action sequence through depth four';
test('a genuine completed assertion counterexample is detected only for the intended test', () => {
  const output = `expect(received).toBeNull()\nReceived: stale-callback\n(fail) ${name}\n1 fail\n5 expect() calls`;
  expect(isExpectedMutationFailure({ exitCode: 1, output }, name)).toBe(true);
  expect(isExpectedMutationFailure({ exitCode: 0, output }, name)).toBe(false);
  expect(isExpectedMutationFailure({ exitCode: 137, output }, name)).toBe(false);
  expect(isExpectedMutationFailure({ exitCode: 1, output }, 'unrelated test')).toBe(false);
});

test('an actual unresolved bundle import with the same failed-test label is a harness failure', async () => {
  let diagnostic = '';
  try {
  const result = await Bun.build({ entrypoints: ['missing-formal-import'], target: 'browser', write: false,
    plugins: [{ name: 'missing-formal-import', setup(build) {
      build.onResolve({ filter: /^missing-formal-import$/ }, () => ({ path: 'entry', namespace: 'missing-formal-import' }));
      build.onLoad({ filter: /.*/, namespace: 'missing-formal-import' }, () => ({
        contents: "import './intentionally-missing-native-activation.ts';", loader: 'ts', resolveDir: import.meta.dir,
      }));
    }}] });
  expect(result.success).toBe(false);
  diagnostic = result.logs.map(String).join('\n');
  } catch (error) {
    diagnostic = error instanceof AggregateError ? error.errors.map(String).join('\n') : String(error);
  }
  expect(diagnostic).toMatch(/Could not resolve.*intentionally-missing-native-activation/i);
  const output = diagnostic + `\n(fail) ${name}`;
  expect(isExpectedMutationFailure({ exitCode: 1, output }, name)).toBe(false);
});

test.each(['FORMAL_BROWSER_REQUIRED', 'Cannot find module', 'BuildMessage', 'ResolveMessage', 'Module not found'])(
  '%s does not count as successful mutation detection', (failure) => {
    expect(isExpectedMutationFailure({ exitCode: 1, output: `${failure}\n(fail) ${name}` }, name)).toBe(false);
  },
);
