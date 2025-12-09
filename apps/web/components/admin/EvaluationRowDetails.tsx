import { EvaluationRecord } from '@/types/evaluation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle } from 'lucide-react';
import { RestaurantErrorAlert } from './RestaurantErrorAlert';
import { EvaluationDetailView } from './EvaluationDetailView';

interface EvaluationRowDetailsProps {
  record: EvaluationRecord;
  onEdit?: () => void;
}

export function EvaluationRowDetails({ record, onEdit }: EvaluationRowDetailsProps) {
  const { youtube_meta, evaluation_results, restaurant_info, missing_message } = record;

  // 디버깅: 데이터 구조 확인
  // console.log('📊 EvaluationRowDetails 데이터:', { ... });

  // 🔥 중복 에러 알림 표시
  const showErrorAlert = record.db_error_message && record.db_error_details;

  // Missing 음식점인 경우
  if ((record.status === 'missing' || record.is_missing)) {
    return (
      <div className="p-4 space-y-4">
        {showErrorAlert && (
          <RestaurantErrorAlert
            errorMessage={record.db_error_message || null}
            errorDetails={record.db_error_details || null}
            onResolve={() => {
              if (onEdit) {
                onEdit();
              }
            }}
          />
        )}
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle className="text-yellow-600 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Missing 음식점: {record.restaurant_name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p><strong>메시지:</strong> {missing_message}</p>
              <p><strong>영상 제목:</strong> {youtube_meta?.title}</p>
              <p><strong>YouTube 링크:</strong>
                <a href={record.youtube_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-2">
                  {record.youtube_link}
                </a>
              </p>
              <p className="text-sm text-muted-foreground">
                이 음식점은 evaluation_target에는 있지만 restaurants 배열에서 누락되었습니다.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 평가 미대상인 경우
  if (record.status === 'not_selected') {
    return (
      <div className="p-4">
        <Card className="border-gray-400">
          <CardHeader>
            <CardTitle className="text-gray-600 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              평가 미대상: {record.restaurant_name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p><strong>사유:</strong> {record.geocoding_fail_reason || '주소 정보 없음'}</p>
              <p><strong>영상 제목:</strong> {youtube_meta?.title}</p>
              <p><strong>YouTube 링크:</strong>
                <a href={record.youtube_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-2">
                  {record.youtube_link}
                </a>
              </p>
              {restaurant_info && (
                <>
                  <p><strong>음식점명:</strong> {restaurant_info.name}</p>
                  <p><strong>카테고리:</strong> {restaurant_info.category || '-'}</p>
                  <p><strong>전화번호:</strong> {restaurant_info.phone || '-'}</p>
                  {restaurant_info.tzuyang_review && (
                    <p><strong>쯔양 리뷰:</strong> {restaurant_info.tzuyang_review}</p>
                  )}
                </>
              )}
              <p className="text-sm text-muted-foreground">
                이 음식점은 주소 정보가 없어 평가 대상에서 제외되었습니다.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 오류인 경우 (기존 DB 충돌)
  if (record.status === 'db_conflict' && record.db_conflict_info) {
    const { existing_restaurant, new_restaurant } = record.db_conflict_info;

    // 오류 케이스 판별
    const isSameName = existing_restaurant.name === new_restaurant.name;
    const isSameGeocodingAddress = existing_restaurant.jibun_address === new_restaurant.naver_address_info?.jibun_address;
    const isDuplicateCase = isSameName && isSameGeocodingAddress; // 케이스 1: 중복
    const isAddressIssueCase = isSameName && !isSameGeocodingAddress; // 케이스 2: 주소 문제

    return (
      <div className="p-4">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-600 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              데이터베이스 등록 오류
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              {isDuplicateCase && (
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <p className="text-red-800 font-semibold">🔄 중복 데이터</p>
                  <p className="text-sm text-red-700">영상 URL, 음식점명, 지오코딩 주소가 모두 같습니다.</p>
                </div>
              )}
              {isAddressIssueCase && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded">
                  <p className="text-orange-800 font-semibold">📍 주소 정보 문제</p>
                  <p className="text-sm text-orange-700">영상 URL과 음식점명은 같지만 지오코딩 주소가 다릅니다.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border p-4 rounded">
                <h4 className="font-bold mb-2">🏢 기존 데이터베이스</h4>
                <dl className="space-y-1 text-sm">
                  <div><dt className="inline font-semibold">음식점명:</dt> <dd className="inline">{existing_restaurant.name}</dd></div>
                  <div><dt className="inline font-semibold">지번주소:</dt> <dd className="inline">{existing_restaurant.jibun_address}</dd></div>
                  <div><dt className="inline font-semibold">전화번호:</dt> <dd className="inline">{existing_restaurant.phone || '-'}</dd></div>
                  <div><dt className="inline font-semibold">카테고리:</dt> <dd className="inline">{existing_restaurant.category.join(', ')}</dd></div>
                  <div><dt className="inline font-semibold">YouTube 링크:</dt> <dd className="inline">{existing_restaurant.youtube_links.length}개</dd></div>
                </dl>
              </div>

              <div className="border p-4 rounded bg-yellow-50">
                <h4 className="font-bold mb-2">🆕 신규 데이터</h4>
                <dl className="space-y-1 text-sm">
                  <div><dt className="inline font-semibold">음식점명:</dt> <dd className="inline">{new_restaurant.name}</dd></div>
                  <div><dt className="inline font-semibold">지번주소:</dt> <dd className="inline">{new_restaurant.naver_address_info?.jibun_address}</dd></div>
                  <div><dt className="inline font-semibold">전화번호:</dt> <dd className="inline">{new_restaurant.phone || '-'}</dd></div>
                  <div><dt className="inline font-semibold">카테고리:</dt> <dd className="inline">{new_restaurant.category}</dd></div>
                </dl>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 정상 음식점인 경우 (또는 승인, 보류 등) - Unified Slide View Layout 사용
  // [레이아웃] 통합 상세 뷰(Unified Detail View) 사용
  // 일반적인 테이블 행 확장 UI와 달리, 여기서는 슬라이드 형태처럼 보이도록 고정 높이 컨테이너로 감쌉니다.

  return (
    <div className="flex flex-col border-t bg-gray-50/50">
      {/* 🔥 에러 알림 - 최상단 표시 (if present along with normal record) */}
      {showErrorAlert && (
        <div className="p-4 bg-background">
          <RestaurantErrorAlert
            errorMessage={record.db_error_message || null}
            errorDetails={record.db_error_details || null}
            onResolve={() => {
              if (onEdit) onEdit();
            }}
          />
        </div>
      )}

      {/* Unified Detail View */}
      <EvaluationDetailView record={record} className="flex-1" autoHeight={true} />
    </div>
  );
}

