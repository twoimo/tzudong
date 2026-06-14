export type StoryboardTone = 'warm' | 'energetic' | 'documentary' | 'comfort';
export type StoryboardGenerationMode = 'local_heatmap' | 'backend_agent';
export const STORYBOARD_MIN_SEGMENT_COUNT = 5;
export const STORYBOARD_CHAT_MIN_SEGMENT_COUNT = 4;
export const STORYBOARD_MAX_SEGMENT_COUNT = 12;
export const STORYBOARD_IMAGE_GENERATION_BATCH_SIZE = 4;
export type StoryboardBackendRuntime =
  | 'langgraph'
  | 'codex_cli_oauth_legacy'
  | 'local_adapter_fallback';
export type StoryboardGraphFallbackReason =
  | 'not_configured'
  | 'dependency_missing'
  | 'unsupported_runtime'
  | 'graph_timeout'
  | 'graph_invalid_output'
  | 'graph_execution_failed'
  | 'credential_missing'
  | 'retrieval_dependency_missing'
  | 'retrieval_rpc_unavailable';
export type StoryboardGraphStatus =
  | 'used'
  | 'interrupted_output_ready'
  | 'interrupted_needs_resume'
  | 'fallback'
  | 'legacy';
export type StoryboardGraphDiagnostics = {
  status: StoryboardGraphStatus;
  runtime: StoryboardBackendRuntime;
  mode: 'graph_command' | 'legacy_command' | 'local_adapter';
  threadId?: string;
  checkpointer?: 'MemorySaver' | string;
  checkpointerScope?: 'per_process_only' | 'durable_cross_process';
  graphEntrypoint?: string;
  nodesVisited: string[];
  interrupts: Array<{
    node: string;
    resumable: boolean;
    outputReady: boolean;
    summary: string;
  }>;
  toolsCalled: string[];
  retrieval?: {
    status: 'not_used' | 'used' | 'failed';
    usedModels?: {
      embedding?: 'BAAI/bge-m3';
      reranker?: 'BAAI/bge-reranker-v2-m3';
    };
    operations?: {
      supabaseRpc?: 'match_documents_hybrid';
      mmrApplied?: boolean;
      captionLookup?: 'get_video_captions_for_range';
    };
    caption?: {
      lookupStatus?: 'used' | 'unavailable' | 'not_reported';
      provider?: 'llava_next_video' | 'openai_vision_gpt55' | 'codex_cli_vision_gpt55' | 'unknown_legacy';
      model?: string;
      authMode?: 'platform_api_key' | 'codex_cli_oauth_local' | 'offline_local' | 'unknown_legacy';
      schemaVersion?: number;
      frameCount?: number;
      truncatedFrames?: number;
      requestHash?: string;
      parserStatus?: string;
      latencyMs?: number;
      responseId?: string;
      fallbackReason?: string;
    };
  };
  fallbackReason?: StoryboardGraphFallbackReason;
  fallbackDetail?: string;
};
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
  runtime?: StoryboardBackendRuntime;
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

export type StoryboardTopicProfileId =
  | 'spicy_street_food'
  | 'dessert_cafe'
  | 'seafood'
  | 'convenience_food'
  | 'korean_bbq'
  | 'noodle_soup'
  | 'generic_mukbang';

export type StoryboardArcRole =
  | 'intro_hook'
  | 'menu_context'
  | 'prep_sensory'
  | 'table_reveal'
  | 'first_bite'
  | 'texture_asmr'
  | 'combo_variation'
  | 'pace_break'
  | 'climax_hero'
  | 'near_finish'
  | 'final_review'
  | 'outro_next';

export type StoryboardSourceEvidenceLabel =
  | '로컬 히트맵 근거'
  | '데모/샘플 근거'
  | '백엔드 에이전트 근거';

export type StoryboardImageStatusLabel =
  | '이미지 검증 전'
  | '검증 이미지 일부 있음'
  | '검증 이미지 완료';

