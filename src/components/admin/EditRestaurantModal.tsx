import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EvaluationRecord } from '@/types/evaluation';
import { Badge } from '@/components/ui/badge';

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
    addressElements: any[];
    x: string;
    y: string;
  }>;
  errorMessage?: string;
}

export function EditRestaurantModal({ record, open, onOpenChange, onSuccess }: EditRestaurantModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    address: '',
    phone: '',
    tzuyang_review: '',
  });
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

  useEffect(() => {
    if (record && record.restaurant_info) {
      setFormData({
        name: record.restaurant_info.name,
        address: record.restaurant_info.naver_address_info?.jibun_address || record.restaurant_info.origin_address,
        phone: record.restaurant_info.phone || '',
        tzuyang_review: record.restaurant_info.tzuyang_review || '',
      });
      
      // 기존 지오코딩 결과가 있다면 표시
      if (record.restaurant_info.naver_address_info) {
        setGeocodingResult({
          success: true,
          data: {
            road_address: record.restaurant_info.naver_address_info.road_address || '',
            jibun_address: record.restaurant_info.naver_address_info.jibun_address,
            english_address: record.restaurant_info.naver_address_info.english_address || '',
            address_elements: record.restaurant_info.naver_address_info.address_elements,
            x: record.restaurant_info.naver_address_info.x,
            y: record.restaurant_info.naver_address_info.y,
          },
        });
      }
    }
  }, [record]);

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
    error?: string;
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

  const handleApprove = async () => {
    if (!record) return;

    if (!geocodingResult || !geocodingResult.success) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '먼저 주소를 지오코딩해주세요.',
      });
      return;
    }

    try {
      setLoading(true);

      const { data: existingRestaurants, error: searchError } = await supabase
        .from('restaurants')
        .select('id, name, jibun_address')
        .eq('jibun_address', geocodingResult.data!.jibun_address);

      if (searchError) throw searchError;

      if (existingRestaurants && existingRestaurants.length > 0) {
        toast({
          variant: 'destructive',
          title: '중복 레스토랑 존재',
          description: `같은 주소(${geocodingResult.data!.jibun_address})의 레스토랑이 이미 존재합니다: ${existingRestaurants[0].name}`,
        });
        return;
      }

      // 새 레스토랑 등록
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

      const { data: newRestaurant, error: insertError } = await supabase
        .from('restaurants')
        .insert({
          name: trimmedName,
          road_address: geocodingResult.data!.road_address,
          jibun_address: geocodingResult.data!.jibun_address,
          english_address: geocodingResult.data!.english_address,
          address_elements: geocodingResult.data!.address_elements,
          lat: parseFloat(geocodingResult.data!.y),
          lng: parseFloat(geocodingResult.data!.x),
          phone: trimmedPhone || null,
          category: record.restaurant_info.category ? [record.restaurant_info.category] : [],
          youtube_links: [record.youtube_link],
          youtube_metas: record.youtube_meta ? [record.youtube_meta] : [],
          tzuyang_reviews: trimmedTzuyangReview ? [trimmedTzuyangReview] : (record.restaurant_info.tzuyang_review ? [record.restaurant_info.tzuyang_review] : []),
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // evaluation_record 상태 업데이트
      const { error: updateError } = await supabase
        .from('evaluation_records')
        .update({
          status: 'approved',
          processed_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      if (updateError) throw updateError;

      toast({
        title: '승인 완료',
        description: `${formData.name} 레스토랑이 성공적으로 등록되었습니다.`,
      });

      onSuccess(record.id, {
        status: 'approved',
        processed_at: new Date().toISOString(),
      });
      onOpenChange(false);
      resetForm();

    } catch (error: any) {
      console.error('승인 실패:', error);
      toast({
        variant: 'destructive',
        title: '승인 실패',
        description: error.message,
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
    setGeocodingResult(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>보류 레스토랑 편집 및 승인</DialogTitle>
          <DialogDescription>
            정보를 수정하고 재지오코딩 후 승인할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

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
                setFormData(prev => ({ ...prev, address: e.target.value }));
                // 주소가 변경되면 지오코딩 결과 초기화
                setGeocodingResult(null);
              }}
              placeholder="예: 서울특별시 마포구 양화로 160"
              rows={2}
            />
          </div>

          {/* 지오코딩 결과 */}
          {geocodingResult && (
            <div className={`rounded-lg p-3 ${geocodingResult.success ? 'bg-green-50 dark:bg-green-950 border border-green-200' : 'bg-red-50 dark:bg-red-950 border border-red-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-sm font-medium">
                  지오코딩 결과
                </Label>
                {geocodingResult.success ? (
                  <Badge variant="default" className="bg-green-600">성공</Badge>
                ) : (
                  <Badge variant="destructive">실패</Badge>
                )}
              </div>
              
              {geocodingResult.success && geocodingResult.data ? (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div>
                    <span className="font-medium">도로명: </span>
                    {geocodingResult.data.road_address}
                  </div>
                  <div>
                    <span className="font-medium">지번: </span>
                    {geocodingResult.data.jibun_address}
                  </div>
                  <div>
                    <span className="font-medium">영어 주소: </span>
                    {geocodingResult.data.english_address}
                  </div>
                  <div>
                    <span className="font-medium">좌표: </span>
                    위도 {geocodingResult.data.y}, 경도 {geocodingResult.data.x}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-destructive">{geocodingResult.error}</p>
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
            disabled={loading || !geocodingResult?.success}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            승인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
