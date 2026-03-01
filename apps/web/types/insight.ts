export type InsightVisualComponentType = 'heatmap' | 'map' | 'wordcloud' | 'calendar' | 'stats' | 'treemap';

export type InsightHeatmapDataPoint = {
  position: number; // 0-100 (progress %)
  engagement: number; // 0-1 normalized
  views?: number;
};

export type InsightHeatmapSegment = {
  start: number; // 0-100 (progress %)
  end: number; // 0-100 (progress %)
  engagement: number; // 0-1 normalized
};

export type InsightHeatmapVideo = {
  videoId: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  totalViews: number | null;
  duration: string; // HH:MM:SS or MM:SS
  heatmapData: InsightHeatmapDataPoint[];
  peakSegment: InsightHeatmapSegment;
  lowestSegment: InsightHeatmapSegment;
  weeklyChange: number | null;
  analysis: {
    peakReason: string;
    lowestReason: string;
    overallSummary: string;
    keywords: string[];
  };
};

export type AdminInsightHeatmapResponse = {
  asOf: string;
  videos: InsightHeatmapVideo[];
};

export type InsightKeywordTrend = 'up' | 'down' | 'stable';

export type InsightKeywordData = {
  keyword: string;
  count: number;
  trend: InsightKeywordTrend;
  category: string;
};

export type InsightVideoWithKeyword = {
  videoId: string;
  title: string;
  publishedAt: string | null;
  views: number | null;
  thumbnail: string | null;
  youtubeLink: string | null;
  mentionContext: string;
  review?: string | null;
  timestampSec?: number | null;
};

export type AdminInsightWordcloudResponse = {
  asOf: string;
  keywords: InsightKeywordData[];
};

export type AdminInsightWordcloudVideosResponse = {
  asOf: string;
  keyword: string;
  videos: InsightVideoWithKeyword[];
};

export type InsightSeasonalKeyword = {
  keyword: string;
  category: string;
  peakWeek: string;
  lastYearGrowth: number | null;
  predictedGrowth: number | null;
  recommendedUploadDate: string;
  recommendedShootDate: string;
  relatedVideos: string[];
  icon: string;
  peakDays: number[];
};

export type InsightMonthlySeasonData = {
  month: number;
  monthName: string;
  keywords: InsightSeasonalKeyword[];
};

export type AdminInsightSeasonResponse = {
  asOf: string;
  months: InsightMonthlySeasonData[];
};

export type InsightChatSource = {
  videoTitle: string;
  youtubeLink: string;
  timestamp: string;
  text: string;
  assetLink?: string;
  frameLink?: string;
};

export type InsightChatFollowUpPrompt = {
  label?: string;
  prompt: string;
};

export type LlmProvider = 'gemini' | 'openai' | 'anthropic';

export type StoryboardModelProfile = 'nanobanana' | 'nanobanana_pro';

export type LlmModelOption = {
  id: string;
  name: string;
  provider: LlmProvider;
};

export type LlmRequestConfig = {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  useServerKey?: boolean;
  storyboardModelProfile?: StoryboardModelProfile;
  imageModelProfile?: StoryboardModelProfile;
  nanoBanana2Key?: string;
};

export type InsightChatResponseMode = 'fast' | 'deep' | 'structured';

export type InsightChatMemoryMode = 'off' | 'session' | 'pinned';

export type InsightChatAttachmentInput = {
  name: string;
  mimeType?: string;
  content: string;
  sizeBytes?: number;
};

export type InsightChatAttachment = {
  name: string;
  mimeType: string;
  content: string;
  sizeBytes: number;
};

export type InsightChatContextMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type InsightChatFeedbackRating = 'up' | 'down';

export type InsightChatFeedbackContext = {
  targetAssistantMessageId?: string;
  rating: InsightChatFeedbackRating;
  reason?: string;
};

export type AdminInsightChatMeta = {
  source: 'local' | 'agent' | 'gemini' | 'openai' | 'anthropic' | 'fallback';
  citationQuality?: 'none' | 'low' | 'medium' | 'high';
  fallbackReason?: string;
  model?: string;
  requestId?: string;
  responseMode?: InsightChatResponseMode;
  memoryMode?: InsightChatMemoryMode;
  confidence?: number;
  latencyMs?: number;
  systemStatusHints?: string[];
  toolTrace?: string[];
};

