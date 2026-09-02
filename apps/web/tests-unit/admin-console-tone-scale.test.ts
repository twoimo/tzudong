import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONSOLE_TONE_MODE_CHANNELS,
  CONSOLE_TONE_STEP_IDS,
  CONSOLE_TONE_STEPS,
  getSeriesToneAssignment,
  getToneStepCompositeLightnessPercent,
  getToneStepContrastRatio,
  type ConsoleToneMode,
  type ConsoleToneStepId,
} from "../lib/admin/console-tone-scale";

const appRoot = join(import.meta.dir, "..");

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseTokenChannels(
  css: string,
  token: "--foreground" | "--card" | "--background" | "--destructive",
): { h: number; s: number; l: number } | null {
  const match = css.match(
    new RegExp(`${token}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
  );
  if (!match) {
    return null;
  }
  return {
    h: Number(match[1]),
    s: Number(match[2]),
    l: Number(match[3]),
  };
}

function parseDarkBlock(css: string): string {
  const match = css.match(/\.dark\s*\{([\s\S]*?)\}/);
  return match?.[1] ?? "";
}

describe("admin console tone scale", () => {
  test("parses theme token channels that the contrast function uses", () => {
    const lightCss = readFileSync(
      join(appRoot, "styles/light-root-tokens.css"),
      "utf8",
    );
    const globalCss = readFileSync(join(appRoot, "app/globals.css"), "utf8");
    const darkCss = parseDarkBlock(globalCss);

    expect(parseTokenChannels(lightCss, "--foreground")).toEqual(
      CONSOLE_TONE_MODE_CHANNELS.light["--foreground"],
    );
    expect(parseTokenChannels(lightCss, "--card")).toEqual(
      CONSOLE_TONE_MODE_CHANNELS.light["--card"],
    );
    expect(parseTokenChannels(lightCss, "--background")).toEqual(
      CONSOLE_TONE_MODE_CHANNELS.light["--background"],
    );
    expect(parseTokenChannels(darkCss, "--foreground")).toEqual(
      CONSOLE_TONE_MODE_CHANNELS.dark["--foreground"],
    );
    expect(parseTokenChannels(darkCss, "--card")).toEqual(
      CONSOLE_TONE_MODE_CHANNELS.dark["--card"],
    );
    expect(parseTokenChannels(darkCss, "--background")).toEqual(
      CONSOLE_TONE_MODE_CHANNELS.dark["--background"],
    );
  });

  // Property 13: 중립_계조 구분 가능성
  // Validates: Requirements 9.1, 9.5, 9.11, 12.1, 12.2
  test("assigns distinguishable tone steps for two to six series", () => {
    const random = mulberry32(13);
    const modes: ConsoleToneMode[] = ["light", "dark"];

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const seriesCount = 2 + Math.floor(random() * 5);
      const mode = modes[Math.floor(random() * modes.length)];
      const { assignments, requiresNonToneChannel } =
        getSeriesToneAssignment(seriesCount);

      expect(requiresNonToneChannel).toBe(false);
      expect(assignments).toHaveLength(seriesCount);
      const steps = assignments.map((slot) => slot.step);
      expect(new Set(steps).size).toBe(seriesCount);

      for (let index = 1; index < assignments.length; index += 1) {
        const previous = getToneStepCompositeLightnessPercent(
          assignments[index - 1].step,
          "card",
          mode,
        );
        const current = getToneStepCompositeLightnessPercent(
          assignments[index].step,
          "card",
          mode,
        );
        expect(Math.abs(current - previous)).toBeGreaterThanOrEqual(8);
      }

      for (const slot of assignments) {
        const fillContrast = getToneStepContrastRatio(slot.step, "card", mode);
        const strokeStep = Number(
          slot.strokeVariable.replace("--admin-tone-", ""),
        ) as ConsoleToneStepId;
        const strokeContrast = getToneStepContrastRatio(strokeStep, "card", mode);
        expect(Math.max(fillContrast, strokeContrast)).toBeGreaterThanOrEqual(3);
      }
    }

    const overflow = getSeriesToneAssignment(7);
    expect(overflow.requiresNonToneChannel).toBe(true);
    expect(overflow.assignments).toHaveLength(7);
    expect(overflow.assignments.map((slot) => slot.step)).toEqual([
      1, 2, 3, 4, 5, 6, 1,
    ]);
    expect(CONSOLE_TONE_STEPS).toHaveLength(6);
    expect(CONSOLE_TONE_STEP_IDS).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
