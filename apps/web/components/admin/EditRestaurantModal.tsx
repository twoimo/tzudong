import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { EvaluationRecord } from '@/types/evaluation';
import { Badge } from '@/components/ui/badge';
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
import { getAdminEvaluationDisplayName } from '@/lib/admin-evaluation-name';
import { decodeBasicHtmlEntities, stripUnsafeMarkup } from '@/lib/html-escape';
import {
  canAutoSoftDeleteDuplicateSource,
  findActiveRestaurantIdentityConflict,
  formatActiveRestaurantIdentityConflictMessage,
} from '@/lib/admin-restaurant-update-conflict';
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
import { useRecordAction } from '@/lib/admin/use-record-action';
import { isRecordActionCancelled, recordActionErrorMessage } from '@/lib/admin/record-action-client';
import type { RecordActionReceipt, RestaurantRecordChanges } from '@/lib/admin/record-action-contract';
import { isEvaluationRecordStatus, normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '@/lib/admin/normalize-evaluation-record';
import { normalizeCanonicalYouTubeWatchUrl } from '@/lib/youtube-url';
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
    addressElements: unknown;
    x: string;
    y: string;
  }>;
  errorMessage?: string;
}

type NaverGeocodingAddress = NonNullable<NaverGeocodingResponse['addresses']>[number];

interface GeocodingResult {
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

const getErrorMessage = (error: unknown, fallback: string) => {
  void error;
  return fallback;
};

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

export function EditRestaurantModal(props: EditRestaurantModalProps) {
  return props.open ? <EditRestaurantEditor {...props} /> : null;
}

function EditRestaurantEditor({ record: incomingRecord, open, onOpenChange, onSuccess }: EditRestaurantModalProps) {
  // A refreshed parent row must not replace an open draft or its mutation target.
  const [record] = useState(incomingRecord);
  const { toast } = useToast();
  const [working, setLoading] = useState(false);
  const [confirmedReceipt, setConfirmedReceipt] = useState<RecordActionReceipt | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const initialFormRef = useRef('');
  const initializedRef = useRef(false);
  const refreshAfterAction = async (receipt: RecordActionReceipt) => {
    if (!record) return;
    setConfirmedReceipt(receipt);
    try {
      const response = await fetch(`/api/admin/evaluations/${encodeURIComponent(record.id)}`, { cache: 'no-store' });
      const value = response.ok ? await response.json() : null;
      const current = normalizeEvaluationRecord(value?.record);
      if (!current || current.id !== record.id || current.read_summary || (value?.record?.name !== null && typeof value?.record?.name !== 'string') || !isEvaluationRecordStatus(value?.record?.status) || !Number.isFinite(Date.parse(value?.record?.updated_at))) throw new Error('RECORD_CURRENT_READ_FAILED');
      onSuccess(record.id, withAdminEvaluationDisplayName(current));
      toast({ title: '작업 결과 확인 완료' });
      onOpenChange(false);
    } catch {
      toast({ variant: 'destructive', title: '적용은 확인되었습니다', description: '현재 정보 조회에 실패했습니다. 저장을 반복하지 말고 다시 불러와 주세요.' });
    }
  };
  const recordActions = useRecordAction(receipt => {
    if (record && receipt.targetIds.includes(record.id)) void refreshAfterAction(receipt);
  });
  const loading = working || recordActions.busy || confirmedReceipt !== null;

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
  const [geocodingDirty, setGeocodingDirty] = useState(false);
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
      setGeocodingDirty(true);
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

        throw new Error('NAVER_GEOCODE_REQUEST_FAILED');
      }

      if (!data) {

        return [];
      }

      if (data.error) {

        throw new Error('NAVER_GEOCODE_PROVIDER_FAILED');
      }



