export type StoryboardTone = 'warm' | 'energetic' | 'documentary' | 'comfort';

export type StoryboardGenerateRequest = {
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  sourceLimit: number;
  segmentCount: number;
  includeProductionNotes: boolean;
};

export type StoryboardHeatmapMarker = {
  startMillis: number;
  endMillis: number;
  peakMillis: number;
  label: string;
  peakTime: string;
  replayScore: number;
};

export type StoryboardHeatmapSource = {
  videoId: string;
  youtubeLink: string;
  durationSeconds: number | null;
  collectedAt: string | null;
  replayPeakScore: number;
  markers: StoryboardHeatmapMarker[];
};

export type StoryboardScene = {
  sceneNo: number;
  title: string;
  durationSec: number;
  operatorIntent: string;
  visualDirection: string;
  hostBeat: string;
  captionIdea: string;
  heatmapEvidence: {
    videoId: string;
    youtubeLink: string;
    peakTime: string;
    replayScore: number;
    reason: string;
  };
  productionChecklist: string[];
};

export type StoryboardAhpCriterion = {
  id: string;
  label: string;
  weight: number;
  score: number;
  evidence: string;
};

export type StoryboardAhpReport = {
  targetScore: number;
  score: number;
  status: 'passed' | 'needs_iteration';
  committee: Array<{ role: string; focus: string }>;
  criteria: StoryboardAhpCriterion[];
  iterationBacklog: string[];
};

export type StoryboardGenerationResult = {
  generatedAt: string;
  mode: 'local_heatmap_fixture';
  request: StoryboardGenerateRequest;
  sourceSummary: {
    heatmapDirectory: string;
    scannedFiles: number;
    usableSources: number;
    selectedSources: number;
    totalMarkers: number;
    topReplayScore: number;
  };
  storyboard: {
    title: string;
    logline: string;
    operatorBrief: string;
    scenes: StoryboardScene[];
    exportMarkdown: string;
  };
  ahp: StoryboardAhpReport;
  backendAnalysis: {
    reusedLogic: string[];
    localGapsHandled: string[];
  };
};
