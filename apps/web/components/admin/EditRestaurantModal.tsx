import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Json, TablesUpdate } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord } from '@/types/evaluation';
import { Badge } from '@/components/ui/badge';
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
import { getAdminEvaluationDisplayName } from '@/lib/admin-evaluation-name';
import { decodeBasicHtmlEntities, stripUnsafeMarkup } from '@/lib/html-escape';
import { LocalCatalogEditSession, pendingCatalogEdit, catalogEditMessage, catalogEditFields, type CatalogEditPatch, type CatalogEditOutcome, type CatalogEditValues } from '@/lib/admin/local-catalog-edit-client';
import {
  fetchSameVideoDuplicateWarningCandidates,
  formatSameVideoDuplicateWarning,
  type SameVideoDuplicateWarningCandidate,
} from '@/lib/admin-same-video-duplicate-warning';
import {
  findRestaurantIdentityWarnings,
  formatRestaurantIdentityWarning,
  hasBlockingRestaurantIdentityWarning,
  type RestaurantIdentityWarning,
  type RestaurantIdentityWarningRow,
} from '@/lib/admin-restaurant-identity-warning';
import { Checkbox } from '@/components/ui/checkbox';
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
import { parseCategoryList } from '@/lib/category-utils';
import { RESTAURANT_CATEGORIES } from '@/constants/categories';
import {
  ADMIN_MODAL_ACTION,
  ADMIN_MODAL_CONTENT_MD_FLEX,
  ADMIN_MODAL_CONTENT_SM,
  ADMIN_MODAL_FOOTER,
  ADMIN_MODAL_FOOTER_DIVIDER,
  ADMIN_MODAL_SCROLL_BODY,
} from './admin-modal-styles';

interface EditRestaurantModalProps {
  record: EvaluationRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (recordId: string, updates: Partial<EvaluationRecord>) => void;
  onCatalogSaved: (recordId: string, values: CatalogEditValues) => void;
}

interface FormData {
  name: string;
  address: string;
  phone: string;
  tzuyang_review: string;
  categories: string[]; // 카테고리 배열로 변경
  youtube_link: string; // 유튜브 링크 추가
}

const catalogFieldLabels: Record<typeof catalogEditFields[number], string> = {
  approved_name: '맛집 이름', categories: '카테고리', lat: '위도', lng: '경도',
  road_address: '도로명 주소', jibun_address: '지번 주소', english_address: '영문 주소',
  youtube_link: 'YouTube 링크', tzuyang_review: '쯔양의 리뷰',
};
const catalogDisplayValue = (value: unknown) => value == null || value === ''
  ? '없음' : Array.isArray(value) ? value.join(', ') || '없음' : String(value);

interface NaverGeocodingResponse {
  addresses?: Array<{
    roadAddress: string;
    jibunAddress: string;
    englishAddress: string;
    addressElements: unknown;
    x: string;
    y: string;
  }>;
  errorMessage?: string;
}

type NaverGeocodingAddress = NonNullable<NaverGeocodingResponse['addresses']>[number];

interface GeocodingResult {
  fromExistingRecord?: boolean;
  road_address: string;
  jibun_address: string;
  english_address: string;
  address_elements: Json;
  x: string;
  y: string;
  place_name?: string;
  place_phone?: string;
}

interface NaverLocalSearchItem {
  title?: string;
  address?: string;
  roadAddress?: string;
  telephone?: string;
}

interface NaverLocalSearchResponse {
  items?: NaverLocalSearchItem[];
}

const getErrorMessage = (_error: unknown, fallback: string) => fallback;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encodeJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON_NUMBER_INVALID');
    return value;
  }
  if (Array.isArray(value)) return value.map(encodeJson);
  if (!isPlainRecord(value)) throw new Error('JSON_VALUE_INVALID');

  const encoded: { [key: string]: Json | undefined } = {};
  for (const [key, entry] of Object.entries(value)) {
    encoded[key] = entry === undefined ? undefined : encodeJson(entry);
  }
  return encoded;
}

function isJsonRecord(value: Json): value is { [key: string]: Json | undefined } {
  return isPlainRecord(value);
}

function getEvaluationAddressElements(
  value: Json,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  return isJsonRecord(value) ? value : fallback;
}

const sanitizeNaverPlaceTitle = (title: string | undefined) =>
  decodeBasicHtmlEntities(stripUnsafeMarkup(title || ''));