      if (!data.addresses || data.addresses.length === 0) {

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

      throw error; // 에러를 다시 throw하여 상위에서 처리
    }
  };

  const buildChanges = (forApproval = false): RestaurantRecordChanges => {
    const initial = JSON.parse(initialFormRef.current || '{}') as Partial<typeof formData>;
    const selected = selectedGeocodingIndex === null ? undefined : geocodingResults[selectedGeocodingIndex];
    const changes: RestaurantRecordChanges = {};
    if (forApproval || formData.name.trim() !== initial.name?.trim()) changes.approved_name = formData.name.trim();
    if (formData.phone.trim() !== initial.phone?.trim()) changes.phone = formData.phone.trim() || null;
    if (forApproval || JSON.stringify(formData.categories) !== JSON.stringify(initial.categories)) changes.categories = formData.categories as RestaurantRecordChanges['categories'];
    if (formData.youtube_link.trim() !== initial.youtube_link?.trim()) {
      const youtube = formData.youtube_link.trim();
      changes.youtube_link = youtube ? normalizeCanonicalYouTubeWatchUrl(youtube) || youtube : null;
    }
    if (formData.tzuyang_review.trim() !== initial.tzuyang_review?.trim()) changes.tzuyang_review = formData.tzuyang_review.trim() || null;
    if (selected && (forApproval || geocodingDirty)) Object.assign(changes, {
      road_address: selected.road_address, jibun_address: selected.jibun_address,
      english_address: selected.english_address, address_elements: selected.address_elements,
      lat: Number(selected.y), lng: Number(selected.x), geocoding_success: true,
    });
    // An unchanged legacy link, empty classification or incomplete location is not rewritten by an unrelated edit.
    return changes;
  };

  const performApproval = async () => {
    if (!record) return;
    await refreshAfterAction(await recordActions.run({ action: 'restaurant.approve', targetIds: [record.id], payload: { changes: buildChanges(true) } }));
  };

  const handleApprove = async () => {
    if (!record || loading) return;
    if (addressChanged || selectedGeocodingIndex === null || !geocodingResults[selectedGeocodingIndex]) {
      toast({ variant: 'destructive', title: '승인 불가', description: '주소를 재지오코딩하고 결과를 선택해주세요.' });
      return;
    }
    if (!formData.name.trim() || notifyRestaurantIdentityWarning('승인')) return;
    setLoading(true);
    try {
      notifySameVideoDuplicateWarning('승인');
      const selected = geocodingResults[selectedGeocodingIndex];
      const duplicate = await checkRestaurantDuplicate(formData.name.trim(), selected.jibun_address, record.id, formData.youtube_link.trim() || record.youtube_link);
      if (duplicate.isDuplicate && duplicate.matchedRestaurant) {
        const currentVideo = normalizeCanonicalYouTubeWatchUrl(formData.youtube_link || record.youtube_link);
        const otherVideo = normalizeCanonicalYouTubeWatchUrl(duplicate.matchedRestaurant.youtube_link);
        if (currentVideo && currentVideo === otherVideo) {
          toast({ variant: 'destructive', title: '중복 오류', description: '같은 음식점과 영상의 활성 레코드가 있습니다. 기존 항목을 확인해주세요.' });
          return;
        }
        setConflictingRestaurantInfo({ name: duplicate.matchedRestaurant.name, address: duplicate.matchedRestaurant.jibun_address || duplicate.matchedRestaurant.road_address || '' });
        setShowApprovalConfirm(true);
        return;
      }
      await performApproval();
    } catch (error) {
      if (!isRecordActionCancelled(error)) toast({ variant: 'destructive', title: '승인 실패', description: recordActionErrorMessage(error) });
    } finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!record || loading) return;
    if (!formData.name.trim()) { toast({ variant: 'destructive', title: '음식점명을 입력해주세요' }); return; }
    if (addressChanged) {
      toast({ variant: 'destructive', title: '주소 저장 전 재지오코딩 필요', description: '변경한 주소를 재지오코딩하고 결과를 선택해주세요.' });
      return;
    }
    setLoading(true);
    try {
      notifySameVideoDuplicateWarning('저장');
      const conflict = await findActiveRestaurantIdentityConflict({ restaurantId: record.id, restaurantName: formData.name.trim(), youtubeLink: formData.youtube_link.trim() || record.youtube_link || null });
      if (conflict) {
        if (canAutoSoftDeleteDuplicateSource(record)) {
          // Duplicate cleanup remains available, with its own explicit preview and confirmation.
          await refreshAfterAction(await recordActions.run({ action: 'restaurant.delete', targetIds: [record.id], payload: { reason: '승인된 동일 음식점·영상의 중복 대기 레코드 정리' } }));
        } else {
          toast({ variant: 'destructive', title: '중복 레코드 충돌', description: formatActiveRestaurantIdentityConflictMessage({ restaurantName: formData.name.trim(), conflict }) });
        }
        return;
      }
      const changes = buildChanges();
      if (Object.keys(changes).length === 0) { toast({ title: '변경한 내용이 없습니다' }); return; }
      await refreshAfterAction(await recordActions.run({ action: 'restaurant.edit', targetIds: [record.id], payload: { changes } }));
    } catch (error) {
      if (!isRecordActionCancelled(error)) toast({ variant: 'destructive', title: '저장 실패', description: recordActionErrorMessage(error) });
    } finally { setLoading(false); }
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
    if (loading || geocodingNaver) return;
    if (!newOpen && (JSON.stringify(formData) !== initialFormRef.current || geocodingDirty)) { setDiscardOpen(true); return; }
    onOpenChange(newOpen);
  };

  // Modal이 열릴 때 초기화
  useEffect(() => {
    if (open && record && record.restaurant_info && !initializedRef.current) {
      initializedRef.current = true;
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

      const initialForm = {
        name: getAdminEvaluationDisplayName(record),
        address: address,
        phone: record.restaurant_info.phone || '',
        tzuyang_review: record.restaurant_info.tzuyang_review || '',
        categories: initialCategories, // 카테고리 배열 설정
        youtube_link: record.youtube_link || '', // 유튜브 링크 설정
      };
      initialFormRef.current = JSON.stringify(initialForm);
      setFormData(initialForm);

      // 기존 지오코딩 결과가 있다면 표시
      if (record.restaurant_info.naver_address_info) {
        try {
          const existingResult: GeocodingResult = {
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

      if (!cancelled) setRestaurantIdentityWarningRows([]);
    });

    return () => {
      cancelled = true;
    };
  }, [formData.youtube_link, open, record]);

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`${ADMIN_MODAL_CONTENT_MD_FLEX} !overflow-hidden`} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>맛집 정보 편집</DialogTitle>
          <DialogDescription>
            정보를 수정해 저장하거나, 재지오코딩 후 승인 처리할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={loading || geocodingNaver} className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
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
                      setGeocodingDirty(true);
                      setSelectedGeocodingIndex(index);
                      // 선택된 옵션의 주소와 네이버 장소 검색 메타데이터를 실시간 업데이트
                      setFormData(prev => ({
                        ...prev,
                        address: result.jibun_address,
                        ...(result.place_name ? { name: result.place_name } : {}),
                        ...(result.place_phone ? { phone: result.place_phone } : {}),
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
        {confirmedReceipt && <Button variant="outline" onClick={() => void refreshAfterAction(confirmedReceipt)}>현재 정보 다시 불러오기</Button>}

        <DialogFooter className={`${ADMIN_MODAL_FOOTER_DIVIDER} shrink-0 bg-background`}>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
            className={ADMIN_MODAL_ACTION}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSave}
            disabled={loading}
            className={ADMIN_MODAL_ACTION}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            저장
          </Button>
          <Button
            onClick={handleApprove}
            disabled={loading || geocodingResults.length === 0 || selectedGeocodingIndex === null}
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
                  await performApproval();
                } catch (error) {
                  if (isRecordActionCancelled(error)) return;
                  toast({
                    variant: 'destructive',
                    title: '승인 실패',
                    description: recordActionErrorMessage(error),
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
    {recordActions.dialog}
    <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent className={ADMIN_MODAL_CONTENT_SM}>
      <AlertDialogHeader><AlertDialogTitle>변경 내용을 버릴까요?</AlertDialogTitle><AlertDialogDescription>저장하지 않은 편집 내용이 있습니다.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><AlertDialogAction onClick={() => onOpenChange(false)}>변경 버리기</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    </>
  );
}
