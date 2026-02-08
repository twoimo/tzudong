import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, AlertCircle, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord } from '@/types/evaluation';
import { Badge } from '@/components/ui/badge';
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RESTAURANT_CATEGORIES } from '@/constants/categories';

// 해외 국가 목록
const OVERSEAS_COUNTRIES = [
  "미국", "USA", "United States",
  "일본", "Japan",
  "대만", "Taiwan",
  "태국", "Thailand",
  "인도네시아", "Indonesia",
  "튀르키예", "Turkey", "Türkiye",
  "헝가리", "Hungary",
  "오스트레일리아", "Australia"
];

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
  categories: string[]; // 카테고리 배열로 변경
  youtube_link: string; // 유튜브 링크 추가
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
  const [geocodingNaver, setGeocodingNaver] = useState(false);
  const [geocodingGoogle, setGeocodingGoogle] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    address: '',
    phone: '',
    tzuyang_review: '',
    categories: [], // 카테고리 배열 초기값
    youtube_link: '', // 유튜브 링크 초기값
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

  // 승인 확인 모달 상태
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [conflictingRestaurantInfo, setConflictingRestaurantInfo] = useState<{
    name: string;
    address: string;
  } | null>(null);


  // 재지오코딩 - 네이버
  const handleReGeocodeNaver = async () => {
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
      setGeocodingNaver(true);
      setGeocodingError(null);
      setGeocodingResults([]);
      setSelectedGeocodingIndex(null);


      toast({
        title: '네이버 Geocoding API로 검색 중...',
      });

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



      if (uniqueResults.length > 0) {
        setGeocodingResults(uniqueResults);
        setAddressChanged(false); // 지오코딩 성공 시 플래그 초기화
        setInitialAddress(trimmedAddress); // 새로운 주소를 초기 주소로 설정

        toast({
          title: '지오코딩 성공',
          description: `${uniqueResults.length}개의 주소 후보를 찾았습니다. 하나를 선택해주세요.`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: '주소를 찾을 수 없습니다',
          description: '다른 주소를 시도하거나 Google 지오코딩을 사용해주세요.',
        });
        setGeocodingError('주소를 찾을 수 없습니다.');
      }
    } catch (error: any) {
      console.error('💥 네이버 지오코딩 에러:', error);
      setGeocodingError(error.message || '네이버 지오코딩에 실패했습니다');
      toast({
        variant: 'destructive',
        title: '네이버 지오코딩 실패',
        description: error.message || '네이버 지오코딩에 실패했습니다',
      });
    } finally {
      setGeocodingNaver(false);
    }
  };

  // 재지오코딩 - Mapbox
  const handleReGeocodeMapbox = async () => {
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
      setGeocodingGoogle(true); // 재사용하거나 이름 변경 고려 (여기서는 편의상 state 재사용 또는 새 state 추가)
      // *일단 기존 geocodingGoogle state를 mapbox용으로 사용하거나, 새로 선언 필요. 
      //  User code shows `const [geocodingGoogle, setGeocodingGoogle] = useState(false);` at line 86.
      //  I should probably rename it to `geocodingMapbox` in a multi-replace or just add new state and remove old.
      //  Let's add `geocodingMapbox` state in a separate chunk to be clean.

      setGeocodingError(null);
      setGeocodingResults([]);
      setSelectedGeocodingIndex(null);


      toast({
        title: 'Mapbox Geocoding API로 검색 중...',
      });

      // 1. name + 전체 주소로 지오코딩
      const fullAddressResults = await geocodeWithMapbox(`${trimmedName} ${trimmedAddress}`, 3);

      // 2. 주소만으로 지오코딩
      const addressOnlyResults = await geocodeWithMapbox(trimmedAddress, 3);

      // 3. 합치고 중복 제거
      const allResults = [...fullAddressResults, ...addressOnlyResults];
      const uniqueResults = removeDuplicateAddresses(allResults);



      if (uniqueResults.length > 0) {
        setGeocodingResults(uniqueResults);
        setAddressChanged(false); // 지오코딩 성공 시 플래그 초기화
        setInitialAddress(trimmedAddress); // 새로운 주소를 초기 주소로 설정

        toast({
          title: '지오코딩 성공',
          description: `${uniqueResults.length}개의 주소 후보를 찾았습니다. 하나를 선택해주세요.`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: '주소를 찾을 수 없습니다',
          description: '다른 주소를 시도하거나 네이버 지오코딩을 사용해주세요.',
        });
        setGeocodingError('주소를 찾을 수 없습니다.');
      }
    } catch (error: any) {
      console.error('💥 Mapbox 지오코딩 에러:', error);
      setGeocodingError(error.message || 'Mapbox 지오코딩에 실패했습니다');
      toast({
        variant: 'destructive',
        title: 'Mapbox 지오코딩 실패',
        description: error.message || 'Mapbox 지오코딩에 실패했습니다',
      });
    } finally {
      setGeocodingGoogle(false);
    }
  };

  // ... (existing code)

  // Mapbox Geocoding API 호출 함수
  const geocodeWithMapbox = async (query: string, limit: number = 3): Promise<Array<{
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: Record<string, unknown>;
    x: string;
    y: string;
  }>> => {
    try {
      const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!accessToken) throw new Error('Mapbox Access Token not found');

      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${accessToken}&limit=${limit}&language=ko`
      );
      const data = await response.json();

      if (!data.features || data.features.length === 0) {
        return [];
      }

      return data.features.map((feature: any) => {
        const [lng, lat] = feature.center;
        return {
          road_address: feature.place_name,
          jibun_address: feature.place_name, // Mapbox는 구분 없음
          english_address: feature.place_name,
          address_elements: feature.context ? feature.context.reduce((acc: any, curr: any) => {
            acc[curr.id.split('.')[0]] = curr.text;
            return acc;
          }, {}) : {},
          x: String(lng),
          y: String(lat),
        };
      });
    } catch (error) {
      console.error('Mapbox Geocoding 에러:', error);
      throw error;
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

  // 해외 주소 감지 함수
  const isOverseasAddress = (address: string, englishAddress?: string): boolean => {
    const checkText = `${address} ${englishAddress || ''}`;
    return OVERSEAS_COUNTRIES.some(country => checkText.includes(country));
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


      // Supabase Edge Function을 통해 지오코딩 호출 (CORS 우회)
      const { data, error } = await supabase.functions.invoke('naver-geocode', {
        body: { query: address, count: limit }
      });



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



      if (!data.addresses || data.addresses.length === 0) {
        console.warn('⚠️ 주소 결과 없음');
        return [];
      }



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

    // geocoding_success가 false인 경우 지오코딩 필수
    if (record.geocoding_success === false && selectedGeocodingIndex === null) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ 지오코딩을 먼저 실행해주세요.',
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
        record.id,
        record.youtube_link // YouTube 링크도 함께 전달
      );



      if (duplicateCheck.isDuplicate) {


        // 🔥 수정: 유튜브 링크 비교 로직 개선
        const currentYoutubeLink = record.youtube_link?.trim() || null;
        const matchedYoutubeLink = duplicateCheck.matchedRestaurant?.youtube_link?.trim() || null;



        // 유튜브 링크가 다른 경우: 확인 모달 표시
        if (currentYoutubeLink !== matchedYoutubeLink) {


          setConflictingRestaurantInfo({
            name: duplicateCheck.matchedRestaurant!.name,
            address: duplicateCheck.matchedRestaurant!.jibun_address || duplicateCheck.matchedRestaurant!.road_address || '',
          });
          setShowApprovalConfirm(true);
          setLoading(false);
          return;
        }



        // 유튜브 링크가 같은 경우: 중복 오류 처리 (기존 로직)
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

      // 실제 승인 처리 실행
      await performApproval();

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

  // 실제 승인 처리 실행 (중복 확인 후 재사용)
  const performApproval = async () => {
    if (!record) return;

    const trimmedName = formData.name.trim();
    const trimmedPhone = formData.phone.trim();
    const trimmedTzuyangReview = formData.tzuyang_review.trim();
    const selectedCategories = formData.categories; // 선택된 카테고리 배열
    const selectedResult = geocodingResults[selectedGeocodingIndex!];

    // restaurants 테이블에 업데이트 (evaluation_records와 통합됨)


    const updateData = {

      road_address: selectedResult.road_address,
      jibun_address: selectedResult.jibun_address,
      english_address: selectedResult.english_address,
      address_elements: selectedResult.address_elements,
      lat: parseFloat(selectedResult.y),
      lng: parseFloat(selectedResult.x),
      phone: trimmedPhone || null,
      categories: selectedCategories, // 선택된 카테고리 배열
      youtube_link: record.youtube_link,
      tzuyang_review: trimmedTzuyangReview || record.restaurant_info?.tzuyang_review || null,
      status: 'approved', // 승인 상태로 변경
      geocoding_success: true, // 지오코딩 성공으로 설정
      geocoding_false_stage: null, // 지오코딩 성공 시 NULL (체크 제약 준수)
      db_error_message: null, // 에러 메시지 초기화
      db_error_details: null, // 에러 상세 초기화
      updated_by_admin_id: user?.id || null, // 현재 로그인한 관리자 ID
      updated_at: new Date().toISOString(),
      approved_name: trimmedName, // 관리자 승인 이름 저장
    };



    const { data: updatedRestaurant, error: updateError } = await supabase
      .from('restaurants')
      // @ts-expect-error - Supabase 자동 생성 타입 문제
      .update(updateData)
      .eq('id', record.id) // restaurants 테이블의 ID로 업데이트
      .select()
      .single();



    if (updateError) {
      console.error('❌ DB 업데이트 에러 상세:', {
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
        code: updateError.code,
      });
      throw updateError;
    }

    toast({
      title: '승인 완료',
      description: `${formData.name} 레스토랑이 성공적으로 등록되었습니다.`,
    });

    onSuccess(record.id, {
      status: 'approved',
      name: trimmedName,
      approved_name: trimmedName, // 관리자 승인 이름 업데이트
      restaurant_name: trimmedName, // 별칭도 업데이트
      categories: selectedCategories, // 카테고리 업데이트 추가
      road_address: selectedResult.road_address,
      jibun_address: selectedResult.jibun_address,
      english_address: selectedResult.english_address,
      address_elements: selectedResult.address_elements,
      lat: parseFloat(selectedResult.y),
      lng: parseFloat(selectedResult.x),
      phone: trimmedPhone || null,
      geocoding_success: true,
      geocoding_false_stage: null,
      db_error_message: null,
      db_error_details: null,
      updated_at: new Date().toISOString(),
      restaurant_info: record.restaurant_info ? {
        ...record.restaurant_info,
        name: trimmedName,
        phone: trimmedPhone || null,
        category: selectedCategories[0] || record.restaurant_info.category, // 첫 번째 카테고리 사용
        tzuyang_review: trimmedTzuyangReview || record.restaurant_info.tzuyang_review,
        naver_address_info: {
          road_address: selectedResult.road_address,
          jibun_address: selectedResult.jibun_address,
          english_address: selectedResult.english_address,
          address_elements: selectedResult.address_elements,
          x: selectedResult.x,
          y: selectedResult.y,
        },
      } : undefined,
    });

    onOpenChange(false);
    resetForm();
  };

  // 저장만 하는 함수 (승인하지 않고 수정 사항만 저장)
  const handleSave = async () => {
    if (!record) return;

    try {
      setLoading(true);

      const trimmedName = formData.name.trim();
      const trimmedPhone = formData.phone.trim();
      const trimmedAddress = formData.address.trim();
      const trimmedTzuyangReview = formData.tzuyang_review.trim();
      const selectedCategories = formData.categories; // 선택된 카테고리 배열

      if (!trimmedName) {
        toast({
          variant: 'destructive',
          title: '음식점명을 입력해주세요',
        });
        return;
      }

      // 수정 사항만 업데이트 (status는 변경하지 않음)
      const updateData: Record<string, unknown> = {
        approved_name: trimmedName,
        phone: trimmedPhone || null,
        updated_by_admin_id: user?.id || null,
        updated_at: new Date().toISOString(),
      };

      // 카테고리 업데이트 (비어있어도 업데이트하여 삭제 가능하도록 함)
      updateData.categories = selectedCategories;

      // 지오코딩 결과가 있고 선택된 경우에만 주소 정보 업데이트
      if (geocodingResults.length > 0 && selectedGeocodingIndex !== null) {
        const selectedResult = geocodingResults[selectedGeocodingIndex];
        updateData.road_address = selectedResult.road_address;
        updateData.jibun_address = selectedResult.jibun_address;
        updateData.english_address = selectedResult.english_address;
        updateData.address_elements = selectedResult.address_elements;
        updateData.lat = parseFloat(selectedResult.y);
        updateData.lng = parseFloat(selectedResult.x);
        updateData.geocoding_success = true;
        updateData.geocoding_false_stage = null;
      }

      // 쯔양 리뷰 업데이트 (text 타입)
      if (trimmedTzuyangReview) {
        updateData.tzuyang_review = trimmedTzuyangReview;
      }



      const { error: updateError } = await supabase
        .from('restaurants')
        // @ts-expect-error - Supabase 자동 생성 타입 문제
        .update(updateData)
        .eq('id', record.id);

      if (updateError) {
        console.error('❌ DB 업데이트 에러:', updateError);
        throw updateError;
      }

      toast({
        title: '저장 완료',
        description: `${formData.name} 레스토랑 정보가 저장되었습니다.`,
      });

      // 업데이트된 정보를 부모 컴포넌트에 전달
      const updates: Partial<EvaluationRecord> = {
        name: trimmedName,
        phone: trimmedPhone || null,
        updated_at: new Date().toISOString(),
        restaurant_name: trimmedName, // 별칭도 업데이트
        categories: selectedCategories, // 카테고리 업데이트 추가
        // 🔥 주소 필드 항상 포함 (제보 수정 시 필요)
        road_address: trimmedAddress,
        youtube_link: formData.youtube_link.trim() || undefined, // 유튜브 링크 추가
      };

      // restaurant_info 객체도 업데이트
      if (record.restaurant_info) {
        updates.restaurant_info = {
          ...record.restaurant_info,
          name: trimmedName,
          phone: trimmedPhone || null,
          category: selectedCategories[0] || record.restaurant_info.category, // 첫 번째 카테고리 사용
          tzuyang_review: trimmedTzuyangReview || record.restaurant_info.tzuyang_review,
        };
      }

      if (geocodingResults.length > 0 && selectedGeocodingIndex !== null) {
        const selectedResult = geocodingResults[selectedGeocodingIndex];
        updates.road_address = selectedResult.road_address;
        updates.jibun_address = selectedResult.jibun_address;
        updates.english_address = selectedResult.english_address;
        updates.address_elements = selectedResult.address_elements;
        updates.lat = parseFloat(selectedResult.y);
        updates.lng = parseFloat(selectedResult.x);
        updates.geocoding_success = true;
        updates.geocoding_false_stage = null;

        // restaurant_info의 naver_address_info도 업데이트
        if (record.restaurant_info) {
          updates.restaurant_info = {
            ...updates.restaurant_info!,
            naver_address_info: {
              road_address: selectedResult.road_address,
              jibun_address: selectedResult.jibun_address,
              english_address: selectedResult.english_address,
              address_elements: selectedResult.address_elements,
              x: selectedResult.x,
              y: selectedResult.y,
            },
          };
        }
      }

      onSuccess(record.id, updates);
      onOpenChange(false);
      resetForm();

    } catch (error) {
      console.error('💥 저장 실패:', error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      toast({
        variant: 'destructive',
        title: '저장 실패',
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
      categories: [], // 카테고리 배열 초기화
      youtube_link: '', // 유튜브 링크 초기화
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

      // 카테고리 초기값 설정
      let initialCategories: string[] = [];

      // 1. record.categories가 존재하면 우선 사용 (배열)
      if (record.categories && record.categories.length > 0) {
        initialCategories = record.categories;
      }
      // 2. 아니면 기존 restaurant_info.category 사용 (단일)
      else if (record.restaurant_info.category) {
        initialCategories = [record.restaurant_info.category];
      }

      // 3. AI 제안 적용 (단, 관리자가 수정한 적이 없는 경우에만!)
      // updated_by_admin_id가 없으면 아직 관리자 손을 타지 않은 것으로 간주
      if (!record.updated_by_admin_id && record.evaluation_results?.category_TF?.eval_value === false) {
        const categoryRevision = record.evaluation_results.category_TF.category_revision;

        if (categoryRevision) {
          // category_revision이 배열인 경우
          if (Array.isArray(categoryRevision)) {
            const validCategories = categoryRevision.filter(cat =>
              RESTAURANT_CATEGORIES.includes(cat as typeof RESTAURANT_CATEGORIES[number])
            );
            if (validCategories.length > 0) {
              initialCategories = validCategories;
            }
          }
          // category_revision이 문자열인 경우
          else if (typeof categoryRevision === 'string') {
            if (RESTAURANT_CATEGORIES.includes(categoryRevision as typeof RESTAURANT_CATEGORIES[number])) {
              initialCategories = [categoryRevision];
            }
          }
        }
      }



      setInitialAddress(address); // 원본 주소 저장
      setAddressChanged(false); // 주소 변경 여부 초기화

      setFormData({
        name: record.naver_name || record.origin_name || record.restaurant_info.name || '',
        address: address,
        phone: record.restaurant_info.phone || '',
        tzuyang_review: record.restaurant_info.tzuyang_review || '',
        categories: initialCategories, // 카테고리 배열 설정
        youtube_link: record.youtube_link || '', // 유튜브 링크 설정
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
          {/* 유튜브 링크 편집 */}
          <div className="space-y-2">
            <Label htmlFor="edit-youtube-link">YouTube 링크</Label>
            <Input
              id="edit-youtube-link"
              value={formData.youtube_link}
              onChange={(e) => setFormData(prev => ({ ...prev, youtube_link: e.target.value }))}
              placeholder="예: https://www.youtube.com/watch?v=..."
            />
            {record?.youtube_meta && (
              <p className="text-sm text-muted-foreground">영상 제목: {record.youtube_meta.title}</p>
            )}
          </div>

          {/* 레스토랑 이름 */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 bg-muted rounded-md border text-xs" title={record?.origin_name || ''}>
                <span className="block text-muted-foreground mb-0.5">Origin Name</span>
                <span className="font-medium text-foreground truncate block">{record?.origin_name || '-'}</span>
              </div>
              <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-100 dark:border-blue-800 text-xs" title={record?.naver_name || ''}>
                <span className="block text-blue-600 dark:text-blue-400 mb-0.5">Naver Name</span>
                <span className="font-medium text-foreground truncate block">{record?.naver_name || '-'}</span>
              </div>
            </div>
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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <Label htmlFor="edit-address">주소</Label>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleReGeocodeNaver}
                  disabled={geocodingNaver || geocodingGoogle || !formData.address.trim()}
                  className="whitespace-nowrap"
                >
                  {geocodingNaver && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {!geocodingNaver && <RefreshCw className="mr-1 h-3 w-3" />}
                  네이버 지오코딩
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleReGeocodeMapbox}
                  disabled={geocodingNaver || geocodingGoogle || !formData.address.trim()}
                  className="whitespace-nowrap"
                >
                  {geocodingGoogle && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {!geocodingGoogle && <RefreshCw className="mr-1 h-3 w-3" />}
                  Mapbox 지오코딩
                </Button>
              </div>
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
                    onClick={() => {
                      setSelectedGeocodingIndex(index);
                      // 선택된 옵션의 지번 주소로 실시간 업데이트
                      setFormData(prev => ({ ...prev, address: result.jibun_address }));
                      setInitialAddress(result.jibun_address);
                      setAddressChanged(false);
                    }}
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

          {/* 카테고리 비교 및 수정 */}
          <div className="space-y-3">
            <Label>카테고리</Label>

            {/* 카테고리 비교 영역 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 기존 카테고리 */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">기존 카테고리</Label>
                <div className="p-3 rounded-lg border bg-muted min-h-[60px]">
                  <div className="flex flex-wrap gap-1">
                    {record?.categories && record.categories.length > 0 ? (
                      record.categories.map((cat, idx) => (
                        <Badge key={idx} variant="outline">{cat}</Badge>
                      ))
                    ) : record?.restaurant_info?.category ? (
                      <Badge variant="outline">{record.restaurant_info.category}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">없음</span>
                    )}
                  </div>
                </div>
              </div>

              {/* AI 제안 카테고리 */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                  AI 제안 카테고리
                  {record?.evaluation_results?.category_TF?.eval_value === false && (
                    <Badge variant="destructive" className="ml-2 text-xs">불일치</Badge>
                  )}
                  {record?.evaluation_results?.category_TF?.eval_value === true && (
                    <Badge className="ml-2 text-xs bg-green-500">일치</Badge>
                  )}
                </Label>
                <div className="p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 min-h-[60px]">
                  {record?.evaluation_results?.category_TF?.category_revision ? (
                    <div className="flex flex-wrap gap-1">
                      {Array.isArray(record.evaluation_results.category_TF.category_revision) ? (
                        record.evaluation_results.category_TF.category_revision.map((cat: string, idx: number) => (
                          <Badge key={idx} variant="secondary" className="bg-blue-100 dark:bg-blue-900">{cat}</Badge>
                        ))
                      ) : (
                        <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900">
                          {record.evaluation_results.category_TF.category_revision}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">제안 없음</span>
                  )}
                  {record?.evaluation_results?.category_TF?.eval_basis && (
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      💡 {record.evaluation_results.category_TF.eval_basis}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 수정할 카테고리 (아래) */}
            <div className="space-y-2 pt-2">
              <Label className="text-sm font-medium">
                최종 카테고리 (여러 개 선택 가능)
              </Label>

              {/* 선택된 카테고리 배지 */}
              {formData.categories.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {formData.categories.map((cat) => (
                    <Badge key={cat} variant="secondary" className="gap-1">
                      {cat}
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-destructive"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            categories: prev.categories.filter(c => c !== cat)
                          }));
                        }}
                      />
                    </Badge>
                  ))}
                </div>
              )}

              {/* 카테고리 체크박스 목록 (2열 그리드) */}
              <div className="border rounded-lg p-3 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {RESTAURANT_CATEGORIES.map((category) => (
                    <div key={category} className="flex items-center space-x-2">
                      <Checkbox
                        id={`cat-${category}`}
                        checked={formData.categories.includes(category)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setFormData(prev => ({
                              ...prev,
                              categories: [...prev.categories, category]
                            }));
                          } else {
                            setFormData(prev => ({
                              ...prev,
                              categories: prev.categories.filter(c => c !== category)
                            }));
                          }
                        }}
                      />
                      <label
                        htmlFor={`cat-${category}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {category}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 쯔양 리뷰 */}
          <div className="space-y-2">
            <Label htmlFor="edit-tzuyang-review">쯔양의 리뷰</Label>
            <Textarea
              id="edit-tzuyang-review"
              value={formData.tzuyang_review}
              onChange={(e) => setFormData(prev => ({ ...prev, tzuyang_review: e.target.value }))}
              placeholder="리뷰 내용을 입력하세요"
              rows={5}
              className="leading-relaxed resize-none"
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
            type="button"
            variant="secondary"
            onClick={handleSave}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            저장
          </Button>
          <Button
            onClick={handleApprove}
            disabled={loading || geocodingResults.length === 0 || selectedGeocodingIndex === null}
            title={
              geocodingResults.length === 0 || selectedGeocodingIndex === null
                ? '지오코딩을 먼저 진행하고 주소를 선택해주세요'
                : '승인 및 저장'
            }
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            승인
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 승인 확인 모달 */}
      <AlertDialog open={showApprovalConfirm} onOpenChange={setShowApprovalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>승인 확인</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">이름이 유사한 레스토랑이 존재하지만 유튜브 링크가 다릅니다.</span>
              {conflictingRestaurantInfo && (
                <span className="block mt-3 p-3 bg-muted rounded-md">
                  <span className="block font-medium">기존 레스토랑:</span>
                  <span className="block text-sm mt-1">이름: {conflictingRestaurantInfo.name}</span>
                  <span className="block text-sm">주소: {conflictingRestaurantInfo.address}</span>
                </span>
              )}
              <span className="block mt-3 font-medium">승인하시겠습니까?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setShowApprovalConfirm(false);
                setLoading(true);
                try {
                  await performApproval();
                } catch (error) {
                  console.error('승인 실패:', error);
                  toast({
                    variant: 'destructive',
                    title: '승인 실패',
                    description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                  });
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              승인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
