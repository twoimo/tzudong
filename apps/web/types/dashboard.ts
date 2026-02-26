export interface DashboardTotals {
    restaurants: number;
    videos: number;
    categories: number;
    withCoordinates: number;
}

export interface DashboardCategoryStat {
    name: string;
    count: number;
}

export interface DashboardVideoSummary {
    videoId: string;
    youtubeLink: string | null;
    title: string;
    publishedAt: string | null;
    restaurantCount: number;
    notSelectedCount: number;
    geocodingFailedCount: number;
    updatedAt: string | null;
}

export interface DashboardSummaryResponse {
    asOf: string;
    totals: DashboardTotals;
    topCategories: DashboardCategoryStat[];
    videos: DashboardVideoSummary[];
}

export interface DashboardRestaurantItem {
    id: string;
    name: string;
    category: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    youtubeLink: string | null;
    videoId: string | null;
    sourceType: string | null;
    status: string | null;
    geocodingSuccess: boolean;
    isNotSelected: boolean;
    updatedAt: string | null;
    createdAt: string | null;
}

export interface DashboardRestaurantsResponse {
    asOf: string;
    total: number;
    limit: number;
    offset: number;
    filters: {
        q?: string;
        category?: string;
        sourceType?: string;
        status?: string;
        onlyWithCoordinates: boolean;
    };
    items: DashboardRestaurantItem[];
}

export interface DashboardFunnelResponse {
    asOf: string;
    source: string;
    counts: {
        crawling: number;
        selection: number;
        notSelection: number;
        selectionUnion: number;
        selectionOverlap: number;
        rule: number;
        laaj: number;
    };
    conversion: {
        selectionRate: number | null;
        ruleRate: number | null;
        laajRate: number | null;
    };
}

export interface DashboardFailureBucket {
    label: string;
    count: number;
}

export interface DashboardFailuresResponse {
    asOf: string;
    source: string;
    notSelectionReasons: DashboardFailureBucket[];
    ruleFalseMessages: DashboardFailureBucket[];
    laajGaps: {
        count: number;
        videoIds: string[];
    };
}

export interface DashboardQualityResponse {
    asOf: string;
    source: string;
    totals: {
        pipelineRows: number;
        withRuleMetrics: number;
        withLaajMetrics: number;
    };
    locationMatch: {
        trueCount: number;
        falseCount: number;
        missingCount: number;
    };
    categoryValidity: {
        trueCount: number;
        falseCount: number;
        missingCount: number;
    };
    categoryTF: {
        trueCount: number;
        falseCount: number;
        missingCount: number;
    };
    reviewFaithfulness: {
        count: number;
        average: number | null;
        median: number | null;
        min: number | null;
        max: number | null;
    };
}

export interface DashboardVideoDetailResponse {
    asOf: string;
    video: {
        videoId: string;
        youtubeLink: string | null;
        title: string;
        publishedAt: string | null;
        restaurantCount: number;
    };
    restaurants: DashboardRestaurantItem[];
}
