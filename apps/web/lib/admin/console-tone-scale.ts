export const CONSOLE_TONE_STEP_IDS = [1, 2, 3, 4, 5, 6] as const;
export type ConsoleToneStepId = (typeof CONSOLE_TONE_STEP_IDS)[number];

export type ConsoleToneMode = "light" | "dark";
export type ConsoleToneSurface = "card" | "background";

export type ConsoleToneTokenName =
  | "--foreground"
  | "--muted-foreground"
  | "--muted"
  | "--border"
  | "--card"
  | "--background";

export type ConsoleToneStep = {
  readonly step: ConsoleToneStepId;
  readonly token: ConsoleToneTokenName;
  readonly alpha: number;
  readonly cssVariable: `--admin-tone-${ConsoleToneStepId}`;
  readonly fillOnlySafe: boolean;
};

export const CONSOLE_TONE_STEPS = [
  {
    step: 1,
    token: "--foreground",
    alpha: 1,
    cssVariable: "--admin-tone-1",
    fillOnlySafe: true,
  },
  {
    step: 2,
    token: "--foreground",
    alpha: 0.82,
    cssVariable: "--admin-tone-2",
    fillOnlySafe: true,
  },
  {
    step: 3,
    token: "--foreground",
    alpha: 0.66,
    cssVariable: "--admin-tone-3",
    fillOnlySafe: true,
  },
  {
    step: 4,
    token: "--foreground",
    alpha: 0.52,
    cssVariable: "--admin-tone-4",
    fillOnlySafe: true,
  },
  {
    step: 5,
    token: "--foreground",
    alpha: 0.4,
    cssVariable: "--admin-tone-5",
    fillOnlySafe: false,
  },
  {
    step: 6,
    token: "--foreground",
    alpha: 0.3,
    cssVariable: "--admin-tone-6",
    fillOnlySafe: false,
  },
] as const satisfies readonly ConsoleToneStep[];

export const CONSOLE_STATUS_ROLES = ["오류", "경고", "성공"] as const;
export type ConsoleStatusRole = (typeof CONSOLE_STATUS_ROLES)[number];

export type ConsoleStatusRoleAssignment =
  | {
      readonly token: "--destructive";
      readonly cssVariable: "--admin-status-error";
    }
  | {
      readonly token: null;
      readonly fallbackToneStep: ConsoleToneStepId;
    };

export const CONSOLE_STATUS_TOKENS = {
  오류: { token: "--destructive", cssVariable: "--admin-status-error" },
  경고: { token: null, fallbackToneStep: 2 },
  성공: { token: null, fallbackToneStep: 3 },
} as const satisfies Record<ConsoleStatusRole, ConsoleStatusRoleAssignment>;

export const CONSOLE_RADIUS_SCALE = {
  card: 24,
  control: 12,
  pill: "999px",
} as const;

export const CONSOLE_HAIRLINE_WIDTH_PX = 1;
export const CONSOLE_BAR_END_RADIUS_PX = 4;
export const CONSOLE_META_ROW_FONT_SIZE_PX = 11;
export const CONSOLE_META_ROW_MIN_HEIGHT_PX = 16;

export type ConsoleHslChannels = {
  readonly h: number;
  readonly s: number;
  readonly l: number;
};

export const CONSOLE_TONE_MODE_CHANNELS = {
  light: {
    "--foreground": { h: 24, s: 10, l: 10 },
    "--card": { h: 38, s: 30, l: 98 },
    "--background": { h: 38, s: 30, l: 98 },
    "--destructive": { h: 0, s: 84, l: 60 },
  },
  dark: {
    "--foreground": { h: 38, s: 30, l: 96 },
    "--card": { h: 24, s: 9, l: 13 },
    "--background": { h: 24, s: 10, l: 10 },
    "--destructive": { h: 0, s: 84, l: 60 },
  },
} as const satisfies Record<
  ConsoleToneMode,
  Record<
    "--foreground" | "--card" | "--background" | "--destructive",
    ConsoleHslChannels
  >
>;

export type ConsoleSeriesToneSlot = {
  readonly step: ConsoleToneStepId;
  readonly fillVariable: `--admin-tone-${ConsoleToneStepId}`;
  readonly strokeVariable: `--admin-tone-${ConsoleToneStepId}`;
  readonly strokeWidthPx: 1;
};

