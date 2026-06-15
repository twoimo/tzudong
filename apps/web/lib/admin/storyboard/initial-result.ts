import type { StoryboardGenerationResult } from "./types";

export type StoryboardInitialResultSource = "latest-history" | "shared-seed";

export type StoryboardInitialResult = {
  result: StoryboardGenerationResult;
  source: StoryboardInitialResultSource;
  runUrl: string;
};