export type AdminInsightChatResponse = {
  asOf: string;
  content: string;
  sources?: InsightChatSource[];
  visualComponent?: InsightVisualComponentType;
  followUpPrompts?: (InsightChatFollowUpPrompt | string)[];
  meta?: AdminInsightChatMeta;
};

export type AdminInsightChatBootstrapResponse = {
  asOf: string;
  message: Pick<AdminInsightChatResponse, 'content' | 'sources' | 'visualComponent' | 'followUpPrompts'>;
};

export type AdminInsightSystemStatusKeyFlags = {
  supabaseUrl: boolean;
  supabaseServiceRoleKey: boolean;
  geminiServerKey: boolean;
  openaiServerKey: boolean;
  anthropicServerKey: boolean;
  nanoBanana2Key: boolean;
};

export type AdminInsightSystemStatusChecklistSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AdminInsightSystemStatusChecklistCategory =
  | 'environment'
  | 'integration'
  | 'provider-key'
  | 'general';

export type AdminInsightSystemStatusChecklistSource =
  | 'run_daily'
  | 'storyboard-agent'
  | 'bge-embedding'
  | 'provider-key'
  | 'frame-caption-storage';

export type AdminInsightSystemStatusChecklistItem = {
  id: string;
  title: string;
  severity: AdminInsightSystemStatusChecklistSeverity;
  category: AdminInsightSystemStatusChecklistCategory;
  action: string;
  source: AdminInsightSystemStatusChecklistSource;
  command?: string;
  commandSnippet?: string;
};

export type AdminInsightSystemIntegrationStatus = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  endpoint?: string;
  detail?: string;
  checkedAt: string;
};

export type AdminInsightSystemFrameCaptionStatus = {
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

export type AdminInsightSystemRunDailyStatus = {
  scriptPath?: string;
  executable: boolean;
  latestLogPath?: string;
  latestLogUpdatedAt?: string;
  stale: boolean;
  checkedAt: string;
};

export type AdminInsightSystemStatusResponse = {
  asOf: string;
  keys: AdminInsightSystemStatusKeyFlags;
  storyboardAgent: AdminInsightSystemIntegrationStatus;
  bgeEmbedding: AdminInsightSystemIntegrationStatus;
  frameCaption: AdminInsightSystemFrameCaptionStatus;
  runDaily?: AdminInsightSystemRunDailyStatus;
  checklist: AdminInsightSystemStatusChecklistItem[];
};

export type InsightChatGuardrailRouteName = 'chat' | 'stream';

export type InsightChatGuardrailRouteMetricTotals = Record<string, number>;

export type InsightChatGuardrailRouteMetrics = {
  latency_budget_exceeded: number;
  reliability_fallback_streak_alerts: Record<string, number>;
  total_requests?: number;
  success_responses?: number;
  fallback_responses?: number;
  stream_responses?: number;
  error_responses?: number;
  citation_quality_counts?: InsightChatGuardrailRouteMetricTotals;
  provider_request_counts?: InsightChatGuardrailRouteMetricTotals;
  source_counts?: InsightChatGuardrailRouteMetricTotals;
  fallback_totals?: InsightChatGuardrailRouteMetricTotals;
  response_mode_counts?: InsightChatGuardrailRouteMetricTotals;
  memory_mode_counts?: InsightChatGuardrailRouteMetricTotals;
  feedback_rating_counts?: InsightChatGuardrailRouteMetricTotals;
  feedback_has_reason_counts?: InsightChatGuardrailRouteMetricTotals;
  feedback_reason_category_counts?: InsightChatGuardrailRouteMetricTotals;
};

export type InsightChatGuardrailConfig = {
  enabled: boolean;
  latencyBudgetMs: number;
  fallbackStreakThreshold: number;
  fallbackWindowMs: number;
  fallbackAlertCooldownMs: number;
};

export type AdminInsightChatGuardrailMetricsResponse = {
  timestamp: string;
  routes: Record<InsightChatGuardrailRouteName, InsightChatGuardrailRouteMetrics>;
  guardrailConfig: InsightChatGuardrailConfig;
};

export type AdminInsightChatGuardrailMetricsResetResponse = {
  success: boolean;
  message: string;
};

