import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EvaluationRecord } from '@/types/evaluation';
import { checkDbConflict, mergeRestaurantData } from '@/lib/db-conflict-checker';
import { Badge } from '@/components/ui/badge';
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

const CATEGORY_OPTIONS = [
  '한식',
  '일식',
  '중식',
  '양식',
  '아시안',
  '치킨',
  '피자',
  '햄버거',
  '분식',
  '카페/디저트',
  '베이커리',
  '술집',
  '뷔페',
  '고기/구이',
  '기타',
];

interface MissingRestaurantFormProps {
  record: EvaluationRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (recordId: string, updates: Partial<EvaluationRecord>) => void;
}

interface FormData {
  name: string;
  address: string;
  phone: string;
  category: string;
  tzuyang_review: string;
}

interface NaverGeocodingResponse {
  addresses?: Array<{
    roadAddress: string;
    jibunAddress: string;
    englishAddress: string;
    addressElements: any[];
    x: string;
    y: string;
  }>;
  errorMessage?: string;
}

export function MissingRestaurantForm({ record, open, onOpenChange, onSuccess }: MissingRestaurantFormProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    address: '',
    phone: '',
    category: '',
    tzuyang_review: '',
  });
  
  // 지오코딩 결과 상태
  const [geocodingResult, setGeocodingResult] = useState<{
    success: boolean;
    data?: {
      road_address: string;
      jibun_address: string;
      english_address: string;
      address_elements: any;
      x: string;
      y: string;
    };
    error?: string;
  } | null>(null);
  
  // DB 충돌 경고 다이얼로그 상태
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);
  const [pendingGeocodingData, setPendingGeocodingData] = useState<any>(null);
  const [pendingFormData, setPendingFormData] = useState<{
    name: string;
    phone: string;
    category: string;
    tzuyang_review: string;
  } | null>(null);

  // record가 변경될 때 폼 데이터 초기화 (쯔양 리뷰 포함)
  useEffect(() => {
    if (record && record.restaurant_info) {
      setFormData({
        name: record.restaurant_info.name || '',
        address: record.restaurant_info.origin_address || '',
        phone: record.restaurant_info.phone || '',
        category: record.restaurant_info.category || '',
        tzuyang_review: record.restaurant_info.tzuyang_review || '',
      });
    }
  }, [record]);

  // 재지오코딩 핸들러
  const handleReGeocode = async () => {
    const trimmedAddress = formData.address.trim();
    
    if (!trimmedAddress) {
      toast({
        variant: 'destructive',
        title: '주소를 입력해주세요',
      });
      return;
    }

    try {
      setGeocoding(true);
      const result = await geocodeAddress(trimmedAddress);
      setGeocodingResult(result);

      if (result.success) {
        toast({
          title: '지오코딩 성공',
          description: '주소가 성공적으로 변환되었습니다.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: '지오코딩 실패',
          description: result.error || '주소를 좌표로 변환할 수 없습니다.',
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: '지오코딩 실패',
        description: error.message,
      });
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;

    // 지오코딩 결과 확인
    if (!geocodingResult || !geocodingResult.success) {
      toast({
        variant: 'destructive',
        title: '지오코딩 필요',
        description: '먼저 주소를 지오코딩해주세요.',
      });
      return;
    }

    try {
      setLoading(true);

      // 입력값 trim
      const trimmedName = formData.name.trim();
      const trimmedPhone = formData.phone.trim();
      const trimmedCategory = formData.category.trim();
      const trimmedTzuyangReview = formData.tzuyang_review.trim();

      // 필수 입력 검증
      if (!trimmedName || !trimmedCategory) {
        toast({
          variant: 'destructive',
          title: '필수 항목을 입력해주세요',
          description: '음식점명과 카테고리는 필수입니다.',
        });
        setLoading(false);
        return;
      }

      // DB 충돌 체크 (새로운 로직) - trim된 값 사용
      const conflictCheck = await checkDbConflict({
        jibunAddress: geocodingResult.data!.jibun_address,
        restaurantName: trimmedName,
        youtubeLink: record.youtube_link,
      });

      if (conflictCheck.hasConflict) {
        if (conflictCheck.conflictType === 'name_mismatch') {
          // 충돌 타입 1: 같은 주소 + 같은 youtube_link + 다른 음식점명
          setPendingGeocodingData(geocodingResult.data);
          setPendingFormData({
            name: trimmedName,
            phone: trimmedPhone,
            category: trimmedCategory,
            tzuyang_review: trimmedTzuyangReview,
          });
          setConflictData(conflictCheck.conflictingRestaurants);
          setShowConflictWarning(true);
          setLoading(false);
          return;
        } else if (conflictCheck.conflictType === 'merge_needed') {
          // 충돌 타입 2: 같은 주소 + 같은 음식점명 → 자동 병합
          await handleMerge(conflictCheck.conflictingRestaurants![0], geocodingResult.data, trimmedName, trimmedPhone, trimmedCategory, trimmedTzuyangReview);
          return;
        }
      }

      // 충돌 없음 → 새 레스토랑 등록
      await registerNewRestaurant(geocodingResult.data, trimmedName, trimmedPhone, trimmedCategory, trimmedTzuyangReview);

    } catch (error: any) {
      console.error('레스토랑 등록 실패:', error);
      toast({
        variant: 'destructive',
        title: '등록 실패',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // 병합 처리 함수
  const handleMerge = async (existingRestaurant: any, geocodingData: any, trimmedName: string, trimmedPhone: string, trimmedCategory: string, trimmedTzuyangReview: string) => {
    try {
      const mergeResult = await mergeRestaurantData({
        existingRestaurant,
        newYoutubeLink: record!.youtube_link,
        newYoutubeMeta: record!.youtube_meta,
        newTzuyangReview: trimmedTzuyangReview || record!.restaurant_info?.tzuyang_review,
        newCategory: trimmedCategory,
      });

      if (!mergeResult.success) {
        throw new Error(mergeResult.error);
      }

      // evaluation_record 상태 업데이트
      const { error: updateError } = await supabase
        .from('evaluation_records')
        .update({
          status: 'approved',
          processed_at: new Date().toISOString(),
        })
        .eq('id', record!.id);

      if (updateError) throw updateError;

      toast({
        title: '병합 완료',
        description: `${trimmedName} 레스토랑에 영상 링크가 병합되었습니다.`,
      });

      onSuccess(record!.id, {
        status: 'approved',
        processed_at: new Date().toISOString(),
      });
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: '병합 실패',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // 새 레스토랑 등록 함수
  const registerNewRestaurant = async (geocodingData: any, trimmedName: string, trimmedPhone: string, trimmedCategory: string, trimmedTzuyangReview: string) => {
    try {
      const { error: insertError } = await supabase
        .from('restaurants')
        .insert({
          name: trimmedName,
          road_address: geocodingData.road_address,
          jibun_address: geocodingData.jibun_address,
          english_address: geocodingData.english_address,
          address_elements: geocodingData.address_elements,
          lat: parseFloat(geocodingData.y),
          lng: parseFloat(geocodingData.x),
          phone: trimmedPhone || null,
          category: [trimmedCategory],
          youtube_links: [record!.youtube_link],
          youtube_metas: record!.youtube_meta ? [record!.youtube_meta] : [],
          tzuyang_reviews: trimmedTzuyangReview ? [trimmedTzuyangReview] : (record!.restaurant_info?.tzuyang_review ? [record!.restaurant_info.tzuyang_review] : []),
        });

      if (insertError) throw insertError;

      // evaluation_record 상태 업데이트
      const { error: updateError } = await supabase
        .from('evaluation_records')
        .update({
          status: 'approved',
          processed_at: new Date().toISOString(),
        })
        .eq('id', record!.id);

      if (updateError) throw updateError;

      toast({
        title: '등록 완료',
        description: `${trimmedName} 레스토랑이 성공적으로 등록되었습니다.`,
      });

      onSuccess(record!.id, {
        status: 'approved',
        processed_at: new Date().toISOString(),
      });
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: '등록 실패',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // DB 충돌 경고 후 강제 등록
  const handleForceRegister = async () => {
    setShowConflictWarning(false);
    if (pendingGeocodingData && pendingFormData) {
      await registerNewRestaurant(
        pendingGeocodingData, 
        pendingFormData.name, 
        pendingFormData.phone, 
        pendingFormData.category, 
        pendingFormData.tzuyang_review
      );
    }
  };

  const geocodeAddress = async (address: string): Promise<{ 
    success: boolean; 
    data?: { 
      road_address: string; 
      jibun_address: string; 
      english_address: string; 
      address_elements: any; 
      x: string; 
      y: string; 
    }; 
    error?: string 
  }> => {
    try {
      // 관리자 재지오코딩용 - 본인의 NCP Maps API 키 사용
      const clientId = import.meta.env.VITE_NCP_MAPS_KEY_ID;
      const clientSecret = import.meta.env.VITE_NCP_MAPS_KEY;

      if (!clientId || !clientSecret) {
        return { success: false, error: 'Naver 지오코딩 API 키가 설정되지 않았습니다.' };
      }

      const url = `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`;

      const response = await fetch(url, {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': clientId,
          'X-NCP-APIGW-API-KEY': clientSecret,
        },
      });

      const data: NaverGeocodingResponse = await response.json();

      if (data.errorMessage) {
        return { success: false, error: data.errorMessage };
      }

      if (!data.addresses || data.addresses.length === 0) {
        return { success: false, error: '주소를 찾을 수 없습니다.' };
      }

      const address_data = data.addresses[0];
      return {
        success: true,
        data: {
          road_address: address_data.roadAddress,
          jibun_address: address_data.jibunAddress,
          english_address: address_data.englishAddress,
          address_elements: address_data.addressElements,
          x: address_data.x,
          y: address_data.y,
        },
      };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      phone: '',
      category: '',
      tzuyang_review: '',
    });
    setGeocodingResult(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Missing 레스토랑 등록</DialogTitle>
          <DialogDescription>
            AI가 찾지 못한 레스토랑을 수동으로 등록합니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
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
              <Label htmlFor="name">레스토랑 이름 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="예: 홍대 떡볶이"
                required
              />
            </div>

            {/* 주소 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="address">주소 *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReGeocode}
                  disabled={geocoding || !formData.address.trim()}
                >
                  {geocoding ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      지오코딩 중...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      재지오코딩
                    </>
                  )}
                </Button>
              </div>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, address: e.target.value }));
                  // 주소가 변경되면 지오코딩 결과 초기화
                  setGeocodingResult(null);
                }}
                placeholder="예: 서울특별시 마포구 양화로 160"
                required
                rows={2}
              />
              
              {/* 지오코딩 결과 표시 */}
              {geocodingResult && geocodingResult.success && geocodingResult.data && (
                <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-600">지오코딩 성공</Badge>
                  </div>
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="font-medium">도로명: </span>
                      <span className="text-muted-foreground">{geocodingResult.data.road_address}</span>
                    </div>
                    <div>
                      <span className="font-medium">지번: </span>
                      <span className="text-muted-foreground">{geocodingResult.data.jibun_address}</span>
                    </div>
                    <div>
                      <span className="font-medium">영어 주소: </span>
                      <span className="text-muted-foreground">{geocodingResult.data.english_address}</span>
                    </div>
                    <div>
                      <span className="font-medium">좌표: </span>
                      <span className="text-muted-foreground">
                        위도 {geocodingResult.data.y}, 경도 {geocodingResult.data.x}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {geocodingResult && !geocodingResult.success && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <Badge variant="destructive">지오코딩 실패</Badge>
                  <p className="text-sm text-red-600 mt-1">{geocodingResult.error}</p>
                </div>
              )}
            </div>

            {/* 전화번호 */}
            <div className="space-y-2">
              <Label htmlFor="phone">전화번호</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="예: 02-1234-5678"
              />
            </div>

            {/* 카테고리 */}
            <div className="space-y-2">
              <Label htmlFor="category">카테고리 *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="카테고리 선택" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(cat => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 쯔양 리뷰 */}
            <div className="space-y-2">
              <Label htmlFor="tzuyang_review">쯔양 리뷰</Label>
              <Textarea
                id="tzuyang_review"
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
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              등록
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {/* DB 충돌 경고 다이얼로그 */}
    <AlertDialog open={showConflictWarning} onOpenChange={setShowConflictWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>⚠️ DB 충돌 감지</AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <p className="font-semibold text-destructive">
              음식점의 주소와 영상 링크(youtube_link)가 같지만, 음식점명이 다릅니다.
            </p>
            
            {conflictData && conflictData.length > 0 && (
              <div className="space-y-3">
                <div className="border rounded-lg p-3 bg-muted">
                  <p className="text-sm font-semibold mb-2">🆕 등록하려는 데이터:</p>
                  <ul className="text-sm space-y-1 ml-4">
                    <li>• 음식점명: <span className="font-medium">{formData.name}</span></li>
                    <li>• 주소: <span className="font-medium">{formData.address}</span></li>
                    <li>• YouTube: <span className="font-medium text-xs">{record?.youtube_link}</span></li>
                  </ul>
                </div>

                <div className="border rounded-lg p-3 bg-destructive/10">
                  <p className="text-sm font-semibold mb-2">🗄️ 기존 데이터베이스:</p>
                  {conflictData.map((restaurant: any, idx: number) => (
                    <div key={idx} className="ml-4 mb-3">
                      <ul className="text-sm space-y-1">
                        <li>• 음식점명: <span className="font-medium">{restaurant.name}</span></li>
                        <li>• 지번주소: <span className="font-medium">{restaurant.jibun_address}</span></li>
                        <li>• 전화번호: <span className="font-medium">{restaurant.phone || '-'}</span></li>
                        <li>• YouTube 링크 수: <span className="font-medium">{restaurant.youtube_links?.length || 0}개</span></li>
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <p className="text-sm">
              그대로 승인하시겠습니까?
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={handleForceRegister} className="bg-destructive hover:bg-destructive/90">
            승인
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  );
}
