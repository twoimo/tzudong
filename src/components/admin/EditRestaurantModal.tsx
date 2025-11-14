import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord } from '@/types/evaluation';
import { Badge } from '@/components/ui/badge';
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';

interface EditRestaurantModalProps {
  record: EvaluationRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (recordId: string, updates: Partial<EvaluationRecord>) => void;
}

interface FormData {
  name: string;
  address: string;
  phone: string;
  tzuyang_review: string;
}

interface NaverGeocodingResponse {
  addresses?: Array<{
    roadAddress: string;
    jibunAddress: string;
    englishAddress: string;
    addressElements: Array<{
      types: string[];
      longName: string;
      shortName: string;
      code: string;
    }>;
    x: string;
    y: string;
  }>;
  errorMessage?: string;
}

type NaverGeocodingAddress = NonNullable<NaverGeocodingResponse['addresses']>[number];

export function EditRestaurantModal({ record, open, onOpenChange, onSuccess }: EditRestaurantModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    address: '',
    phone: '',
    tzuyang_review: '',
  });
  const [initialAddress, setInitialAddress] = useState<string>(''); // 원본 주소 저장
  const [addressChanged, setAddressChanged] = useState<boolean>(false); // 주소 변경 여부

  // 지오코딩 결과 목록 (여러 개)
  const [geocodingResults, setGeocodingResults] = useState<Array<{
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: Record<string, unknown>;
    x: string;
    y: string;
  }>>([]);

  // 선택된 지오코딩 결과
  const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);


  const handleReGeocode = async () => {
    const trimmedAddress = formData.address.trim();
    const trimmedName = formData.name.trim();

    if (!trimmedAddress) {
      toast({
        variant: 'destructive',
        title: '주소를 입력해주세요',
      });
      return;
    }

    if (!trimmedName) {
      toast({
        variant: 'destructive',
        title: '음식점명을 입력해주세요',
      });
      return;
    }

    try {
      setGeocoding(true);
      setGeocodingError(null);
      setGeocodingResults([]);
      setSelectedGeocodingIndex(null);

      // 1. name + 전체 주소로 지오코딩 (최대 3개)
      const fullAddressResults = await geocodeAddressMultiple(trimmedName, trimmedAddress, 3);

      // 2. name + 주소의 시/군/구까지만 잘라서 지오코딩 (최대 3개)
      const shortAddress = extractCityDistrictGu(trimmedAddress);
      const shortAddressResults = shortAddress
        ? await geocodeAddressMultiple(trimmedName, shortAddress, 3)
        : [];

      // 3. 두 결과를 합치고 중복 제거 (지번 주소 기준)
      const allResults = [...fullAddressResults, ...shortAddressResults];
      const uniqueResults = removeDuplicateAddresses(allResults);

      console.log('🗺️ 지오코딩 결과:', {
        fullAddressResults: fullAddressResults.length,
        shortAddressResults: shortAddressResults.length,
        uniqueResults: uniqueResults.length,
        results: uniqueResults,
      });

      if (uniqueResults.length > 0) {
        setGeocodingResults(uniqueResults);
        setAddressChanged(false); // 지오코딩 성공 시 플래그 초기화
        setInitialAddress(trimmedAddress); // 새로운 주소를 초기 주소로 설정

        toast({
          title: '지오코딩 성공',
          description: `${uniqueResults.length}개의 주소 후보를 찾았습니다. 하나를 선택해주세요.`,
        });
      } else {
        setGeocodingError('주소를 찾을 수 없습니다.');
        toast({
          variant: 'destructive',
          title: '지오코딩 실패',
          description: '주소를 찾을 수 없습니다. 주소를 다시 확인해주세요.',
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      setGeocodingError(errorMessage);
      toast({
        variant: 'destructive',
        title: '지오코딩 실패',
        description: errorMessage,
      });
    } finally {
      setGeocoding(false);
    }
  };

  // 시/군/구까지만 추출하는 함수
  const extractCityDistrictGu = (address: string): string | null => {
    // 서울특별시 마포구, 경기도 성남시 분당구 등 추출
    const regex = /(.*?[시도]\s+.*?[시군구])/;
    const match = address.match(regex);
    return match ? match[1] : null;
  };

  // 중복 제거 함수 (지번 주소 기준)
  const removeDuplicateAddresses = (addresses: Array<{
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: Record<string, unknown>;
    x: string;
    y: string;
  }>): Array<{
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: Record<string, unknown>;
    x: string;
    y: string;
  }> => {
    const seen = new Set<string>();
    return addresses.filter(addr => {
      if (seen.has(addr.jibun_address)) {
        return false;
      }
      seen.add(addr.jibun_address);
      return true;
    });
  };

  // 지오코딩 함수 (여러 개 결과 반환)
  const geocodeAddressMultiple = async (name: string, address: string, limit: number = 3): Promise<Array<{
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: Record<string, unknown>;
    x: string;
    y: string;
  }>> => {
    try {
      // 주소만 사용 (이름 제외) - Geocoding API는 주소만 필요
      console.log('🗺️ 지오코딩 쿼리:', { name, address });

      // Supabase Edge Function을 통해 지오코딩 호출 (CORS 우회)
      const { data, error } = await supabase.functions.invoke('naver-geocode', {
        body: { query: address, count: limit }
      });

      console.log('📡 Edge Function 응답:', { data, error });
      console.log('📡 data 전체:', JSON.stringify(data, null, 2));

      if (error) {
        console.error('❌ Edge Function 에러:', error);
        throw new Error(error.message || JSON.stringify(error));
      }

      if (!data) {
        console.error('❌ 응답 데이터 없음');
        return [];
      }

      if (data.error) {
        console.error('❌ API 에러:', data.error);
        throw new Error(data.error);
      }

      // 📊 디버깅: Naver API의 실제 응답 구조 확인
      console.log('🔍 data 구조 분석:', {
        hasAddresses: 'addresses' in data,
        addressesType: typeof data.addresses,
        addressesLength: data.addresses?.length,
        dataKeys: Object.keys(data),
        fullData: data
      });

      if (!data.addresses || data.addresses.length === 0) {
        console.warn('⚠️ 주소 결과 없음');
        return [];
      }

      console.log('✅ 지오코딩 성공:', data.addresses.length, '개 결과');

      // 최대 limit개까지만 반환
      return data.addresses.slice(0, limit).map((addr: NaverGeocodingAddress) => ({
        road_address: addr.roadAddress,
        jibun_address: addr.jibunAddress,
        english_address: addr.englishAddress,
        address_elements: addr.addressElements as unknown as Record<string, unknown>,
        x: addr.x,
        y: addr.y,
      }));
    } catch (error) {
      console.error('💥 지오코딩 에러:', error);
      throw error; // 에러를 다시 throw하여 상위에서 처리
    }
  };

  const handleApprove = async () => {
    if (!record) return;

    // 주소가 변경되었는데 재지오코딩하지 않은 경우 경고
    if (addressChanged) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ 주소가 변경되었습니다. 재지오코딩을 먼저 진행해주세요.',
      });
      return;
    }

    // 지오코딩 결과가 없거나 선택하지 않은 경우
    if (geocodingResults.length === 0 || selectedGeocodingIndex === null) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '먼저 주소를 지오코딩하고 하나를 선택해주세요.',
      });
      return;
    }

    try {
      setLoading(true);

      // 기존 레스토랑 업데이트 (승인 처리)
      if (!record.restaurant_info) {
        toast({
          variant: 'destructive',
          title: '레스토랑 정보 없음',
        });
        return;
      }

      const trimmedName = formData.name.trim();
      const trimmedPhone = formData.phone.trim();
      const trimmedTzuyangReview = formData.tzuyang_review.trim();

      if (!trimmedName) {
        toast({
          variant: 'destructive',
          title: '음식점명을 입력해주세요',
        });
        return;
      }

      // 선택된 지오코딩 결과 가져오기
      const selectedResult = geocodingResults[selectedGeocodingIndex];

      // 🔥 중복 검사 추가
      const duplicateCheck = await checkRestaurantDuplicate(
        trimmedName,
        selectedResult.jibun_address,
        record.id
      );

      if (duplicateCheck.isDuplicate) {
        // 중복 발견 시 에러 정보 저장
        const errorDetails = {
          error_type: 'duplicate' as const,
          conflicting_restaurant: {
            id: duplicateCheck.matchedRestaurant!.id,
            name: duplicateCheck.matchedRestaurant!.name,
            jibun_address: duplicateCheck.matchedRestaurant!.jibun_address,
            road_address: duplicateCheck.matchedRestaurant!.road_address || undefined,
          },
          similarity_score: duplicateCheck.similarityScore,
          detected_at: new Date().toISOString(),
        };

        // status는 유지하고 에러 메시지만 저장
        await supabase
          .from('restaurants')
          // @ts-expect-error - Supabase 자동 생성 타입 문제
          .update({
            db_error_message: duplicateCheck.reason,
            db_error_details: errorDetails,
          })
          .eq('id', record.id);

        toast({
          variant: 'destructive',
          title: '중복 오류',
          description: duplicateCheck.reason,
        });

        // 에러 상태로 업데이트 콜백
        onSuccess(record.id, {
          db_error_message: duplicateCheck.reason,
          db_error_details: errorDetails,
        });

        setLoading(false);
        return;
      }

      // restaurants 테이블에 업데이트 (evaluation_records와 통합됨)
      const { data: updatedRestaurant, error: updateError } = await supabase
        .from('restaurants')
        // @ts-expect-error - Supabase 자동 생성 타입 문제
        .update({
          name: trimmedName,
          road_address: selectedResult.road_address,
          jibun_address: selectedResult.jibun_address,
          english_address: selectedResult.english_address,
          address_elements: selectedResult.address_elements,
          lat: parseFloat(selectedResult.y),
          lng: parseFloat(selectedResult.x),
          phone: trimmedPhone || null,
          categories: record.restaurant_info.category ? [record.restaurant_info.category] : [],
          youtube_links: [record.youtube_link],
          youtube_metas: record.youtube_meta ? [record.youtube_meta] : [],
          tzuyang_reviews: trimmedTzuyangReview ? [{ review: trimmedTzuyangReview }] : (record.restaurant_info.tzuyang_review ? [{ review: record.restaurant_info.tzuyang_review }] : []),
          status: 'approved', // 승인 상태로 변경
          geocoding_success: true, // 지오코딩 성공으로 설정
          db_error_message: null, // 에러 메시지 초기화
          db_error_details: null, // 에러 상세 초기화
          updated_by_admin_id: user?.id || null, // 현재 로그인한 관리자 ID
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id) // restaurants 테이블의 ID로 업데이트
        .select()
        .single();

      if (updateError) throw updateError;

      toast({
        title: '승인 완료',
        description: `${formData.name} 레스토랑이 성공적으로 등록되었습니다.`,
      });

      onSuccess(record.id, {
        status: 'approved',
        name: trimmedName,
        road_address: selectedResult.road_address,
        jibun_address: selectedResult.jibun_address,
        english_address: selectedResult.english_address,
        address_elements: selectedResult.address_elements,
        lat: parseFloat(selectedResult.y),
        lng: parseFloat(selectedResult.x),
        phone: trimmedPhone || null,
        geocoding_success: true,
        updated_at: new Date().toISOString(),
      });
      onOpenChange(false);
      resetForm();

    } catch (error) {
      console.error('승인 실패:', error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      toast({
        variant: 'destructive',
        title: '승인 실패',
        description: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      phone: '',
      tzuyang_review: '',
    });
    setGeocodingResults([]);
    setSelectedGeocodingIndex(null);
    setGeocodingError(null);
    setInitialAddress('');
    setAddressChanged(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  // Modal이 열릴 때 초기화
  useEffect(() => {
    if (open && record && record.restaurant_info) {
      // 주소 초기값 설정 (우선순위: naver 지번주소 > naver 도로명주소 > origin_address)
      const address = record.restaurant_info.naver_address_info?.jibun_address ||
        record.restaurant_info.naver_address_info?.road_address ||
        record.restaurant_info.origin_address ||
        '';

      console.log('🔄 Modal 초기화:', {
        record_id: record.id,
        address,
        has_naver_info: !!record.restaurant_info.naver_address_info
      });

      setInitialAddress(address); // 원본 주소 저장
      setAddressChanged(false); // 주소 변경 여부 초기화

      setFormData({
        name: record.restaurant_info.name,
        address: address,
        phone: record.restaurant_info.phone || '',
        tzuyang_review: record.restaurant_info.tzuyang_review || '',
      });

      // 기존 지오코딩 결과가 있다면 표시
      if (record.restaurant_info.naver_address_info) {
        const existingResult = {
          road_address: record.restaurant_info.naver_address_info.road_address || '',
          jibun_address: record.restaurant_info.naver_address_info.jibun_address,
          english_address: record.restaurant_info.naver_address_info.english_address || '',
          address_elements: record.restaurant_info.naver_address_info.address_elements,
          x: record.restaurant_info.naver_address_info.x,
          y: record.restaurant_info.naver_address_info.y,
        };
        setGeocodingResults([existingResult]);
        setSelectedGeocodingIndex(0); // 기존 결과를 자동 선택
      } else {
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
      }
    }
  }, [open, record]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>보류 레스토랑 편집 및 승인</DialogTitle>
          <DialogDescription>
            정보를 수정하고 재지오코딩 후 승인할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1">
          {/* 유튜브 링크 표시 */}
          {record && (
            <div className="rounded-lg bg-muted p-3">
              <Label className="text-sm text-muted-foreground">YouTube 링크</Label>
              <a
                href={record.youtube_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline block mt-1"
              >
                {record.youtube_link}
              </a>
              {record.youtube_meta && (
                <p className="text-sm mt-1">{record.youtube_meta.title}</p>
              )}
            </div>
          )}

          {/* 레스토랑 이름 */}
          <div className="space-y-2">
            <Label htmlFor="edit-name">레스토랑 이름</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="예: 홍대 떡볶이"
            />
          </div>

          {/* 주소 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-address">주소</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleReGeocode}
                disabled={geocoding || !formData.address.trim()}
                title={
                  geocoding
                    ? '지오코딩 진행 중...'
                    : !formData.address.trim()
                      ? '주소를 입력해주세요'
                      : '재지오코딩 실행'
                }
              >
                {geocoding && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                {!geocoding && <RefreshCw className="mr-2 h-3 w-3" />}
                재지오코딩
              </Button>
            </div>
            <Textarea
              id="edit-address"
              value={formData.address}
              onChange={(e) => {
                const newAddress = e.target.value;
                setFormData(prev => ({ ...prev, address: newAddress }));

                // 주소가 변경되었는지 확인
                if (newAddress.trim() !== initialAddress.trim()) {
                  setAddressChanged(true);
                  // 주소가 변경되면 지오코딩 결과 초기화
                  setGeocodingResults([]);
                  setSelectedGeocodingIndex(null);
                  setGeocodingError(null);
                } else {
                  setAddressChanged(false);
                }
              }}
              placeholder="예: 서울특별시 마포구 양화로 160"
              rows={2}
            />
          </div>

          {/* 지오코딩 에러 메시지 */}
          {geocodingError && (
            <div className="rounded-lg p-3 bg-red-50 dark:bg-red-950 border border-red-200">
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-sm font-medium">지오코딩 결과</Label>
                <Badge variant="destructive">실패</Badge>
              </div>
              <p className="text-sm text-destructive">{geocodingError}</p>
            </div>
          )}

          {/* 지오코딩 결과 목록 (선택 UI) */}
          {geocodingResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">
                  지오코딩 결과 ({geocodingResults.length}개)
                </Label>
                <Badge variant="default" className="bg-green-600">성공</Badge>
              </div>

              <div className="space-y-2">
                {geocodingResults.map((result, index) => (
                  <div
                    key={index}
                    onClick={() => setSelectedGeocodingIndex(index)}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedGeocodingIndex === index
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 hover:border-gray-300 bg-white dark:bg-gray-800'
                      }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={selectedGeocodingIndex === index ? 'default' : 'outline'}>
                          옵션 {index + 1}
                        </Badge>
                        {selectedGeocodingIndex === index && (
                          <Badge variant="default" className="bg-green-600">
                            선택됨
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1 text-sm">
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">도로명: </span>
                        <span className="text-gray-600 dark:text-gray-400">{result.road_address}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">지번: </span>
                        <span className="text-gray-600 dark:text-gray-400">{result.jibun_address}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">영어: </span>
                        <span className="text-gray-600 dark:text-gray-400">{result.english_address}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">좌표: </span>
                        <span className="text-gray-600 dark:text-gray-400">
                          위도 {result.y}, 경도 {result.x}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {selectedGeocodingIndex === null && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  ⬆️ 위 옵션 중 하나를 클릭해서 선택해주세요
                </p>
              )}
            </div>
          )}

          {/* 전화번호 */}
          <div className="space-y-2">
            <Label htmlFor="edit-phone">전화번호</Label>
            <Input
              id="edit-phone"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="예: 02-1234-5678"
            />
          </div>

          {/* 쯔양 리뷰 */}
          <div className="space-y-2">
            <Label htmlFor="edit-tzuyang-review">쯔양 리뷰</Label>
            <Textarea
              id="edit-tzuyang-review"
              value={formData.tzuyang_review}
              onChange={(e) => setFormData(prev => ({ ...prev, tzuyang_review: e.target.value }))}
              placeholder="리뷰 내용을 입력하세요"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            취소
          </Button>
          <Button
            onClick={handleApprove}
            disabled={loading || geocodingResults.length === 0 || selectedGeocodingIndex === null}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            승인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
