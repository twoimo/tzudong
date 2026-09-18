/* global Bun */
// Builds the isolated storyboard UI bundle for
// tests/local-storyboard-workspace-ui.spec.ts. Everything executable is committed
// here and in the sibling entry module, so no JavaScript source is assembled from
// interpolated strings at test time.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const harnessRoot = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error("Expected the bundle output path as the first argument");

const result = await Bun.build({
  entrypoints: [join(harnessRoot, "entry.ts")],
  target: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "next-image-entry",
      setup(build) {
        build.onResolve({ filter: /^next\/image$/ }, () => ({
          path: join(harnessRoot, "next-image-shim.ts"),
        }));
      },
    },
  ],
});

if (!result.success) throw new AggregateError(result.logs, "UI bundle failed");
if (result.outputs.length !== 1) throw new Error("Expected one browser bundle");
await Bun.write(output, result.outputs[0]);
