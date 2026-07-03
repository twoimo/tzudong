import type { HomeMapThemeFilterId } from '@/lib/home-map-theme-filters';

export interface FilterState {
    categories: string[];
    minRating: number;
    minReviews: number;
    minUserVisits: number;
    minJjyangVisits: number;
    featuredTheme?: HomeMapThemeFilterId | null;
}
