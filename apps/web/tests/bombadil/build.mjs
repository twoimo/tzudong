/* global Bun */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output || process.argv.length !== 3) throw new Error('BOMBADIL_BUILD_ARGUMENTS');
const result = await Bun.build({
  entrypoints: [path.join(root, 'fixture-entry.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{
    name: 'existing-next-image-interop',
    setup(build) {
      build.onResolve({ filter: /^next\/image$/ }, () => ({
        path: path.join(root, '../fixtures/local-storyboard-ui/next-image-shim.ts'),
      }));
    },
  }],
});
if (!result.success) throw new Error('BOMBADIL_FIXTURE_BUILD_FAILED');
if (result.outputs.length !== 1) throw new Error('BOMBADIL_FIXTURE_OUTPUT_SHAPE');
await Bun.write(output, result.outputs[0]);
