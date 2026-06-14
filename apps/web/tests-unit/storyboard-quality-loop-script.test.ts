import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";

const WEB_ROOT = resolve(import.meta.dir, "..");

describe("storyboard quality loop script", () => {
  it("scores 12 operator scenarios with scope classification and exact seed provenance", () => {
    const outputDir = ".omx/test-artifacts/storyboard-quality-loop-script";
    const stdout = execFileSync(
      "node",
      [
        "scripts/storyboard-quality-loop.mjs",
        "--cases",
        "12",
        "--output-dir",
        outputDir,
        "--json",
      ],
      {
        cwd: WEB_ROOT,
        encoding: "utf8",
      },
    );

    const summary = JSON.parse(stdout) as {
      status: string;
      caseCount: number;
      passedCount: number;
      averageScore: number;
      exactImageProvenance: {
        model: string;
        trustedImageCount: number;
        failClosed: boolean;
      };
      scopeManifest: {
        excludedScopes: string[];
      };
      artifacts: {
        report: string;
        summary: string;
        manifest: string;
      };
    };

    expect(summary.status).toBe("passed");
    expect(summary.caseCount).toBe(12);
    expect(summary.passedCount).toBe(12);
    expect(summary.averageScore).toBeGreaterThanOrEqual(90);
    expect(summary.exactImageProvenance.model).toBe("gpt-image-2");
    expect(summary.exactImageProvenance.trustedImageCount).toBeGreaterThan(0);
    expect(summary.exactImageProvenance.failClosed).toBe(false);
    expect(summary.scopeManifest.excludedScopes).toContain("thumbnail-residue-preserve");

    for (const artifact of [
      summary.artifacts.report,
      summary.artifacts.summary,
      summary.artifacts.manifest,
    ]) {
      expect(existsSync(resolve(WEB_ROOT, artifact))).toBe(true);
    }

    const report = readFileSync(resolve(WEB_ROOT, summary.artifacts.report), "utf8");
    expect(report).toContain("Storyboard Quality Loop v1");
    expect(report).toContain("fixture-readback");
    expect(report).toContain("does not call imagegen");
  });

  it("fails closed when seed image provenance is missing or not exact", () => {
    const seed = JSON.parse(
      readFileSync(resolve(WEB_ROOT, "public/storyboard-seed/latest-real-data.json"), "utf8"),
    ) as {
      result: {
        storyboard: {
          scenes: Array<{ generatedImage?: Record<string, unknown> }>;
        };
      };
    };
    const seedDir = resolve(WEB_ROOT, ".omx/test-artifacts/storyboard-quality-loop-negative");
    mkdirSync(seedDir, { recursive: true });

    for (const [name, mutate] of [
      [
        "missing-provenance",
        (image: Record<string, unknown>) => {
          delete image.provenance;
        },
      ],
      [
        "unknown-provenance",
        (image: Record<string, unknown>) => {
          image.provenance = {
            ...(image.provenance as Record<string, unknown>),
            modelProvenance: "unknown",
          };
        },
      ],
      [
        "wrong-model",
        (image: Record<string, unknown>) => {
          image.model = "gpt-image-1";
          image.provenance = {
            ...(image.provenance as Record<string, unknown>),
            model: "gpt-image-1",
            requestToolModel: "gpt-image-1",
          };
        },
      ],
    ] as const) {
      const badSeed = structuredClone(seed);
      for (const scene of badSeed.result.storyboard.scenes) {
        if (scene.generatedImage) mutate(scene.generatedImage);
      }
      const badSeedPath = resolve(seedDir, `${name}.json`);
      writeFileSync(badSeedPath, JSON.stringify(badSeed));

      const result = spawnSync(
        "node",
        [
          "scripts/storyboard-quality-loop.mjs",
          "--cases",
          "1",
          "--seed-file",
          badSeedPath,
          "--output-dir",
          `.omx/test-artifacts/storyboard-quality-loop-negative/${name}-out`,
          "--json",
        ],
        {
          cwd: WEB_ROOT,
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(1);
      const summary = JSON.parse(result.stdout) as {
        status: string;
        passedCount: number;
        exactImageProvenance: {
          trustedImageCount: number;
          failClosed: boolean;
        };
        failureClusters: Array<{ reason: string; count: number }>;
      };
      expect(summary.status).toBe("failed");
      expect(summary.passedCount).toBe(0);
      expect(summary.exactImageProvenance.trustedImageCount).toBe(0);
      expect(summary.exactImageProvenance.failClosed).toBe(true);
      expect(summary.failureClusters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: "exact gpt-image-2 storyboard image provenance/readback unavailable",
          }),
        ]),
      );
    }
  });

  it("rejects output directories outside the OMX artifact tree", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/storyboard-quality-loop.mjs",
        "--cases",
        "1",
        "--output-dir",
        "../outside-storyboard-quality-loop",
        "--json",
      ],
      {
        cwd: WEB_ROOT,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--output-dir must stay under .omx/");
  });

  it("treats a supplied but unreachable HTTP readback URL as a gating failure", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/storyboard-quality-loop.mjs",
        "--cases",
        "1",
        "--base-url",
        "http://127.0.0.1:9",
        "--output-dir",
        ".omx/test-artifacts/storyboard-quality-loop-http-fail",
        "--json",
      ],
      {
        cwd: WEB_ROOT,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout) as {
      status: string;
      httpReadback: { mode: string; ok: boolean };
      failureClusters: Array<{ reason: string; count: number }>;
    };
    expect(summary.status).toBe("failed");
    expect(summary.httpReadback.mode).toBe("http");
    expect(summary.httpReadback.ok).toBe(false);
    expect(summary.failureClusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "HTTP storyboard seed readback unavailable",
        }),
      ]),
    );
  });
});
