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
  apiKey: string;
  storyboardModelProfile?: StoryboardModelProfile;
  imageModelProfile?: StoryboardModelProfile;
};

export type AdminInsightChatMeta = {
  source: 'local' | 'agent' | 'gemini' | 'openai' | 'anthropic' | 'fallback';
  fallbackReason?: string;
  model?: string;
};

export type AdminInsightChatResponse = {
  asOf: string;
  content: string;
  sources?: InsightChatSource[];
  visualComponent?: InsightVisualComponentType;
  meta?: AdminInsightChatMeta;
};

export type AdminInsightChatBootstrapResponse = {
  asOf: string;
  message: Pick<AdminInsightChatResponse, 'content' | 'sources' | 'visualComponent'>;
};

