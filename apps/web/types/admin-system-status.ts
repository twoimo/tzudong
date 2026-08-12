export type AdminSystemStatusKeyFlags = {
  supabaseUrl: boolean;
  supabaseServiceRoleKey: boolean;
  geminiServerKey: boolean;
  openaiServerKey: boolean;
  anthropicServerKey: boolean;
  nanoBanana2Key: boolean;
};

export type AdminSystemStatusChecklistSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AdminSystemStatusChecklistCategory =
  | 'environment'
  | 'integration'
  | 'provider-key'
  | 'provider-readiness'
  | 'general';

export type AdminSystemStatusChecklistSource =
  | 'run_daily'
  | 'nightly-regression'
  | 'storyboard-agent'
  | 'bge-embedding'
  | 'provider-key'
  | 'provider-readiness'
  | 'frame-caption-storage';

export type AdminSystemStatusChecklistItem = {
  id: string;
  title: string;
  severity: AdminSystemStatusChecklistSeverity;
  category: AdminSystemStatusChecklistCategory;
  action: string;
  source: AdminSystemStatusChecklistSource;
  command?: string;
  commandSnippet?: string;
};

export type AdminSystemIntegrationStatus = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  endpoint?: string;
  detail?: string;
  checkedAt: string;
};

export type AdminSystemFrameCaptionStatus = {
  configured: boolean;
  localPathConfigured: boolean;
  localPathAvailable: boolean;
  gdrivePathConfigured: boolean;
  reachable: boolean;
  localPath?: string;
  gdrivePath?: string;
  detail?: string;
  checkedAt: string;
};

export type AdminSystemRunDailyRuntime = {
  githubRunId?: string;
  githubRunAttempt?: string;
  githubRunUrl?: string;
  githubWorkflow?: string;
  githubSha?: string;
  githubRef?: string;
  githubEventName?: string;
  executionBranch?: string;
  targetBranch?: string;
};

export type AdminSystemRunDailyStepEvent = {
  name: string;
  status: 'completed' | 'failed' | 'optional_skipped' | 'downstream_skipped';
  durationSeconds?: number;
  reason?: string;
  upstreamStep?: string;
};

export type AdminSystemRunDailyGdriveUploadOperatorMessage = {
  severity?: 'ok' | 'info' | 'warning' | 'error';
  summary?: string;
  action?: string;
};

export type AdminSystemRunDailyGdriveUpload = {
  status?: 'skipped' | 'complete' | 'partial' | 'backfill_required' | 'backfill_complete' | 'failed';
  exitCode?: number;
  expectedCount?: number;
  residualCount?: number;
  pendingBacklogCount?: number;
  terminalIncomplete?: boolean;
  completionProof?: 'none' | 'rclone_exit_zero' | 'remote_size_check' | 'remote_manifest_check';
  operatorMessage?: AdminSystemRunDailyGdriveUploadOperatorMessage;
};

export type AdminSystemRunDailyStatus = {
  scriptPath?: string;
  executable: boolean;
  latestLogPath?: string;
  latestLogUpdatedAt?: string;
  latestManifestPath?: string;
  manifestStatus?: 'available' | 'missing' | 'unreadable';
  finalStatus?: 'OK' | 'WARN' | 'ERROR' | 'UNKNOWN';
  finalExitCode?: number;
  failedRequiredSteps?: string[];
  optionalSkips?: string[];
  downstreamSkips?: string[];
  stepEvents?: AdminSystemRunDailyStepEvent[];
  noWorkShortCircuit?: boolean;
  policyMode?: string;
  runtime?: AdminSystemRunDailyRuntime;
  gdriveUpload?: AdminSystemRunDailyGdriveUpload;
  detail?: string;
  stale: boolean;
  checkedAt: string;
};

export type AdminGithubActionsStatus = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  workflow?: string;
  branch?: string;
  latestRunId?: number;
  latestRunStatus?: string;
  latestRunConclusion?: string | null;
  latestRunEvent?: string;
  latestRunAttempt?: number;
  latestRunUrl?: string;
  latestRunCreatedAt?: string;
  latestRunUpdatedAt?: string;
  detail?: string;
  checkedAt: string;
};

export type AdminNightlyWorkflowRole = 'canonical-local' | 'hosted-manual-fallback';

export type AdminNightlyWorkflowStatus = {
  role: AdminNightlyWorkflowRole;
  workflow: string;
  branch?: string;
  reachable: boolean;
  latestRunId?: number;
  latestRunStatus?: string;
  latestRunConclusion?: string | null;
  latestRunEvent?: string;
  latestRunUrl?: string;
  latestRunCreatedAt?: string;
  latestRunUpdatedAt?: string;
  lastSuccessfulRunId?: number;
  lastSuccessfulRunUrl?: string;
  lastSuccessfulRunCreatedAt?: string;
  consecutiveFailures: number;
  examinedRuns: number;
  historyWindowTruncated: boolean;
  detail?: string;
  checkedAt: string;
};

export type AdminNightlyRegressionStatus = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  repositoryConfigured: boolean;
  tokenConfigured: boolean;
  localCanonical: AdminNightlyWorkflowStatus;
  hostedManualFallback: AdminNightlyWorkflowStatus;
  detail?: string;
  checkedAt: string;
};

export type AdminSupabaseCounterStatus = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  restaurantsTotal?: number;
  evaluatedRestaurants?: number;
  detail?: string;
  checkedAt: string;
};

export type AdminProviderReadinessStatus = 'ready' | 'degraded' | 'unavailable' | 'unknown';

export type AdminProviderReadiness = {
  provider: string;
  status: AdminProviderReadinessStatus;
  reasonCode: string;
  checkedAt: string;
  remediation: string;
  diagnostics: Record<string, string | number | boolean | null>;
};

export type AdminProviderReadinessMap = {
  'naver-directions': AdminProviderReadiness;
  'youtube-thumbnail-durable-release': AdminProviderReadiness;
};

export type AdminSystemStatusResponse = {
  asOf: string;
  keys: AdminSystemStatusKeyFlags;
  storyboardAgent: AdminSystemIntegrationStatus;
  bgeEmbedding: AdminSystemIntegrationStatus;
  frameCaption: AdminSystemFrameCaptionStatus;
  runDaily?: AdminSystemRunDailyStatus;
  githubActions?: AdminGithubActionsStatus;
  nightlyRegression?: AdminNightlyRegressionStatus;
  supabaseCounters?: AdminSupabaseCounterStatus;
  providerReadiness: AdminProviderReadinessMap;
  checklist: AdminSystemStatusChecklistItem[];
};