export type ConsoleSeriesToneAssignment = {
  readonly assignments: readonly ConsoleSeriesToneSlot[];
  readonly requiresNonToneChannel: boolean;
};

const CONSOLE_TONE_STEP_BY_ID = Object.fromEntries(
  CONSOLE_TONE_STEPS.map((step) => [step.step, step]),
) as Record<ConsoleToneStepId, (typeof CONSOLE_TONE_STEPS)[number]>;

export function getBarEndRadius(barThicknessPx: number): number {
  if (!Number.isFinite(barThicknessPx) || barThicknessPx <= 0) {
    return 0;
  }
  return barThicknessPx < CONSOLE_BAR_END_RADIUS_PX * 2
    ? barThicknessPx / 2
    : CONSOLE_BAR_END_RADIUS_PX;
}

export function getSeriesToneAssignment(
  seriesCount: number,
): ConsoleSeriesToneAssignment {
  if (!Number.isFinite(seriesCount) || seriesCount < 1) {
    return { assignments: [], requiresNonToneChannel: false };
  }

  const count = Math.trunc(seriesCount);
  const assignments = Array.from({ length: count }, (_, index) => {
    const step = CONSOLE_TONE_STEP_IDS[index % CONSOLE_TONE_STEP_IDS.length];
    const strokeStep = CONSOLE_TONE_STEP_BY_ID[step].fillOnlySafe ? step : 2;
    return {
      step,
      fillVariable: `--admin-tone-${step}`,
      strokeVariable: `--admin-tone-${strokeStep}`,
      strokeWidthPx: 1,
    } as const;
  });

  return {
    assignments,
    requiresNonToneChannel: count > CONSOLE_TONE_STEP_IDS.length,
  };
}

export function getToneStepCompositeLightnessPercent(
  step: ConsoleToneStepId,
  surface: ConsoleToneSurface,
  mode: ConsoleToneMode,
): number {
  const alpha = CONSOLE_TONE_STEP_BY_ID[step].alpha;
  const foreground = CONSOLE_TONE_MODE_CHANNELS[mode]["--foreground"];
  const surfaceChannels =
    CONSOLE_TONE_MODE_CHANNELS[mode][
      surface === "card" ? "--card" : "--background"
    ];
  return surfaceChannels.l + alpha * (foreground.l - surfaceChannels.l);
}

export function getToneStepContrastRatio(
  step: ConsoleToneStepId,
  surface: ConsoleToneSurface,
  mode: ConsoleToneMode,
): number {
  const alpha = CONSOLE_TONE_STEP_BY_ID[step].alpha;
  const foreground = hslToSrgb(
    CONSOLE_TONE_MODE_CHANNELS[mode]["--foreground"],
  );
  const surfaceRgb = hslToSrgb(
    CONSOLE_TONE_MODE_CHANNELS[mode][
      surface === "card" ? "--card" : "--background"
    ],
  );
  const fill = compositeSrgb(foreground, surfaceRgb, alpha);
  return contrastRatio(relativeLuminance(fill), relativeLuminance(surfaceRgb));
}

type Srgb = readonly [number, number, number];

function hslToSrgb(channels: ConsoleHslChannels): Srgb {
  const hue = ((channels.h % 360) + 360) % 360;
  const saturation = channels.s / 100;
  const lightness = channels.l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (huePrime < 1) {
    r = chroma;
    g = x;
  } else if (huePrime < 2) {
    r = x;
    g = chroma;
  } else if (huePrime < 3) {
    g = chroma;
    b = x;
  } else if (huePrime < 4) {
    g = x;
    b = chroma;
  } else if (huePrime < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  const match = lightness - chroma / 2;
  return [r + match, g + match, b + match];
}

function compositeSrgb(foreground: Srgb, surface: Srgb, alpha: number): Srgb {
  return [
    foreground[0] * alpha + surface[0] * (1 - alpha),
    foreground[1] * alpha + surface[1] * (1 - alpha),
    foreground[2] * alpha + surface[2] * (1 - alpha),
  ];
}

function channelToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: Srgb): number {
  return (
    0.2126 * channelToLinear(rgb[0]) +
    0.7152 * channelToLinear(rgb[1]) +
    0.0722 * channelToLinear(rgb[2])
  );
}

function contrastRatio(left: number, right: number): number {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}
