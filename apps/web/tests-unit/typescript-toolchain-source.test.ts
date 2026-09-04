import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = (file: string) => readFileSync(resolve(root, file), "utf8");
const parseBunLock = () => JSON.parse(source("bun.lock").replace(/,\s*([}\]])/g, "$1"));

describe("TypeScript 7 dual-toolchain manifest contract", () => {
  test("release, nightly, and benchmark lanes use the current Bun contract", () => {
    for (const workflow of ["web-admin-ci.yml", "nightly-regression.yml", "release-governance-ci.yml"]) {
      const contents = source(`../../.github/workflows/${workflow}`);
      const pins = [...contents.matchAll(/bun-version: '([^']+)'/g)].map((match) => match[1]);
      expect(pins.length).toBeGreaterThan(0);
      expect(pins.every((pin) => pin === "1.4.0")).toBe(true);
      if (workflow === "web-admin-ci.yml") {
        expect(contents.match(/run typecheck:benchmark --/g)?.length).toBe(4);
        expect(contents).toContain('test "$(bun --version)" = "1.4.0"');
      }
    }
  });

  test("pins the native CLI, bridge, stable API, and ESLint owner exactly", () => {
    const manifest = JSON.parse(source("package.json"));
    expect(manifest.engines.node).toBe("24.x");
    expect(manifest.packageManager).toBe("npm@11.6.2");
    expect(manifest.devDependencies).toMatchObject({
      "@typescript/native": "npm:typescript@7.0.2",
      "@typescript/old": "npm:typescript@6.0.2",
      typescript: "npm:@typescript/typescript6@6.0.2",
      "typescript-eslint": "8.63.0",
    });
    expect(manifest.overrides["@typescript/old"]).toBeUndefined();
    expect(manifest.scripts["typecheck:verify"]).toBe("node scripts/verify-typescript-toolchain.mjs");
    expect(manifest.scripts["typecheck:native"]).toContain("run-typecheck.mjs --compiler native");
    expect(manifest.scripts["typecheck:compat"]).toContain("run-typecheck.mjs --compiler compat");
    expect(manifest.scripts["typecheck:parity"]).toContain("run-typecheck.mjs --compiler parity");
    expect(manifest.scripts["bench:typecheck"]).toBe("node scripts/measure-typecheck.mjs");
    expect(manifest.scripts["typecheck:benchmark"]).toBe(manifest.scripts["bench:typecheck"]);
  });

  test("keeps TS7 config valid without weakening the app", () => {
    const config = JSON.parse(source("tsconfig.json"));
    expect(config.compilerOptions.baseUrl).toBeUndefined();
    expect(config.compilerOptions.strict).toBe(true);
    expect(config.compilerOptions.noEmit).toBe(true);
    expect(config.compilerOptions.moduleResolution).toBe("bundler");
    expect(config.compilerOptions.paths["@/*"]).toEqual(["./*"]);
    expect(config.compilerOptions.ignoreDeprecations).toBeUndefined();
  });

  test("reconciles exact npm and Bun dependency graphs", () => {
    const npmLock = JSON.parse(source("package-lock.json"));
    const manifest = JSON.parse(source("package.json"));
    const bunLockSource = source("bun.lock");
    const bunLock = parseBunLock();
    expect(npmLock.packages[""].dependencies).toEqual(manifest.dependencies);
    expect(npmLock.packages[""].devDependencies).toEqual(manifest.devDependencies);
    expect(bunLock.workspaces[""].dependencies).toEqual(manifest.dependencies);
    expect(bunLock.workspaces[""].devDependencies).toEqual(manifest.devDependencies);

    for (const name of [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]) {
      const npmVersion = npmLock.packages[`node_modules/${name}`]?.version;
      const bunIdentity = bunLock.packages[name]?.[0];
      expect(npmVersion, `${name} missing from npm lock`).toBeString();
      expect(bunIdentity, `${name} missing from Bun lock`).toBeString();
      expect(bunIdentity.slice(bunIdentity.lastIndexOf("@") + 1), `${name} lock version parity`).toBe(npmVersion);
    }
    expect(npmLock.packages[""].devDependencies).toMatchObject({
      "@typescript/native": "npm:typescript@7.0.2",
      "@typescript/old": "npm:typescript@6.0.2",
      typescript: "npm:@typescript/typescript6@6.0.2",
      "typescript-eslint": "8.63.0",
    });
    expect(npmLock.packages["node_modules/@typescript/native"]).toMatchObject({ name: "typescript", version: "7.0.2" });
    expect(npmLock.packages["node_modules/@typescript/old"]).toMatchObject({ name: "typescript", version: "6.0.2" });
    expect(npmLock.packages["node_modules/typescript"]).toMatchObject({ name: "@typescript/typescript6", version: "6.0.2" });
    for (const text of [
      '"@typescript/native": "npm:typescript@7.0.2"',
      '"@typescript/old": "npm:typescript@6.0.2"',
      '"typescript": "npm:@typescript/typescript6@6.0.2"',
      '"typescript-eslint": "8.63.0"',
      '"@typescript/native": ["typescript@7.0.2"',
      '"@typescript/old": ["typescript@6.0.2"',
      '"typescript": ["@typescript/typescript6@6.0.2"',
    ]) expect(bunLockSource).toContain(text);
  });

  test("verifier owns package, CLI, API, and native binary provenance", () => {
    const verifier = source("scripts/verify-typescript-toolchain.mjs");
    expect(verifier).toContain("require('typescript').version");
    expect(verifier).toContain("@typescript/typescript-${process.platform}-${process.arch}");
    expect(verifier).toContain("stableApiDependencyManifest");
    expect(verifier).toContain("platformBinarySha256");
    expect(verifier).toContain("TOOLCHAIN_NATIVE_BIN_OWNER_INVALID");
    expect(verifier).toContain("TOOLCHAIN_BRIDGE_BIN_OWNER_INVALID");
    expect(verifier).toContain("verifyBinShims('tsc', nativeEntrypoint, compatEntrypoint)");
    expect(verifier).toContain("verifyBinShims('tsc6', compatEntrypoint, nativeEntrypoint)");
    expect(verifier).toContain("const binaryShim = `${name}.exe`");
    expect(verifier).toContain("shimNames = [name, `${name}.cmd`, `${name}.ps1`]");
    expect(verifier).toContain("TOOLCHAIN_SHIM_BINARY_INVALID");
    expect(verifier).toContain("shim[0] !== 0x4d || shim[1] !== 0x5a");
    expect(verifier).toContain("nativeBinShims");
    expect(verifier).toContain("compatBinShims");
    expect(verifier).toContain("relativeReceiptPath(apiIdentity.manifest)");
    expect(verifier).toContain("relativeReceiptPath(oldManifestPath)");
    expect(verifier).toContain("TOOLCHAIN_OLD_OVERRIDE_FORBIDDEN");
    expect(verifier).toContain("redactCliText(result.stdout, 512)");
    expect(verifier).toContain("redactCliText(result.stderr, 512)");
    expect(verifier).toContain("if (result.error)");
    expect(verifier).toContain("TOOLCHAIN_COMMAND_LAUNCH_FAILED");
    expect(verifier).toContain("TOOLCHAIN_COMMAND_SIGNAL");
    expect(verifier).toContain("TOOLCHAIN_COMMAND_STATUS");
    expect(verifier).toContain("logCliError(error");
    expect(verifier).not.toContain("{ cause: result.error }");
  });
  test("classifies parity inputs with canonical platform-aware containment and rejects unusable collections", () => {
    const typecheck = source("scripts/run-typecheck.mjs");
    expect(typecheck).toContain("await realpath(path.resolve(rawPath.trim()))");
    expect(typecheck).toContain("process.platform === 'win32' ? normalized.toLowerCase() : normalized");
    expect(typecheck).toContain("path.posix.relative(canonicalPath(root), canonicalPath(target))");
    expect(typecheck).toContain("const isNativeLib = containedPath(nativeLib, normalized)");
    expect(typecheck).toContain("const isCompatLib = containedPath(compatLib, normalized)");
    expect(typecheck).toContain("standard-library file from the opposite compiler root");
    expect(typecheck).toContain("const stderr = normalizeDiagnostics(result.stderr)");
    expect(typecheck).toContain("--listFilesOnly wrote to stderr");
    expect(typecheck).toContain("--listFilesOnly produced no input files");
    expect(typecheck).toContain("--listFilesOnly produced no logical inputs");
    expect(typecheck).toContain("Both diagnostic streams must be empty");
    expect(typecheck).toContain("Logical input content-hash parity failed");
  });
});
