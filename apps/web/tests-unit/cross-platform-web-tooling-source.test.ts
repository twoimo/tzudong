import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getWebToolInvocation, runWebTool } from "../scripts/run-web-tool.mjs";

const root = resolve(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

describe("cross-platform web command wrapper", () => {
  test("routes mandatory environment-bearing scripts through one Node wrapper", () => {
    expect(manifest.scripts.lint).toBe("node scripts/run-web-tool.mjs eslint . --ext .js,.jsx,.ts,.tsx --max-warnings=0");
    expect(manifest.scripts["lint:fix"]).toBe("node scripts/run-web-tool.mjs eslint . --ext .js,.jsx,.ts,.tsx --fix");
    expect(manifest.scripts.analyze).toBe("node scripts/run-web-tool.mjs next-analyze");
    for (const [name, command] of Object.entries<string>(manifest.scripts)) {
      if (name === "storyboard:image-proof") continue;
      expect(command).not.toMatch(/^(?:[A-Za-z_][A-Za-z0-9_]*=|set\s+[A-Za-z_][A-Za-z0-9_]*=)/i);
    }
  });

  test("runs allowlisted local entrypoints with an inherited ESLint environment and literal arguments", () => {
    const inheritedEnvironmentKey = "WEB_TOOL_INHERITED_FIXTURE";
    const previousInheritedValue = process.env[inheritedEnvironmentKey];
    const child = new EventEmitter();
    const spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];

    process.env[inheritedEnvironmentKey] = "preserved";
    try {
      runWebTool("eslint", ["--rule", "semi: [error, always]", "&&", "not-a-command"], (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return child as never;
      });

      expect(spawnCalls).toEqual([
        {
          command: process.execPath,
          args: [
            resolve(root, "node_modules/eslint/bin/eslint.js"),
            "--rule",
            "semi: [error, always]",
            "&&",
            "not-a-command",
          ],
          options: expect.objectContaining({
            cwd: `${resolve(root, "scripts")}${sep}..`,
            env: expect.objectContaining({
              [inheritedEnvironmentKey]: "preserved",
              BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
              BROWSERSLIST_IGNORE_OLD_DATA: "true",
            }),
            shell: false,
            stdio: ["inherit", "pipe", "pipe"],
          }),
        },
      ]);
    } finally {
      if (previousInheritedValue === undefined) delete process.env[inheritedEnvironmentKey];
      else process.env[inheritedEnvironmentKey] = previousInheritedValue;
    }
  });

  test("propagates child exit codes and signals without shell fixtures", () => {
    const exitChild = new EventEmitter();
    const originalExitCode = process.exitCode;

    try {
      runWebTool("eslint", [], () => exitChild as never);
      exitChild.emit("exit", 23, null);
      expect(process.exitCode).toBe(23);
    } finally {
      process.exitCode = originalExitCode ?? 0;
    }

    const signalChild = new EventEmitter();
    const kill = spyOn(process, "kill").mockImplementation(() => true);
    try {
      runWebTool("eslint", [], () => signalChild as never);
      signalChild.emit("exit", null, "SIGTERM");
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
    } finally {
      kill.mockRestore();
    }
  });

  test("rejects unknown tools and forwards ESLint arguments without starting ESLint", () => {
    const wrapperPath = resolve(root, "scripts/run-web-tool.mjs");
    const unknown = spawnSync(process.execPath, [wrapperPath, "unknown-tool"], { cwd: root, encoding: "utf8" });
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("[run-web-tool] error=UnknownTool");

    expect(getWebToolInvocation("unknown-tool", ["--version"])).toBeNull();
    expect(getWebToolInvocation("toString", ["--version"])).toBeNull();
    expect(getWebToolInvocation("eslint", ["--version", "--no-warn-ignored"])).toEqual({
      entrypoint: resolve(root, "node_modules/eslint/bin/eslint.js"),
      args: ["--version", "--no-warn-ignored"],
      env: {
        BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
        BROWSERSLIST_IGNORE_OLD_DATA: "true",
      },
    });
    expect(getWebToolInvocation("next-analyze", ["--profile"])).toEqual({
      entrypoint: resolve(root, "node_modules/next/dist/bin/next"),
      args: ["build", "--webpack", "--profile"],
      env: { ANALYZE: "true" },
    });
  });

  test("keeps release commands cross-platform and explicit", () => {
    expect(manifest.scripts["release-visual:run"]).toBe("node scripts/run-release-visual-evidence.mjs");
    expect(readFileSync(resolve(root, "scripts/run-release-visual-evidence.mjs"), "utf8")).toContain("node_modules/@playwright/test/cli.js");
    expect(manifest.scripts["release-visual:assemble"]).toBe("node scripts/assemble-release-visual-evidence.mjs");
    expect(manifest.scripts["release-visual:verify"]).toBe("node scripts/verify-release-visual-evidence.mjs");
    expect(manifest.scripts["release-performance:score"]).toBe("node scripts/score-performance-backlog.mjs");
    expect(manifest.scripts["release-performance:validate"]).toBe("node scripts/validate-performance-backlog.mjs");
  });
});
