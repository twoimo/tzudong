import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EvaluationRecord } from '@/types/evaluation';

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
  onSuccess: () => void;
}

interface FormData {
  name: string;
  address: string;
  phone: string;
  category: string;
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
  const [formData, setFormData] = useState<FormData>({
    name: '',
    address: '',
    phone: '',
    category: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;

    try {
      setLoading(true);

      // 1. Naver Geocoding API 호출
      const geocodingResult = await geocodeAddress(formData.address);

      if (!geocodingResult.success) {
        toast({
          variant: 'destructive',
          title: '주소 변환 실패',
          description: geocodingResult.error || '주소를 좌표로 변환할 수 없습니다.',
        });
        return;
      }

      // 2. 기존 레스토랑 중복 체크 (jibun_address 기준)
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

      // 3. 새 레스토랑 등록
      const { data: newRestaurant, error: insertError } = await supabase
        .from('restaurants')
        .insert({
          name: formData.name,
          road_address: geocodingResult.data!.road_address,
          jibun_address: geocodingResult.data!.jibun_address,
          english_address: geocodingResult.data!.english_address,
          address_elements: geocodingResult.data!.address_elements,
          lat: parseFloat(geocodingResult.data!.y),
          lng: parseFloat(geocodingResult.data!.x),
          phone: formData.phone || null,
          category: [formData.category],
          youtube_links: [record.youtube_link],
          youtube_metas: record.youtube_meta ? [record.youtube_meta] : [],
          tzuyang_reviews: record.restaurant_info ? [record.restaurant_info.tzuyang_review] : [],
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // 4. evaluation_record 상태 업데이트
      const { error: updateError } = await supabase
        .from('evaluation_records')
        .update({
          status: 'approved',
          processed_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      if (updateError) throw updateError;

      toast({
        title: '등록 완료',
        description: `${formData.name} 레스토랑이 성공적으로 등록되었습니다.`,
      });

      onSuccess();
      onOpenChange(false);
      resetForm();

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
      const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
      const clientSecret = import.meta.env.VITE_NAVER_GEOCODING_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return { success: false, error: 'Naver API 키가 설정되지 않았습니다.' };
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
    });
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
              <Label htmlFor="address">주소 *</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                placeholder="예: 서울특별시 마포구 양화로 160"
                required
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                정확한 주소를 입력해주세요. 자동으로 좌표 변환됩니다.
              </p>
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
  );
}
