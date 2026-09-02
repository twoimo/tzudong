import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = (file: string) => readFileSync(resolve(root, file), "utf8");
const parseBunLock = () => JSON.parse(source("bun.lock").replace(/,\s*([}\]])/g, "$1"));

describe("Pin_Contract verifier source contract (design C2 / requirement 5)", () => {
  const verifier = source("scripts/verify-pin-contract.mjs");

  test("owns the two bounded fixed codes and never mutates release-authority files", () => {
    expect(verifier).toContain("const PIN_CONTRACT_DRIFT = 'pin_contract_drift'");
    expect(verifier).toContain("const GLOBAL_COMPILER_NOT_ADMITTED = 'global_compiler_not_admitted'");
    // Release authority is read-only: the verifier never writes any file.
    expect(verifier).not.toContain("writeFile");
    // bun.lock is never treated as authority; adjustment stays report-only.
    expect(verifier).toContain("authority: 'package-lock.json'");
    expect(verifier).toContain("bunLockAdjusted: false");
  });

  test("verifies all six Pin_Contract items with declared vs resolved", () => {
    for (const item of [
      "item: 'npm'",
      "item: 'node'",
      "item: 'typescript_native_alias'",
      "item: 'typescript_compat_bridge'",
      "item: 'package_json'",
      "item: 'package_lock_json'",
    ]) {
      expect(verifier).toContain(item);
    }
    expect(verifier).toContain("npm: '11.6.2'");
    expect(verifier).toContain("nodeMajor: 24");
    expect(verifier).toContain("nativeAlias: 'npm:typescript@7.0.2'");
    expect(verifier).toContain("nativeResolved: '7.0.2'");
    expect(verifier).toContain("compatAlias: 'npm:@typescript/typescript6@6.0.2'");
    expect(verifier).toContain("compatResolved: '6.0.2'");
  });

  test("routes type checking through npm run typecheck:parity and guards the compiler root", () => {
    expect(verifier).toContain("typecheckParityScript: 'node scripts/run-typecheck.mjs --compiler parity'");
    expect(verifier).toContain("resolveCompilerInRepoTree");
    expect(verifier).toContain("'node_modules', '@typescript', 'native', 'bin', 'tsc'");
    expect(verifier).toContain("throw statusError(GLOBAL_COMPILER_NOT_ADMITTED)");
    expect(verifier).toContain("containedPath(resolvedRoot, resolvedEntrypoint)");
  });

  test("detects bun.lock vs package-lock.json conflicts and records list + count", () => {
    expect(verifier).toContain("function lockConflicts");
    expect(verifier).toContain("mismatchPackages");
    expect(verifier).toContain("mismatchCount: mismatchPackages.length");
  });

  test("fails closed on drift while still recording the per-item receipt", () => {
    expect(verifier).toContain("status: drift ? 'failed' : 'passed'");
    expect(verifier).toContain("code: drift ? PIN_CONTRACT_DRIFT : null");
    expect(verifier).toContain("if (drift) process.exitCode = 1");
  });
});

describe("Pin_Contract declared values in the tree", () => {
  const manifest = JSON.parse(source("package.json"));
  const npmLock = JSON.parse(source("package-lock.json"));
  const bunLock = parseBunLock();

  test("package.json and both locks pin the exact contract versions", () => {
    expect(manifest.packageManager).toBe("npm@11.6.2");
    expect(manifest.engines.node).toBe("24.x");
    expect(manifest.devDependencies["@typescript/native"]).toBe("npm:typescript@7.0.2");
    expect(manifest.devDependencies.typescript).toBe("npm:@typescript/typescript6@6.0.2");
    expect(manifest.scripts["typecheck:parity"]).toBe("node scripts/run-typecheck.mjs --compiler parity");

    expect(npmLock.packages["node_modules/@typescript/native"]).toMatchObject({ name: "typescript", version: "7.0.2" });
    expect(npmLock.packages["node_modules/typescript"]).toMatchObject({ name: "@typescript/typescript6", version: "6.0.2" });

    expect(bunLock.packages["@typescript/native"][0]).toBe("typescript@7.0.2");
    expect(bunLock.packages.typescript[0]).toBe("@typescript/typescript6@6.0.2");
  });
});

describe("Pin_Contract verifier runtime behavior", () => {
  const runVerifier = () =>
    spawnSync("node", ["scripts/verify-pin-contract.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      shell: false,
    });

  test("emits a per-item receipt and reports lock reconciliation state", () => {
    const result = runVerifier();
    // Whether the environment matches every pin or not, the verifier must emit a
    // structured per-item receipt (requirement 5.7). A global compiler would emit
    // no receipt, so parsing the JSON also proves the compiler was admitted.
    const receipt = JSON.parse(result.stdout.trim().split("\n").pop() as string);
    expect(receipt.pinContract).toHaveLength(6);
    expect(receipt.pinContract.map((entry: { item: string }) => entry.item).sort()).toEqual([
      "node",
      "npm",
      "package_json",
      "package_lock_json",
      "typescript_compat_bridge",
      "typescript_native_alias",
    ]);
    expect(receipt.typecheck.match).toBe(true);
    expect(receipt.typecheck.compilerInRepoTree).toBe(true);
    expect(receipt.lockReconciliation.authority).toBe("package-lock.json");
    expect(receipt.lockReconciliation.bunLockAdjusted).toBe(false);
    expect(typeof receipt.lockReconciliation.mismatchCount).toBe("number");
    // Environment-independent pins must resolve as matches.
    const byItem = Object.fromEntries(
      receipt.pinContract.map((entry: { item: string; match: boolean }) => [entry.item, entry.match]),
    );
    expect(byItem.typescript_native_alias).toBe(true);
    expect(byItem.typescript_compat_bridge).toBe(true);
    expect(byItem.package_json).toBe(true);
    expect(byItem.package_lock_json).toBe(true);

    // Fail-closed contract: on any drift the exit code is non-zero and the code
    // is the bounded pin_contract_drift; otherwise a clean pass.
    if (receipt.status === "failed") {
      expect(receipt.code).toBe("pin_contract_drift");
      expect(result.status).toBe(1);
    } else {
      expect(receipt.code).toBeNull();
      expect(result.status).toBe(0);
    }
  });
});
