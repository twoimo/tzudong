import {
  getSeriesToneAssignment,
  type ConsoleSeriesToneSlot,
} from "@/lib/admin/console-tone-scale";

export type ConsoleSeriesPaint = {
  readonly step: ConsoleSeriesToneSlot["step"];
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: 1;
};

export function paintConsoleSeries(
  seriesCount: number,
  tones: readonly string[],
  resolved: boolean,
): {
  readonly paints: readonly ConsoleSeriesPaint[];
  readonly requiresNonToneChannel: boolean;
} {
  const assignment = getSeriesToneAssignment(seriesCount);
  return {
    requiresNonToneChannel: assignment.requiresNonToneChannel,
    paints: assignment.assignments.map((slot) => {
      const fillIndex = slot.step - 1;
      const strokeStep = Number(
        slot.strokeVariable.replace("--admin-tone-", ""),
      );
      const strokeIndex = strokeStep - 1;
      return {
        step: slot.step,
        fill:
          resolved && tones[fillIndex]
            ? tones[fillIndex]
            : `var(${slot.fillVariable})`,
        stroke:
          resolved && tones[strokeIndex]
            ? tones[strokeIndex]
            : `var(${slot.strokeVariable})`,
        strokeWidth: slot.strokeWidthPx,
      };
    }),
  };
}