const normalizePlaceAddress = (address: string | undefined) =>
  (address || '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, '')
    .trim();

const isMatchingPlaceAddress = (placeAddress: string | undefined, geocodedAddress: string | undefined) => {
  const normalizedPlaceAddress = normalizePlaceAddress(placeAddress);
  const normalizedGeocodedAddress = normalizePlaceAddress(geocodedAddress);

  if (!normalizedPlaceAddress || !normalizedGeocodedAddress) return false;

  return normalizedPlaceAddress === normalizedGeocodedAddress ||
    normalizedPlaceAddress.includes(normalizedGeocodedAddress) ||
    normalizedGeocodedAddress.includes(normalizedPlaceAddress);
};

const findBestNaverPlaceMatch = (items: NaverLocalSearchItem[], geocodingResult: GeocodingResult) => {
  const matchedByAddress = items.find((item) =>
    isMatchingPlaceAddress(item.address, geocodingResult.jibun_address) ||
    isMatchingPlaceAddress(item.roadAddress, geocodingResult.road_address) ||
    isMatchingPlaceAddress(item.address, geocodingResult.road_address) ||
    isMatchingPlaceAddress(item.roadAddress, geocodingResult.jibun_address)
  );

  return matchedByAddress || (items.length === 1 ? items[0] : null);
};

export function EditRestaurantModal({ record, open, onOpenChange, onSuccess, onCatalogSaved }: EditRestaurantModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const requireAdminUserId = () => {
    if (!user?.id) {
      throw new Error('로그인이 필요합니다');
    }

    return user.id;
  };
  const [loading, setLoading] = useState(false);
  const [catalogEdit, setCatalogEdit] = useState<LocalCatalogEditSession | null>(null);
  const [catalogOutcome, setCatalogOutcome] = useState<CatalogEditOutcome | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const catalogBusyRef = useRef(false);
  const [catalogConfirmation, setCatalogConfirmation] = useState('');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRecoveryBlocked, setCatalogRecoveryBlocked] = useState(false);

  const [geocodingNaver, setGeocodingNaver] = useState(false);
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
  const [geocodingResults, setGeocodingResults] = useState<GeocodingResult[]>([]);

  // 선택된 지오코딩 결과
  const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);

  // 승인 확인 모달 상태
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [conflictingRestaurantInfo, setConflictingRestaurantInfo] = useState<{
    name: string;
    address: string;
  } | null>(null);
  const [sameVideoDuplicateWarnings, setSameVideoDuplicateWarnings] = useState<SameVideoDuplicateWarningCandidate[]>([]);
  const [restaurantIdentityWarningRows, setRestaurantIdentityWarningRows] = useState<RestaurantIdentityWarningRow[]>([]);


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
      const enrichedResults = await enrichGeocodingResultsWithPlaceMetadata(trimmedName, uniqueResults);

      if (enrichedResults.length > 0) {
        setGeocodingResults(enrichedResults);
        setAddressChanged(false); // 지오코딩 성공 시 플래그 초기화
        setInitialAddress(trimmedAddress); // 새로운 주소를 초기 주소로 설정

        toast({
          title: '지오코딩 성공',
          description: `${enrichedResults.length}개의 주소 후보를 찾았습니다. 하나를 선택해주세요.`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: '주소를 찾을 수 없습니다',
          description: '다른 주소를 시도하거나 주소를 직접 확인해주세요.',
        });
        setGeocodingError('주소를 찾을 수 없습니다.');
      }
    } catch (error: unknown) {
      console.error('💥 네이버 지오코딩 에러:');
      const message = getErrorMessage(error, '네이버 지오코딩에 실패했습니다');
      setGeocodingError(message);
      toast({
        variant: 'destructive',
        title: '네이버 지오코딩 실패',
        description: message,
      });
    } finally {
      setGeocodingNaver(false);
    }
  };

  const fetchNaverPlaceMetadata = async (name: string, result: GeocodingResult): Promise<Partial<GeocodingResult>> => {
    const searchAddress = result.road_address || result.jibun_address;
    const query = [name, searchAddress].filter(Boolean).join(' ').trim();

    if (!query) return {};

    try {
      const response = await fetch('/api/naver-search', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, display: 5 }),
      });
      if (!response.ok) {
        console.warn('네이버 장소 검색 실패:', response.status);
        return {};
      }

      const data = await response.json() as NaverLocalSearchResponse;
      const bestMatch = findBestNaverPlaceMatch(data.items || [], result);

      if (!bestMatch) return {};

      const placeName = sanitizeNaverPlaceTitle(bestMatch.title);
      const placePhone = (bestMatch.telephone || '').trim();

      return {
        ...(placeName ? { place_name: placeName } : {}),
        ...(placePhone ? { place_phone: placePhone } : {}),
      };
    } catch (error) {
      console.warn('네이버 장소 검색 중 오류:');
      return {};
    }
  };

  const enrichGeocodingResultsWithPlaceMetadata = async (
    name: string,
    results: GeocodingResult[]
  ): Promise<GeocodingResult[]> => {
    const trimmedName = name.trim();
    if (!trimmedName || results.length === 0) return results;

    return Promise.all(
      results.map(async (result) => ({
        ...result,
        ...(await fetchNaverPlaceMetadata(trimmedName, result)),
      }))
    );
  };

  // 시/군/구까지만 추출하는 함수
  const extractCityDistrictGu = (address: string): string | null => {
    // 서울특별시 마포구, 경기도 성남시 분당구 등 추출
    const regex = /(.*?[시도]\s+.*?[시군구])/;
    const match = address.match(regex);
    return match ? match[1] : null;
  };

  // 중복 제거 함수 (지번 주소 기준)
  const removeDuplicateAddresses = (addresses: GeocodingResult[]): GeocodingResult[] => {
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
  const geocodeAddressMultiple = async (name: string, address: string, limit: number = 3): Promise<GeocodingResult[]> => {
    try {
      // 주소만 사용 (이름 제외) - Geocoding API는 주소만 필요


      // Supabase Edge Function을 통해 지오코딩 호출 (CORS 우회)
      const { data, error } = await supabase.functions.invoke('naver-geocode', {
        body: { query: address, count: limit }
      });



      if (error) {
        console.error('❌ Edge Function 에러:');
        throw new Error('NAVER_GEOCODE_REQUEST_FAILED');
      }

      if (!data) {
        console.error('❌ 응답 데이터 없음');
        return [];
      }

      if (data.error) {
        console.error('❌ API 에러:');
        throw new Error('NAVER_GEOCODE_PROVIDER_FAILED');
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
        address_elements: encodeJson(addr.addressElements),
        x: addr.x,
        y: addr.y,
      }));
    } catch (error) {
      console.error('💥 지오코딩 에러:');
      throw error; // 에러를 다시 throw하여 상위에서 처리
    }
  };

  const handleApprove = async () => {
    if (!record || catalogBusyRef.current || catalogEdit || catalogRecoveryBlocked || rejectPhoneChange()) return;

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

    if (notifyRestaurantIdentityWarning('승인')) {
      return;
    }

    try {
      setLoading(true);
      const adminUserId = requireAdminUserId();
      notifySameVideoDuplicateWarning('승인');

      // 기존 레스토랑 업데이트 (승인 처리)
      if (!record.restaurant_info) {
        toast({
          variant: 'destructive',
          title: '레스토랑 정보 없음',
        });
        return;
      }

      const trimmedName = formData.name.trim();
      const trimmedYoutubeLink = formData.youtube_link.trim();

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
        trimmedYoutubeLink || record.youtube_link // YouTube 링크도 함께 전달
      );



      if (duplicateCheck.isDuplicate) {


        // 🔥 수정: 유튜브 링크 비교 로직 개선
        const currentYoutubeLink = (trimmedYoutubeLink || record.youtube_link || '').trim() || null;
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
          .update({
            db_error_message: duplicateCheck.reason,
            db_error_details: encodeJson(errorDetails),
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
      await performApproval(adminUserId);

    } catch (error) {
      console.error('승인 실패:');
      const errorMessage = '승인 처리에 실패했습니다. 관리자 권한과 입력 내용을 확인해주세요.';
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
  const performApproval = async (adminUserId: string) => {
    if (!record) return;

    const trimmedName = formData.name.trim();
    const trimmedTzuyangReview = formData.tzuyang_review.trim();
    const selectedCategories = formData.categories; // 선택된 카테고리 배열
    const selectedResult = geocodingResults[selectedGeocodingIndex!];

    // restaurants 테이블에 업데이트 (evaluation_records와 통합됨)


    const updatedAt = new Date().toISOString();
    const updateData: TablesUpdate<'restaurants'> = {

      road_address: selectedResult.road_address,
      jibun_address: selectedResult.jibun_address,
      english_address: selectedResult.english_address,
      address_elements: selectedResult.address_elements,
      lat: parseFloat(selectedResult.y),
      lng: parseFloat(selectedResult.x),
      categories: selectedCategories, // 선택된 카테고리 배열
      youtube_link: formData.youtube_link.trim() || record.youtube_link || null,
      tzuyang_review: trimmedTzuyangReview || null,
      status: 'approved', // 승인 상태로 변경
      geocoding_success: true, // 지오코딩 성공으로 설정
      geocoding_false_stage: null, // 지오코딩 성공 시 NULL (체크 제약 준수)
      db_error_message: null, // 에러 메시지 초기화
      db_error_details: null, // 에러 상세 초기화
      updated_by_admin_id: adminUserId,
      updated_at: updatedAt,
      approved_name: trimmedName, // 관리자 승인 이름 저장
    };



    const { error: updateError } = await supabase
      .from('restaurants')
      .update(updateData)
      .eq('id', record.id); // restaurants 테이블의 ID로 업데이트



    if (updateError) {
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
      youtube_link: formData.youtube_link.trim() || record.youtube_link || undefined,
      road_address: selectedResult.road_address,
      jibun_address: selectedResult.jibun_address,
      english_address: selectedResult.english_address,
      address_elements: getEvaluationAddressElements(selectedResult.address_elements, record.address_elements),
      lat: parseFloat(selectedResult.y),
      lng: parseFloat(selectedResult.x),
      geocoding_success: true,
      geocoding_false_stage: null,
      db_error_message: null,
      db_error_details: null,
      updated_by_admin_id: adminUserId,
      updated_at: updatedAt,
      restaurant_info: record.restaurant_info ? {
        ...record.restaurant_info,
        name: trimmedName,
          category: selectedCategories[0] || record.restaurant_info.category, // 첫 번째 카테고리 사용
        tzuyang_review: trimmedTzuyangReview,
        naver_address_info: {
          road_address: selectedResult.road_address,
          jibun_address: selectedResult.jibun_address,
          english_address: selectedResult.english_address,
          address_elements: getEvaluationAddressElements(
            selectedResult.address_elements,
            record.restaurant_info.naver_address_info?.address_elements ?? record.address_elements,
          ),
          x: selectedResult.x,
          y: selectedResult.y,
        },
      } : undefined,
    });

    onOpenChange(false);
    resetForm();
  };

  // Catalog edits use only the local API. Approval remains a separate action.
  const phoneChanged = formData.phone.trim() !== (record?.restaurant_info?.phone || '').trim();
  const catalogUnresolved = !!catalogEdit?.readbackOnly && catalogOutcome?.kind !== 'verified';
  const catalogFieldsLocked = catalogBusy || catalogUnresolved || catalogOutcome?.kind === 'verified';

  const rejectPhoneChange = () => {
    if (!phoneChanged) return false;
    toast({ variant: 'destructive', title: '전화번호 변경은 지원하지 않습니다',
      description: '전화번호는 저장하지 않습니다. 기존 값으로 되돌린 후 진행해주세요.' });
    return true;
  };

  const handleSave = async () => {
    if (!record || catalogBusyRef.current || loading || geocodingNaver || catalogRecoveryBlocked || catalogUnresolved) return;
    if (rejectPhoneChange()) return;
    if (addressChanged || (geocodingResults.length > 0 && selectedGeocodingIndex === null)) {
      toast({ variant: 'destructive', title: '주소 저장 전 재지오코딩 필요',
        description: '주소와 지도 좌표를 함께 저장하려면 재지오코딩 후 주소를 선택해주세요.' });
      return;
    }
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      toast({ variant: 'destructive', title: '음식점명을 입력해주세요' });
      return;
    }
    catalogBusyRef.current = true;
    setCatalogBusy(true);
    setCatalogError(null);
    setCatalogOutcome(null);
    setCatalogConfirmation('');
    setCatalogEdit(null);
    try {
      const pending = pendingCatalogEdit(record.id);
      if (pending) {
        setCatalogEdit(LocalCatalogEditSession.restore(record.id, pending));
        setCatalogOutcome({ kind: 'pending', code: 'CATALOG_EDIT_READBACK_ONLY' });
        return;
      }
      const trimmedYoutubeLink = formData.youtube_link.trim();
      const trimmedTzuyangReview = formData.tzuyang_review.trim();
      const patch: CatalogEditPatch = {
        approved_name: trimmedName, categories: [...formData.categories],
        youtube_link: trimmedYoutubeLink || null,
        tzuyang_review: trimmedTzuyangReview || null,
      };
      if (selectedGeocodingIndex !== null && geocodingResults[selectedGeocodingIndex]) {
        const selected = geocodingResults[selectedGeocodingIndex];
        // Loaded location values are display context, not a requested edit.
        if (!selected.fromExistingRecord) {
          const lat = Number(selected.y);
          const lng = Number(selected.x);
          if (typeof selected.y !== 'string' || !selected.y.trim()
            || typeof selected.x !== 'string' || !selected.x.trim()
            || !Number.isFinite(lat) || lat < -90 || lat > 90
            || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw new Error('CATALOG_EDIT_LOCATION_INVALID');
          }
        Object.assign(patch, {
          lat, lng,
          road_address: selected.road_address || null,
          jibun_address: selected.jibun_address || null,
          english_address: selected.english_address || null,
        });
        }
      }
      setCatalogEdit(await LocalCatalogEditSession.prepare(record.id, patch));
    } catch (error) {
      setCatalogError(catalogEditMessage(error instanceof Error ? error.message : 'CATALOG_EDIT_UNAVAILABLE'));
    } finally {
      catalogBusyRef.current = false;
      setCatalogBusy(false);
    }
  };

  const handleCatalogAction = async (phase: 'apply' | 'readback') => {
    const operation = catalogEdit;
    if (!operation || catalogBusyRef.current || loading) return;
    if (phase === 'apply' && (catalogConfirmation !== '변경 적용' || rejectPhoneChange())) return;
    catalogBusyRef.current = true;
    setCatalogBusy(true);
    setCatalogError(null);
    try {
      const result = phase === 'apply'
        ? await operation.apply(catalogConfirmation)
        : await operation.readback();
      setCatalogOutcome(result);
      setCatalogConfirmation('');
      if (result.kind === 'rejected') {
        setCatalogEdit(null);
        setCatalogError(catalogEditMessage(result.code));
      }
      if (result.kind !== 'verified') {
        // Recover an existing ID rather than ever overwriting/retrying it.
        const pending = pendingCatalogEdit(operation.restaurantId);
        if (pending && (pending !== operation.operationId || result.kind === 'rejected')) {
          setCatalogEdit(LocalCatalogEditSession.restore(operation.restaurantId, pending));
          setCatalogOutcome({ kind: 'pending', code: 'CATALOG_EDIT_READBACK_ONLY' });
        }
      }
      // Do not invoke approval's onSuccess callback here: its parent can write
      // linked submissions. Verified catalog changes are refreshed explicitly.
    } catch {
      setCatalogOutcome({ kind: 'pending', code: 'CATALOG_EDIT_OUTCOME_UNKNOWN' });
    } finally {
      catalogBusyRef.current = false;
      setCatalogBusy(false);
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
    setSameVideoDuplicateWarnings([]);
    setRestaurantIdentityWarningRows([]);
  };

  const currentRestaurantIdentityWarnings: RestaurantIdentityWarning[] = record
    ? findRestaurantIdentityWarnings(record, restaurantIdentityWarningRows, {
        approvedNameOverride: formData.name,
      })
    : [];

  const notifySameVideoDuplicateWarning = (actionLabel: string) => {
    const message = formatSameVideoDuplicateWarning(sameVideoDuplicateWarnings);
    if (!message) return;

    toast({
      title: `같은 영상 중복 후보 확인 후 ${actionLabel}`,
      description: message,
    });
  };

  const notifyRestaurantIdentityWarning = (actionLabel: string) => {
    const message = formatRestaurantIdentityWarning(currentRestaurantIdentityWarnings);
    if (!message) return false;

    const hasBlockingWarning = hasBlockingRestaurantIdentityWarning(currentRestaurantIdentityWarnings);
    toast({
      variant: hasBlockingWarning ? 'destructive' : 'default',
      title: hasBlockingWarning ? `${actionLabel} 차단: 장소명 검증 필요` : `${actionLabel} 전 장소명 확인`,
      description: message,
    });

    return hasBlockingWarning;
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (loading || catalogBusyRef.current) return;
    if (!newOpen) {
      setCatalogEdit(null);
      setCatalogConfirmation('');
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const catalogRestaurantId = record?.id;
  useEffect(() => {
    if (!open || !catalogRestaurantId) return;
    setCatalogError(null);
    setCatalogOutcome(null);
    setCatalogConfirmation('');
    setCatalogRecoveryBlocked(false);
    try {
      const pending = pendingCatalogEdit(catalogRestaurantId);
      setCatalogEdit(pending ? LocalCatalogEditSession.restore(catalogRestaurantId, pending) : null);
      if (pending) setCatalogOutcome({ kind: 'pending', code: 'CATALOG_EDIT_READBACK_ONLY' });
    } catch {
      setCatalogRecoveryBlocked(true);
      setCatalogError(catalogEditMessage('CATALOG_EDIT_RECOVERY_UNAVAILABLE'));
    }
  }, [open, catalogRestaurantId]);

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
      const recordCategories = parseCategoryList(record.categories);
      if (recordCategories.length > 0) {
        initialCategories = recordCategories;
      }
      // 2. 아니면 기존 restaurant_info.category 사용 (단일)
      else {
        const legacyCategory = parseCategoryList(record.restaurant_info?.category);
        if (legacyCategory.length > 0) {
          initialCategories = legacyCategory;
        }
      }

      // 3. AI 제안 적용 (단, 관리자가 수정한 적이 없는 경우에만!)
      // updated_by_admin_id가 없으면 아직 관리자 손을 타지 않은 것으로 간주
      if (!record.updated_by_admin_id && record.evaluation_results?.category_TF?.eval_value === false) {
        const categoryRevision = record.evaluation_results.category_TF.category_revision;

        if (categoryRevision) {
          const revisionCategories = parseCategoryList(categoryRevision).filter(cat =>
            RESTAURANT_CATEGORIES.includes(cat as typeof RESTAURANT_CATEGORIES[number])
          );
          if (revisionCategories.length > 0) {
            initialCategories = revisionCategories;
          }
        }
      }



      setInitialAddress(address); // 원본 주소 저장
      setAddressChanged(false); // 주소 변경 여부 초기화

      setFormData({
        name: getAdminEvaluationDisplayName(record),
        address: address,
        phone: record.restaurant_info.phone || '',
        tzuyang_review: record.restaurant_info.tzuyang_review || '',
        categories: initialCategories, // 카테고리 배열 설정
        youtube_link: record.youtube_link || '', // 유튜브 링크 설정
      });

      // 기존 지오코딩 결과가 있다면 표시
      if (record.restaurant_info.naver_address_info) {
        try {
          const existingResult: GeocodingResult = {
            fromExistingRecord: true,
            road_address: record.restaurant_info.naver_address_info.road_address || '',
            jibun_address: record.restaurant_info.naver_address_info.jibun_address,
            english_address: record.restaurant_info.naver_address_info.english_address || '',
            address_elements: encodeJson(record.restaurant_info.naver_address_info.address_elements),
            x: record.restaurant_info.naver_address_info.x,
            y: record.restaurant_info.naver_address_info.y,
          };
          setGeocodingResults([existingResult]);
          setSelectedGeocodingIndex(0);
        } catch {
          setGeocodingResults([]);
          setSelectedGeocodingIndex(null);
        }
      } else {
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
      }
    }
  }, [open, record]);

  useEffect(() => {
    let cancelled = false;

    const currentYoutubeLink = formData.youtube_link.trim() || record?.youtube_link || '';

    if (!open || !record?.id || !currentYoutubeLink) {
      setSameVideoDuplicateWarnings([]);
      setRestaurantIdentityWarningRows([]);
      return;
    }

    fetchSameVideoDuplicateWarningCandidates({
      id: record.id,
      approved_name: record.approved_name,
      origin_name: record.origin_name,
      naver_name: record.naver_name,
      google_name: record.google_name,
      name: record.name,
      restaurant_name: record.restaurant_name,
      phone: record.phone || record.restaurant_info?.phone || null,
      status: record.status,
      road_address: record.road_address,
      jibun_address: record.jibun_address,
      youtube_link: currentYoutubeLink,
      updated_by_admin_id: record.updated_by_admin_id,
      lat: record.lat,
      lng: record.lng,
    })
      .then((candidates) => {
        if (!cancelled) setSameVideoDuplicateWarnings(candidates);
      })
      .catch((error) => {
        console.warn('같은 영상 중복 후보 조회 실패:');
        if (!cancelled) setSameVideoDuplicateWarnings([]);
      });

    void (async () => {
      const videoId = currentYoutubeLink.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1] || '';
      if (!videoId) {
        setRestaurantIdentityWarningRows([]);
        return;
      }

      const { data, error } = await supabase
        .from('restaurants')
        .select('id, approved_name, origin_name, naver_name, google_name, status, youtube_link, reasoning_basis, evaluation_results')
        .ilike('youtube_link', `%${videoId}%`)
        .overrideTypes<RestaurantIdentityWarningRow[], { merge: false }>();

      if (error) throw error;
      if (!cancelled) setRestaurantIdentityWarningRows(data ?? []);
    })().catch((error: unknown) => {
      console.warn('장소명 검증 경고 조회 실패:');
      if (!cancelled) setRestaurantIdentityWarningRows([]);
    });

    return () => {
      cancelled = true;
    };
  }, [formData.youtube_link, open, record]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`${ADMIN_MODAL_CONTENT_MD_FLEX} !overflow-hidden`}>
        <DialogHeader>
          <DialogTitle>맛집 정보 편집</DialogTitle>
          <DialogDescription>
            정보를 수정해 저장하거나, 재지오코딩 후 승인 처리할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
          <fieldset disabled={loading || catalogFieldsLocked} className="min-w-0 space-y-4">
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
            {currentRestaurantIdentityWarnings.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p className="font-semibold">장소명 검증 경고 {currentRestaurantIdentityWarnings.length}건</p>
                <p className="mt-1 text-xs leading-5">
                  {formatRestaurantIdentityWarning(currentRestaurantIdentityWarnings)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {currentRestaurantIdentityWarnings.slice(0, 3).map((warning) => (
                    <Badge key={warning.rule} variant="outline" className="border-red-300 bg-white/70 text-red-900">
                      {warning.severity === 'block' ? '차단' : '확인'} · {warning.rule}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {sameVideoDuplicateWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">같은 영상 중복 후보 {sameVideoDuplicateWarnings.length}건</p>
                <p className="mt-1 text-xs leading-5">
                  승인/삭제/수정 전 같은 맛집인지 확인하세요. 별도 필터는 만들지 않고 현재 작업 중에만 알려드립니다.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {sameVideoDuplicateWarnings.slice(0, 3).map((candidate) => (
                    <Badge key={candidate.id} variant="outline" className="border-amber-300 bg-white/70 text-amber-900">
                      {candidate.name} · {candidate.rule}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 레스토랑 이름 */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="p-2 bg-muted rounded-md border text-xs" title={record?.origin_name || ''}>
                <span className="block text-muted-foreground mb-0.5">Origin Name</span>
                <span className="font-medium text-foreground truncate block">{record?.origin_name || '-'}</span>
              </div>
              <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-100 dark:border-blue-800 text-xs" title={record?.naver_name || ''}>
                <span className="block text-blue-600 dark:text-blue-400 mb-0.5">Naver Name</span>
                <span className="font-medium text-foreground truncate block">{record?.naver_name || '-'}</span>
              </div>
              <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-md border border-orange-100 dark:border-orange-800 text-xs" title={record?.google_name || ''}>
                <span className="block text-orange-600 dark:text-orange-400 mb-0.5">Google Name</span>
                <span className="font-medium text-foreground truncate block">{record?.google_name || '-'}</span>
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
                  disabled={geocodingNaver || !formData.address.trim()}
                >
                  {geocodingNaver && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {!geocodingNaver && <RefreshCw className="mr-1 h-3 w-3" />}
                  네이버 지오코딩
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
                  <button
                    type="button"
                    key={index}
                    onClick={() => {
                      setSelectedGeocodingIndex(index);
                      // 선택된 옵션의 주소와 네이버 장소 검색 메타데이터를 실시간 업데이트
                      setFormData(prev => ({
                        ...prev,
                        address: result.jibun_address,
                        ...(result.place_name ? { name: result.place_name } : {}),
                      }));
                      setInitialAddress(result.jibun_address);
                      setAddressChanged(false);
                    }}
                    className={`w-full text-left p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedGeocodingIndex === index
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 hover:border-gray-300 bg-white dark:bg-gray-800'
                      }`}
                    aria-label={`지오코딩 옵션 ${index + 1} 선택`}
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
                      {result.place_name && (
                        <div>
                          <span className="font-medium text-gray-700 dark:text-gray-300">상호: </span>
                          <span className="text-gray-600 dark:text-gray-400">{result.place_name}</span>
                        </div>
                      )}
                      {result.place_phone && (
                        <div>
                          <span className="font-medium text-gray-700 dark:text-gray-300">전화: </span>
                          <span className="text-gray-600 dark:text-gray-400">{result.place_phone}</span>
                        </div>
                      )}
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
                  </button>
                ))}
              </div>

              {selectedGeocodingIndex === null && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  위 옵션 중 하나를 클릭해서 선택해주세요
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
              aria-describedby="edit-phone-unsupported"
            />
            <p id="edit-phone-unsupported" className="text-sm text-muted-foreground">
              전화번호 변경은 지원하지 않으며 저장하지 않습니다.
              {phoneChanged && ' 기존 값으로 되돌린 후 진행해주세요.'}
            </p>
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
                    {(() => {
                      const existingCategories = parseCategoryList(record?.categories);
                      const legacyCategory = parseCategoryList(record?.restaurant_info?.category);

                      if (existingCategories.length > 0) {
                        return existingCategories.map((cat, idx) => (
                          <Badge key={idx} variant="outline">{cat}</Badge>
                        ));
                      }

                      if (legacyCategory.length > 0) {
                        return legacyCategory.map((cat, idx) => (
                          <Badge key={idx} variant="outline">{cat}</Badge>
                        ));
                      }

                      return <span className="text-sm text-muted-foreground">없음</span>;
                    })()}
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
                      (() => {
                        const revisionCategories = parseCategoryList(record.evaluation_results?.category_TF.category_revision).filter(cat =>
                          RESTAURANT_CATEGORIES.includes(cat as typeof RESTAURANT_CATEGORIES[number])
                        );

                        if (revisionCategories.length === 0) {
                          return (
                            <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900">
                              {record.evaluation_results?.category_TF?.category_revision}
                            </Badge>
                          );
                        }

                        return (
                          <div className="flex flex-wrap gap-1">
                            {revisionCategories.map((cat: string, idx: number) => (
                              <Badge key={idx} variant="secondary" className="bg-blue-100 dark:bg-blue-900">{cat}</Badge>
                            ))}
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-sm text-muted-foreground">제안 없음</span>
                    )}
                  {record?.evaluation_results?.category_TF?.eval_basis && (
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      {record.evaluation_results.category_TF.eval_basis}
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
          </fieldset>

          {catalogError && <p role="alert" className="rounded-md border p-3 text-sm text-destructive">{catalogError}</p>}
          {catalogEdit && (
            <section aria-label="로컬 변경 미리보기" className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <h3 className="font-semibold">로컬 맛집 정보 변경</h3>
              <p className="text-sm text-muted-foreground">승인 상태와 전화번호는 변경하지 않습니다.</p>
              <p className="break-all text-xs text-muted-foreground">작업 번호: {catalogEdit.operationId}</p>
              {catalogEdit.preview && (
                <>
                  <p className="text-sm">아래 미리보기에 표시된 내용만 적용됩니다. 입력란을 다시 수정했다면 미리보기를 취소하고 새로 확인해주세요.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed text-left text-sm">
                      <caption className="sr-only">로컬 맛집 정보 변경 전후 비교</caption>
                      <thead><tr><th scope="col" className="w-1/5 p-2">항목</th><th scope="col" className="p-2">변경 전</th><th scope="col" className="p-2">변경 후</th></tr></thead>
                      <tbody>{catalogEditFields.filter(key => Object.hasOwn(catalogEdit.preview!.after, key)).map(key => (
                        <tr key={key} className="border-t align-top">
                          <th scope="row" className="break-words p-2 font-medium">{catalogFieldLabels[key]}</th>
                          <td className="whitespace-pre-wrap break-words p-2">{catalogDisplayValue(catalogEdit.preview!.before[key])}</td>
                          <td className="whitespace-pre-wrap break-words p-2">{catalogDisplayValue(catalogEdit.preview!.after[key])}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>
              )}
              {!catalogEdit.readbackOnly && (
                <>
                  <Label htmlFor="catalog-edit-confirmation">확인 문구: 변경 적용</Label>
                  <Input id="catalog-edit-confirmation" autoComplete="off" value={catalogConfirmation}
                    onChange={event => setCatalogConfirmation(event.target.value)} disabled={catalogBusy}
                    placeholder="변경 적용" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={catalogBusy} onClick={() => {
                      setCatalogEdit(null); setCatalogConfirmation(''); setCatalogOutcome(null);
                    }}>미리보기 취소</Button>
                    <Button type="button" disabled={catalogBusy || catalogConfirmation !== '변경 적용' || phoneChanged}
                      onClick={() => void handleCatalogAction('apply')}>
                      {catalogBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}변경 적용
                    </Button>
                  </div>
                </>
              )}
              {catalogOutcome?.kind === 'verified' ? (
                <div role="status" className="space-y-2 text-sm">
                  <p className="font-medium">저장 결과 확인 완료</p>
                  <dl>{catalogEditFields.filter(key => Object.hasOwn(catalogOutcome.values, key)).map(key => (
                    <div key={key} className="py-1"><dt className="font-medium">{catalogFieldLabels[key]}</dt>
                      <dd className="whitespace-pre-wrap break-words">{catalogDisplayValue(catalogOutcome.values[key])}</dd></div>
                  ))}</dl>
                  <Button type="button" onClick={() => {
                    onCatalogSaved(catalogEdit.restaurantId, catalogOutcome.values);
                    onOpenChange(false);
                  }}>완료 · 목록에 반영</Button>
                </div>
              ) : catalogEdit.readbackOnly && (
                <div className="space-y-2">
                  <p role="status" className="text-sm">{catalogEditMessage(catalogOutcome?.kind === 'pending' ? catalogOutcome.code : 'CATALOG_EDIT_OUTCOME_UNKNOWN')}</p>
                  <p className="text-xs text-muted-foreground">작업 번호를 보관했습니다. 이 창을 다시 열어도 재적용 없이 같은 작업의 결과만 확인합니다.</p>
                  <Button type="button" variant="outline" disabled={catalogBusy} onClick={() => void handleCatalogAction('readback')}>
                    {catalogBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}결과 확인
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>

        <DialogFooter className={`${ADMIN_MODAL_FOOTER_DIVIDER} shrink-0 bg-background`}>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading || catalogBusy}
            className={ADMIN_MODAL_ACTION}
          >
            닫기
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSave}
            disabled={loading || catalogBusy || geocodingNaver || catalogEdit !== null || catalogRecoveryBlocked}
            className={ADMIN_MODAL_ACTION}
          >
            {catalogBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            변경 미리보기
          </Button>
          <Button
            onClick={handleApprove}
            disabled={loading || catalogBusy || catalogEdit !== null || catalogRecoveryBlocked || phoneChanged || geocodingResults.length === 0 || selectedGeocodingIndex === null}
            className={ADMIN_MODAL_ACTION}
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
        <AlertDialogContent className={ADMIN_MODAL_CONTENT_SM}>
          <AlertDialogHeader>
            <AlertDialogTitle>승인 확인</AlertDialogTitle>
            <AlertDialogDescription className={`space-y-2 ${ADMIN_MODAL_SCROLL_BODY}`}>
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
          <AlertDialogFooter className={ADMIN_MODAL_FOOTER}>
            <AlertDialogCancel disabled={loading} className={ADMIN_MODAL_ACTION}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setShowApprovalConfirm(false);
                setLoading(true);
                try {
                  await performApproval(requireAdminUserId());
                } catch (error) {
                  console.error('승인 실패:');
                  toast({
                    variant: 'destructive',
                    title: '승인 실패',
                    description: '승인 처리에 실패했습니다. 관리자 권한과 입력 내용을 확인해주세요.',
                  });
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className={ADMIN_MODAL_ACTION}
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
