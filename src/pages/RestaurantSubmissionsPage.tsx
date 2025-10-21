import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, XCircle, Clock, Trash2, Youtube } from "lucide-react";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface RestaurantSubmission {
    id: string;
    restaurant_name: string;
    address: string;
    phone: string | null;
    category: string;
    youtube_link: string;
    description: string | null;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    created_at: string;
    reviewed_at: string | null;
}

export default function RestaurantSubmissionsPage() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        restaurant_name: "",
        address: "",
        phone: "",
        category: RESTAURANT_CATEGORIES[0],
        youtube_link: "",
        description: "",
    });

    // 내 제보 내역 조회
    const { data: submissions = [], isLoading } = useQuery({
        queryKey: ['my-submissions', user?.id],
        queryFn: async () => {
            if (!user) return [];

            const { data, error } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data as RestaurantSubmission[];
        },
        enabled: !!user,
    });

    // 제보 제출
    const submitMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            if (!user) throw new Error('로그인이 필요합니다');

            const { error } = await supabase
                .from('restaurant_submissions')
                .insert({
                    user_id: user.id,
                    restaurant_name: data.restaurant_name.trim(),
                    address: data.address.trim(),
                    phone: data.phone.trim() || null,
                    category: data.category,
                    youtube_link: data.youtube_link.trim(),
                    description: data.description.trim() || null,
                    status: 'pending',
                });

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('맛집 제보가 성공적으로 제출되었습니다!');
            queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
            setIsSubmitModalOpen(false);
            resetForm();
        },
        onError: (error: any) => {
            toast.error(error.message || '제보 제출에 실패했습니다');
        },
    });

    // 제보 삭제 (pending 상태만)
    const deleteMutation = useMutation({
        mutationFn: async (submissionId: string) => {
            const { error } = await supabase
                .from('restaurant_submissions')
                .delete()
                .eq('id', submissionId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('제보가 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
        },
        onError: (error: any) => {
            toast.error(error.message || '삭제에 실패했습니다');
        },
    });

    const resetForm = () => {
        setFormData({
            restaurant_name: "",
            address: "",
            phone: "",
            category: RESTAURANT_CATEGORIES[0],
            youtube_link: "",
            description: "",
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.restaurant_name.trim() || !formData.address.trim() || !formData.youtube_link.trim()) {
            toast.error('필수 항목을 모두 입력해주세요');
            return;
        }

        submitMutation.mutate(formData);
    };

    const handleDelete = (submissionId: string, status: string) => {
        if (status !== 'pending') {
            toast.error('대기 중인 제보만 삭제할 수 있습니다');
            return;
        }

        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            deleteMutation.mutate(submissionId);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return (
                    <Badge variant="secondary" className="gap-1">
                        <Clock className="h-3 w-3" />
                        검토 대기 중
                    </Badge>
                );
            case 'approved':
                return (
                    <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        승인됨
                    </Badge>
                );
            case 'rejected':
                return (
                    <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        거부됨
                    </Badge>
                );
            default:
                return null;
        }
    };

    const handleSubmitClick = () => {
        if (!user) {
            toast.error('맛집 제보는 로그인 후 이용 가능합니다');
            return;
        }
        setIsSubmitModalOpen(true);
    };

    return (
        <div className="flex flex-col h-full bg-background">
            {/* 헤더 */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            <Youtube className="h-6 w-6 text-primary" />
                            쯔양 맛집 제보
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            쯔양이 방문한 맛집을 유튜브 영상과 함께 제보해주세요!
                        </p>
                    </div>
                    <Button
                        onClick={handleSubmitClick}
                        className="bg-gradient-primary hover:opacity-90 gap-2"
                    >
                        <Send className="h-4 w-4" />
                        맛집 제보하기
                    </Button>
                </div>

                {/* 안내 카드 */}
                <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-4">
                    <div className="flex items-start gap-3">
                        <div className="text-2xl">💡</div>
                        <div className="space-y-1 text-sm">
                            <p className="font-semibold text-blue-900 dark:text-blue-100">
                                제보 가이드
                            </p>
                            <ul className="space-y-1 text-blue-700 dark:text-blue-300 list-disc list-inside">
                                <li>유튜브 영상에서 쯔양이 직접 방문한 맛집을 발견하셨나요?</li>
                                <li>영상 링크와 함께 맛집 정보를 제보해주세요</li>
                                <li>관리자 검토 후 승인되면 지도에 표시됩니다</li>
                                <li>정확한 정보 제공을 부탁드립니다 🙏</li>
                            </ul>
                        </div>
                    </div>
                </Card>
            </div>

            {/* 제보 내역 */}
            <div className="flex-1 overflow-auto p-6 space-y-4">
                <h2 className="text-xl font-bold">내 제보 내역</h2>

                {!user ? (
                    <Card className="p-12 text-center">
                        <div className="text-6xl mb-4">🔒</div>
                        <h3 className="text-xl font-semibold mb-2">로그인이 필요합니다</h3>
                        <p className="text-muted-foreground mb-4">
                            로그인 후 제보 내역을 확인하실 수 있습니다
                        </p>
                        <p className="text-sm text-muted-foreground">
                            우측 상단의 로그인 버튼을 클릭해주세요
                        </p>
                    </Card>
                ) : isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : submissions.length === 0 ? (
                    <Card className="p-12 text-center">
                        <div className="text-6xl mb-4">📋</div>
                        <h3 className="text-xl font-semibold mb-2">제보 내역이 없습니다</h3>
                        <p className="text-muted-foreground mb-4">
                            쯔양이 방문한 맛집을 발견하시면 제보해주세요!
                        </p>
                        <Button
                            onClick={handleSubmitClick}
                            className="bg-gradient-primary hover:opacity-90"
                        >
                            첫 제보하기
                        </Button>
                    </Card>
                ) : (
                    <div className="grid gap-4">
                        {submissions.map((submission) => (
                            <Card key={submission.id} className="p-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-lg font-semibold">
                                                {submission.restaurant_name}
                                            </h3>
                                            {getStatusBadge(submission.status)}
                                            <Badge variant="outline">{submission.category}</Badge>
                                        </div>

                                        <p className="text-sm text-muted-foreground">
                                            📍 {submission.address}
                                        </p>

                                        {submission.phone && (
                                            <p className="text-sm text-muted-foreground">
                                                📞 {submission.phone}
                                            </p>
                                        )}

                                        {submission.description && (
                                            <p className="text-sm text-muted-foreground">
                                                💭 {submission.description}
                                            </p>
                                        )}

                                        <a
                                            href={submission.youtube_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-primary hover:underline flex items-center gap-1"
                                        >
                                            <Youtube className="h-4 w-4" />
                                            유튜브 영상 보기
                                        </a>

                                        {submission.status === 'rejected' && submission.rejection_reason && (
                                            <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                                <p className="text-sm text-red-700 dark:text-red-300">
                                                    <strong>거부 사유:</strong> {submission.rejection_reason}
                                                </p>
                                            </div>
                                        )}

                                        <p className="text-xs text-muted-foreground">
                                            제보일: {new Date(submission.created_at).toLocaleString('ko-KR')}
                                        </p>
                                    </div>

                                    {submission.status === 'pending' && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(submission.id, submission.status)}
                                            className="text-destructive hover:text-destructive"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* 제보 모달 */}
            <Dialog open={isSubmitModalOpen} onOpenChange={setIsSubmitModalOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                            쯔양 맛집 제보하기
                        </DialogTitle>
                        <DialogDescription>
                            쯔양이 방문한 맛집 정보와 유튜브 영상 링크를 알려주세요
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                            <Label htmlFor="restaurant_name">
                                맛집 이름 <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="restaurant_name"
                                value={formData.restaurant_name}
                                onChange={(e) => setFormData({ ...formData, restaurant_name: e.target.value })}
                                placeholder="예: 명동 짜장면"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="category">
                                카테고리 <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={formData.category}
                                onValueChange={(value) => setFormData({ ...formData, category: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {RESTAURANT_CATEGORIES.map((cat) => (
                                        <SelectItem key={cat} value={cat}>
                                            {cat}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="address">
                                주소 <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="address"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="서울시 중구 명동길 123"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="phone">전화번호</Label>
                            <Input
                                id="phone"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                placeholder="02-1234-5678"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="youtube_link">
                                유튜브 영상 링크 <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="youtube_link"
                                value={formData.youtube_link}
                                onChange={(e) => setFormData({ ...formData, youtube_link: e.target.value })}
                                placeholder="https://youtube.com/watch?v=..."
                            />
                            <p className="text-xs text-muted-foreground">
                                쯔양이 방문한 맛집 유튜브 영상 링크를 입력해주세요
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">쯔양의 리뷰</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="쯔양이 이 맛집에 대해 한 리뷰 내용을 입력해주세요... (팩트 체크 예정)"
                                rows={4}
                            />
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setIsSubmitModalOpen(false);
                                    resetForm();
                                }}
                                disabled={submitMutation.isPending}
                            >
                                취소
                            </Button>
                            <Button
                                type="submit"
                                className="bg-gradient-primary hover:opacity-90"
                                disabled={submitMutation.isPending}
                            >
                                {submitMutation.isPending ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        제출 중...
                                    </>
                                ) : (
                                    <>
                                        <Send className="mr-2 h-4 w-4" />
                                        제보하기
                                    </>
                                )}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

