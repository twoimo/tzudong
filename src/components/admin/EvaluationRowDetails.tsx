import { EvaluationRecord } from '@/types/evaluation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, AlertCircle } from 'lucide-react';
import { RestaurantErrorAlert } from './RestaurantErrorAlert';

interface EvaluationRowDetailsProps {
  record: EvaluationRecord;
  onEdit?: () => void;
  onMergeData?: (targetRestaurantId: string, sourceData: { youtube_links: string[]; youtube_metas: any[]; tzuyang_reviews: any[] }) => void;
}

export function EvaluationRowDetails({ record, onEdit, onMergeData }: EvaluationRowDetailsProps) {
  const { youtube_meta, evaluation_results, restaurant_info, missing_message } = record;

  // 디버깅: 데이터 구조 확인
  console.log('📊 EvaluationRowDetails 데이터:', {
    record_id: record.id,
    status: record.status,
    evaluation_results: evaluation_results,
    evaluation_results_type: typeof evaluation_results,
    evaluation_results_keys: evaluation_results ? Object.keys(evaluation_results) : 'null',
    restaurant_info: restaurant_info,
    youtube_meta: youtube_meta,
    has_evaluation_results: !!evaluation_results,
    has_restaurant_info: !!restaurant_info,
    evaluation_results_is_empty: evaluation_results && typeof evaluation_results === 'object' && Object.keys(evaluation_results).length === 0,
    db_error_message: record.db_error_message,
    db_error_details: record.db_error_details,
  });

  // 🔥 중복 에러 알림 표시
  const showErrorAlert = record.db_error_message && record.db_error_details;

  // Missing 음식점인 경우
  if (record.status === 'missing') {
    return (
      <>
        {showErrorAlert && (
          <div className="p-4 bg-gray-50 dark:bg-gray-900">
            <RestaurantErrorAlert
              errorMessage={record.db_error_message || null}
              errorDetails={record.db_error_details || null}
              onResolve={() => {
                if (onEdit) {
                  onEdit();
                }
              }}
              onMergeData={onMergeData}
              currentRecord={{
                youtube_links: record.youtube_links,
                youtube_metas: record.youtube_metas,
                tzuyang_reviews: record.tzuyang_reviews,
              }}
            />
          </div>
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
      </>
    );
  }

  // Missing 음식점인 경우
  if (record.is_missing || (record.status as string) === 'missing') {
    return (
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
    );
  }

  // 평가 미대상인 경우
  if (record.status === 'not_selected') {
    return (
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
    );
  }

  // 정상 음식점인 경우 - evaluation_results가 없어도 기본 정보 표시
  const hasEvaluationData = evaluation_results && typeof evaluation_results === 'object' && Object.keys(evaluation_results).length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* 🔥 에러 알림 - 최상단 표시 */}
      {showErrorAlert && (
        <RestaurantErrorAlert
          errorMessage={record.db_error_message || null}
          errorDetails={record.db_error_details || null}
          onResolve={() => {
            if (onEdit) {
              onEdit();
            }
          }}
          onMergeData={onMergeData}
          currentRecord={{
            youtube_links: record.youtube_links,
            youtube_metas: record.youtube_metas,
            tzuyang_reviews: record.tzuyang_reviews,
          }}
        />
      )}

      {/* 영상 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">📹 영상 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p><strong>제목:</strong> {youtube_meta?.title}</p>
          <p><strong>게시일:</strong> {new Date(youtube_meta?.publishedAt || '').toLocaleDateString('ko-KR')}</p>
          <p><strong>광고 여부:</strong> {youtube_meta?.ads_info?.is_ads ? '광고 있음' : '광고 없음'}</p>
          <p><strong>링크:</strong>
            <a href={record.youtube_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-2">
              {record.youtube_link}
            </a>
          </p>
        </CardContent>
      </Card>

      {/* 평가 상세 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            📊 평가 상세
            {!hasEvaluationData && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (평가 데이터 없음)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasEvaluationData && (
            <div className="text-sm text-muted-foreground bg-muted p-3 rounded">
              평가 데이터가 아직 생성되지 않았습니다.
              <br />
              <code className="text-xs">
                evaluation_results: {evaluation_results ? JSON.stringify(evaluation_results) : 'null'}
              </code>
            </div>
          )}
          {/* 1. 방문 여부 정확성 */}
          {evaluation_results?.visit_authenticity && (
            <div className="border-l-4 border-blue-500 pl-4">
              <h4 className="font-semibold mb-1">
                1️⃣ 방문 여부 정확성: {evaluation_results.visit_authenticity.eval_value}점
              </h4>
              <p className="text-sm text-muted-foreground">
                {evaluation_results.visit_authenticity.eval_basis}
              </p>
            </div>
          )}
          {!evaluation_results?.visit_authenticity && hasEvaluationData && (
            <div className="border-l-4 border-gray-300 pl-4">
              <h4 className="font-semibold mb-1 text-muted-foreground">
                1️⃣ 방문 여부 정확성: 데이터 없음
              </h4>
            </div>
          )}

          {/* 2. 추론 합리성 */}
          {evaluation_results?.rb_inference_score && (
            <div className="border-l-4 border-purple-500 pl-4">
              <h4 className="font-semibold mb-1">
                2️⃣ 추론 합리성 (reasoning_basis): {evaluation_results.rb_inference_score.eval_value}점
              </h4>
              <p className="text-sm text-muted-foreground">
                {evaluation_results.rb_inference_score.eval_basis}
              </p>
            </div>
          )}
          {!evaluation_results?.rb_inference_score && hasEvaluationData && (
            <div className="border-l-4 border-gray-300 pl-4">
              <h4 className="font-semibold mb-1 text-muted-foreground">
                2️⃣ 추론 합리성: 데이터 없음
              </h4>
            </div>
          )}

          {/* 3. 실제 근거 일치도 */}
          {evaluation_results?.rb_grounding_TF && (
            <div className="border-l-4 border-green-500 pl-4">
              <h4 className="font-semibold mb-1 flex items-center gap-2">
                3️⃣ 실제 근거 일치도 (reasoning_basis):
                {evaluation_results.rb_grounding_TF.eval_value ? (
                  <Badge variant="default" className="gap-1">
                    <Check className="w-3 h-3" />
                    True
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <X className="w-3 h-3" />
                    False
                  </Badge>
                )}
              </h4>
              <p className="text-sm text-muted-foreground">
                {evaluation_results.rb_grounding_TF.eval_basis}
              </p>
            </div>
          )}
          {!evaluation_results?.rb_grounding_TF && hasEvaluationData && (
            <div className="border-l-4 border-gray-300 pl-4">
              <h4 className="font-semibold mb-1 text-muted-foreground">
                3️⃣ 실제 근거 일치도: 데이터 없음
              </h4>
            </div>
          )}

          {/* 4. 리뷰 충실도 */}
          {evaluation_results?.review_faithfulness_score && (
            <div className="border-l-4 border-orange-500 pl-4">
              <h4 className="font-semibold mb-1">
                4️⃣ 리뷰 충실도 (음식 리뷰): {evaluation_results.review_faithfulness_score.eval_value}점
              </h4>
              <p className="text-sm text-muted-foreground">
                {evaluation_results.review_faithfulness_score.eval_basis}
              </p>
            </div>
          )}
          {!evaluation_results?.review_faithfulness_score && hasEvaluationData && (
            <div className="border-l-4 border-gray-300 pl-4">
              <h4 className="font-semibold mb-1 text-muted-foreground">
                4️⃣ 리뷰 충실도: 데이터 없음
              </h4>
            </div>
          )}

          {/* 5. 주소 정합성 */}
          {evaluation_results?.location_match_TF ? (
            <div className={`border-l-4 ${evaluation_results.location_match_TF.eval_value ? 'border-green-500' : 'border-red-500'} pl-4`}>
              <h4 className="font-semibold mb-1 flex items-center gap-2">
                5️⃣ 주소 정합성:
                {evaluation_results.location_match_TF.eval_value ? (
                  <Badge variant="default" className="gap-1">
                    <Check className="w-3 h-3" />
                    True
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <X className="w-3 h-3" />
                    False
                  </Badge>
                )}
              </h4>
              {!evaluation_results.location_match_TF.eval_value && evaluation_results.location_match_TF.falseMessage && (
                <p className="text-sm text-destructive">
                  <strong>실패 사유:</strong> {evaluation_results.location_match_TF.falseMessage}
                </p>
              )}
              <p className="text-sm mt-1">
                <strong>원본 주소:</strong> {evaluation_results.location_match_TF.origin_address}
              </p>
            </div>
          ) : (
            <div className={`border-l-4 ${record.geocoding_success ? 'border-green-500' : 'border-red-500'} pl-4`}>
              <h4 className="font-semibold mb-1 flex items-center gap-2">
                5️⃣ 주소 정합성 (지오코딩 기반):
                {record.geocoding_success ? (
                  <Badge variant="default" className="gap-1">
                    <Check className="w-3 h-3" />
                    성공
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <X className="w-3 h-3" />
                    실패
                  </Badge>
                )}
              </h4>
              {!record.geocoding_success && record.geocoding_false_stage !== null && (
                <p className="text-sm text-destructive">
                  <strong>실패 단계:</strong> Stage {record.geocoding_false_stage}
                </p>
              )}
              {record.jibun_address && (
                <p className="text-sm mt-1">
                  <strong>지번 주소:</strong> {record.jibun_address}
                </p>
              )}
              {record.road_address && (
                <p className="text-sm">
                  <strong>도로명 주소:</strong> {record.road_address}
                </p>
              )}
            </div>
          )}

          {/* 6. 카테고리 유효성 */}
          {evaluation_results?.category_validity_TF && (
            <div className="border-l-4 border-gray-500 pl-4">
              <h4 className="font-semibold mb-1 flex items-center gap-2">
                6️⃣ 카테고리 유효성 (파싱 문제):
                {evaluation_results.category_validity_TF.eval_value ? (
                  <Badge variant="default" className="gap-1">
                    <Check className="w-3 h-3" />
                    True
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <X className="w-3 h-3" />
                    False
                  </Badge>
                )}
              </h4>
            </div>
          )}
          {!evaluation_results?.category_validity_TF && hasEvaluationData && (
            <div className="border-l-4 border-gray-300 pl-4">
              <h4 className="font-semibold mb-1 text-muted-foreground">
                6️⃣ 카테고리 유효성: 데이터 없음
              </h4>
            </div>
          )}

          {/* 7. 카테고리 정합성 */}
          {evaluation_results?.category_TF && (
            <div className="border-l-4 border-yellow-500 pl-4">
              <h4 className="font-semibold mb-1 flex items-center gap-2">
                7️⃣ 카테고리 정합성:
                {evaluation_results.category_TF.eval_value ? (
                  <Badge variant="default" className="gap-1">
                    <Check className="w-3 h-3" />
                    True
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <X className="w-3 h-3" />
                    False (수정됨)
                  </Badge>
                )}
              </h4>
              {!evaluation_results.category_TF.eval_value && evaluation_results.category_TF.category_revision && (
                <p className="text-sm">
                  <strong>원본 카테고리:</strong> {restaurant_info.category} →
                  <strong className="ml-2">수정 카테고리:</strong> {evaluation_results.category_TF.category_revision}
                </p>
              )}
            </div>
          )}
          {!evaluation_results?.category_TF && hasEvaluationData && (
            <div className="border-l-4 border-gray-300 pl-4">
              <h4 className="font-semibold mb-1 text-muted-foreground">
                7️⃣ 카테고리 정합성: 데이터 없음
              </h4>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 음식점 상세 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">🍽️ 음식점 상세 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p><strong>음식점명:</strong> {record.restaurant_name}</p>
          <p><strong>카테고리:</strong> {restaurant_info?.category || '-'}</p>
          <p><strong>전화번호:</strong> {restaurant_info?.phone || '-'}</p>
          <p><strong>원본 주소:</strong> {restaurant_info?.origin_address || '-'}</p>

          {restaurant_info?.naver_address_info ? (
            <>
              <p className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                <strong>Naver 도로명:</strong> {restaurant_info.naver_address_info.road_address}
              </p>
              <p className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                <strong>Naver 지번:</strong> {restaurant_info.naver_address_info.jibun_address}
              </p>
              <p className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                <strong>좌표:</strong> ({restaurant_info.naver_address_info.y}, {restaurant_info.naver_address_info.x})
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2 text-destructive">
              <X className="w-4 h-4" />
              <strong>Naver 주소:</strong> 지오코딩 실패
            </p>
          )}

          <div className="mt-4 p-3 bg-muted rounded">
            <h5 className="font-semibold mb-1">reasoning_basis:</h5>
            <p className="text-sm">{restaurant_info?.reasoning_basis || '-'}</p>
          </div>

          <div className="mt-4 p-3 bg-muted rounded">
            <h5 className="font-semibold mb-1">tzuyang_review:</h5>
            <p className="text-sm whitespace-pre-wrap">{restaurant_info?.tzuyang_review || '-'}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
