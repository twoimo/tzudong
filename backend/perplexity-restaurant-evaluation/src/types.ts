export interface RestaurantEvaluation {
  restaurant_name: string;
  evaluation_score: number; // 1-10 점수
  evaluation_reason: string;
  evaluation_date: string;
  evaluator: string;
}

export interface EvaluationData {
  youtube_link: string;
  evaluations: RestaurantEvaluation[];
}

export interface ProcessingResult {
  success: boolean;
  data?: RestaurantEvaluation[];
  error?: string;
  youtubeLink: string;
}