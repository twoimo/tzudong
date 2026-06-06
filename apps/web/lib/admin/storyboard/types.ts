export type StoryboardTone = 'warm' | 'energetic' | 'documentary' | 'comfort';
export type StoryboardGenerationMode = 'local_heatmap' | 'backend_agent';
export type StoryboardDataMode =
  | 'local_heatmap_fixture'
  | 'local_demo_fallback'
  | 'backend_agent_local_adapter'
  | 'backend_agent_command';
export type StoryboardFallbackReason = 'missing-heatmap-directory' | 'no-usable-heatmap-sources';

export type StoryboardGenerateRequest = {
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  sourceLimit: number;
  segmentCount: number;
  includeProductionNotes: boolean;
  generationMode: StoryboardGenerationMode;
};

export type StoryboardBackendAgentStatus = {
  available: boolean;
  mode: 'local_adapter' | 'command';
  rootPath: string;
  notebooks: string[];
  graphEntrypoint: string | null;
  commandConfigured: boolean;
  commandAvailable: boolean;
  commandPath?: string;
  commandRejectionReason?: string;
  localAdapterAvailable: boolean;
  missingPythonModules: string[];
  runtime?: string;
  codexModel?: string;
  codexEffort?: string;
  streamingAvailable?: boolean;
};

export type StoryboardChatCanvasPatch = {
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  segmentCount: number;
  generationMode: StoryboardGenerationMode;
  focusSceneNo?: number;
  unavailableFocusSceneNo?: number;
  scenePatch?: StoryboardChatScenePatch;
};

export type StoryboardChatScenePatch = {
  sceneNo: number;
  targetSource?: 'explicit' | 'selected';
  title?: string;
  operatorIntent?: string;
  visualDirection?: string;
  hostBeat?: string;
  captionIdea?: string;
  productionChecklist?: string[];
  regenerateImage?: boolean;
};

export type StoryboardChatFocusContext = {
  kind: 'cut' | 'action';
  label: string;
  detail: string;
  sceneNo?: number;
  promptContext: string;
  createdAt: string;
};

export type StoryboardChatAgentRequest = {
  message: string;
  currentPrompt?: string;
  baselinePrompt?: string;
  currentTone?: StoryboardTone;
  currentTargetLengthMinutes?: number;
  currentSegmentCount?: number;
  currentAvailableSceneCount?: number;
  generationMode?: StoryboardGenerationMode;
  focusContext?: StoryboardChatFocusContext | null;
};

export type StoryboardChatAgentResult = {
  assistantMessage: string;
  canvasPatch: StoryboardChatCanvasPatch;
  shouldGenerate: boolean;
  shouldReset: boolean;
  backendAgent: {
    mode: 'local_adapter' | 'command';
    runtime: string;
    concept: string;
    layoutBrief: string;
    promptAddendum: string;
    safetyReview: string;
    nextActions: string[];
    diagnostics: Record<string, unknown>;
  };
  diagnostics: {
    runtime: string;
    model: string;
    effort: string;
    streaming: 'sse-progress';
  };
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
  generatedImage?: StoryboardSceneGeneratedImage;
};

export type StoryboardSceneGeneratedImage = {
  dataUrl: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  providerId: 'local-codex';
  trustPolicy: 'storyboard-gpt-image-2-panel-v1';
  model: string;
  prompt: string;
  generatedAt: string;
  warnings: string[];
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
  mode: StoryboardDataMode;
  request: StoryboardGenerateRequest;
  sourceSummary: {
    heatmapDirectory: string;
    scannedFiles: number;
    usableSources: number;
    selectedSources: number;
    totalMarkers: number;
    topReplayScore: number;
    isFallbackData: boolean;
    fallbackReason: StoryboardFallbackReason | null;
    dataModeLabel: string;
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
    backendAgent?: StoryboardBackendAgentStatus & {
      invokedCommand: boolean;
      commandExitCode?: number | null;
      commandTimedOut?: boolean;
      rawOutputPreview?: string;
    };
  };
};