export type StoryboardPlannerOutput = {
  topicProfile: {
    id: StoryboardTopicProfileId;
    label: string;
    keywords: string[];
    visualMotifs: string[];
    audioMotifs: string[];
    subtitleMotifs: string[];
    sensoryWords: string[];
  };
  arcPlan: {
    cutCount: number;
    roles: StoryboardArcRole[];
    compressionRule: string;
    requiredRoleCoverage: {
      hasIntro: boolean;
      hasContext: boolean;
      hasFirstBiteOrSensory: boolean;
      hasClimax: boolean;
      hasFinalReviewOrOutro: boolean;
    };
  };
  sourceTrace: {
    dataModeLabel: string;
    isFallbackData: boolean;
    evidenceLabel: StoryboardSourceEvidenceLabel;
    imageStatusLabel: StoryboardImageStatusLabel;
  };
  sceneDrafts: Array<{
    sceneNo: number;
    role: StoryboardArcRole;
    topicKeywords: string[];
    title: string;
    operatorIntent: string;
    visualDirection: string;
    hostBeat: string;
    captionStem: string;
  }>;
};

export type StoryboardSceneGeneratedImage = {
  dataUrl: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  providerId: 'local-codex' | 'browser-openai-api-key';
  trustPolicy: 'storyboard-gpt-image-2-panel-v1';
  model: string;
  prompt: string;
  generatedAt: string;
  warnings: string[];
  provenance?: StoryboardGeneratedImageProvenance;
};

export type StoryboardGeneratedImageProvenance = {
  providerId: 'local-codex' | 'browser-openai-api-key';
  authMode: 'codex_oauth' | 'browser_local_storage_api_key';
  endpoint:
    | 'https://chatgpt.com/backend-api/codex/responses'
    | 'https://api.openai.com/v1/images/generations';
  agentModel?: string;
  requestToolType: 'image_generation';
  requestToolModel: 'gpt-image-2';
  model: 'gpt-image-2';
  modelProvenance: 'exact';
  responseId: string;
  imageCallId: string;
  imageItemCount: number;
  generatedImageItemTypes?: string[];
  rawImageItemTypes: string[];
  requestHash: string;
  responseHash: string;
  hasOpenAIAPIKey: boolean;
  generatedAt: string;
};


export type StoryboardAgentGraphEvidenceState = 'supported' | 'adapter' | 'missing' | 'blocked';
export type StoryboardAgentGraphRoleId = 'supervisor' | 'researcher' | 'intern' | 'designer';

export type StoryboardAgentGraphFidelityCriterion = {
  id: string;
  label: string;
  weight: number;
  score: number;
  evidence: string;
};

export type StoryboardAgentGraphFidelityRole = {
  id: StoryboardAgentGraphRoleId;
  label: string;
  evidenceState: StoryboardAgentGraphEvidenceState;
  score: number;
  evidence: string;
};

export type StoryboardAgentGraphFidelityReport = {
  targetScore: number;
  score: number;
  status: 'passed' | 'needs_iteration';
  evidenceMode: 'canonical_reference_graph' | 'backend_diagnostics_partial' | 'local_adapter_gap' | 'fallback_gap';
  committee: Array<{ role: string; focus: string }>;
  roles: StoryboardAgentGraphFidelityRole[];
  criteria: StoryboardAgentGraphFidelityCriterion[];
  blockers: string[];
  nextActions: string[];
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
  agentGraphFidelity?: StoryboardAgentGraphFidelityReport;
  planner?: StoryboardPlannerOutput;
  backendAnalysis: {
    reusedLogic: string[];
    localGapsHandled: string[];
    backendAgent?: StoryboardBackendAgentStatus & {
      invokedCommand: boolean;
      commandExitCode?: number | null;
      commandTimedOut?: boolean;
      rawOutputPreview?: string;
      graph?: StoryboardGraphDiagnostics;
      referenceGraph?: unknown;
    };
  };
};
