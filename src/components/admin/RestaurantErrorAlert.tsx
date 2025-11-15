import { AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DuplicateErrorDetails {
    error_type: 'duplicate';
    conflicting_restaurant: {
        id: string;
        name: string;
        jibun_address: string;
        road_address?: string;
    };
    similarity_score: number;
    detected_at: string;
}

interface RestaurantErrorAlertProps {
    errorMessage: string | null;
    errorDetails: DuplicateErrorDetails | null;
    onResolve: () => void;
    onViewConflict?: () => void;
    onMergeData?: (targetRestaurantId: string, sourceData: { youtube_links: string[]; youtube_metas: any[]; tzuyang_reviews: any[] }) => void;
    currentRecord?: { youtube_links?: string[] | null; youtube_metas?: any[] | null; tzuyang_reviews?: any[] | null };
}

export function RestaurantErrorAlert({
    errorMessage,
    errorDetails,
    onResolve,
    onViewConflict,
    onMergeData,
    currentRecord,
}: RestaurantErrorAlertProps) {
    if (!errorMessage) return null;

    const isDuplicate = errorDetails?.error_type === 'duplicate';

    return (
        <div className="mb-4 p-4 border-2 border-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg">
            <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                    <h4 className="font-semibold text-red-600 mb-2">중복 오류</h4>
                    <p className="text-sm text-red-600 mb-3">{errorMessage}</p>

                    {isDuplicate && errorDetails.conflicting_restaurant && (
                        <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded border">
                            <p className="text-xs text-muted-foreground mb-2">기존 등록된 맛집:</p>
                            <div className="space-y-1">
                                <p className="text-sm font-medium">
                                    {errorDetails.conflicting_restaurant.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {errorDetails.conflicting_restaurant.jibun_address}
                                </p>
                                {errorDetails.conflicting_restaurant.road_address && (
                                    <p className="text-xs text-muted-foreground">
                                        {errorDetails.conflicting_restaurant.road_address}
                                    </p>
                                )}
                                <p className="text-xs font-medium text-orange-600">
                                    유사도: {(errorDetails.similarity_score * 100).toFixed(0)}%
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onResolve}
                            className="text-xs"
                        >
                            오류 확인 및 수정
                        </Button>
                        {isDuplicate && errorDetails.conflicting_restaurant?.id && (
                            <>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        // 기존 맛집으로 이동
                                        window.open(`/restaurant/${errorDetails.conflicting_restaurant.id}`, '_blank');
                                    }}
                                    className="text-xs"
                                >
                                    <ExternalLink className="h-3 w-3 mr-1" />
                                    기존 맛집 보기
                                </Button>
                                {onMergeData && currentRecord && (
                                    <Button
                                        size="sm"
                                        variant="default"
                                        onClick={() => {
                                            onMergeData(
                                                errorDetails.conflicting_restaurant.id,
                                                {
                                                    youtube_links: currentRecord.youtube_links || [],
                                                    youtube_metas: currentRecord.youtube_metas || [],
                                                    tzuyang_reviews: currentRecord.tzuyang_reviews || [],
                                                }
                                            );
                                        }}
                                        className="text-xs bg-blue-600 hover:bg-blue-700"
                                    >
                                        기존 맛집에 데이터 추가
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
