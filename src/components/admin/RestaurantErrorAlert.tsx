import { AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RestaurantErrorAlertProps {
    errorMessage: string | null;
    errorDetails: any;
    onResolve: () => void;
    onViewConflict?: () => void;
}

export function RestaurantErrorAlert({
    errorMessage,
    errorDetails,
    onResolve,
    onViewConflict,
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

                    <div className="mt-3 flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onResolve}
                            className="text-xs"
                        >
                            오류 확인 및 수정
                        </Button>
                        {isDuplicate && errorDetails.conflicting_restaurant?.id && (
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
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
