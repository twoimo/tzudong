export interface RestaurantInfo {
  name: string | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  youtube_link: string;
  reasoning_basis: string;
}

export interface RestaurantData {
  youtube_link: string;
  restaurants: RestaurantInfo[];
}

export interface ProcessingResult {
  success: boolean;
  data?: RestaurantInfo[];
  error?: string;
  youtubeLink: string;
}
