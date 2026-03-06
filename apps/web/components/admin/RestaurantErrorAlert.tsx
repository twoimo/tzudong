import { AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openExternalUrl } from '@/lib/open-external-url';

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
}

export function RestaurantErrorAlert({
    errorMessage,
    errorDetails,
    onResolve,
    onViewConflict,
}: RestaurantErrorAlertProps) {
    void onViewConflict;
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

                    <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded border border-yellow-200 dark:border-yellow-800">
                        <p className="text-xs text-yellow-800 dark:text-yellow-200 font-semibold mb-1">
                            ⚠️ 처리 방법
                        </p>
                        <ul className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1 list-disc list-inside">
                            <li><strong>YouTube 링크가 다르면</strong> → 승인 ✅ (같은 맛집, 다른 영상)</li>
                            <li><strong>YouTube 링크가 같으면</strong> → 삭제 ❌ (진짜 중복)</li>
                            <li>승인된 같은 맛집들은 프론트엔드에서 자동으로 병합되어 표시됩니다</li>
                        </ul>
                    </div>

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
                                        // 메인 페이지로 이동하면서 맛집 ID를 쿼리 파라미터로 전달
                                        openExternalUrl(`/?restaurant=${errorDetails.conflicting_restaurant.id}`);
                                    }}
                                    className="text-xs"
                                >
                                    <ExternalLink className="h-3 w-3 mr-1" />
                                    기존 맛집 보기
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
