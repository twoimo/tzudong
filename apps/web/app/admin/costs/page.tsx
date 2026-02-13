"use client";

import { useState, useCallback, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Save, X, Plus, Trash2, ArrowLeft } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { CostsSkeleton } from "@/components/ui/skeleton-loaders";

interface ServerCost {
    id: string;
    item_name: string;
    monthly_cost: number;
    description: string | null;
    updated_at: string | null;
}

const DUMMY_SERVER_COSTS: ServerCost[] = [
    { id: 'dummy-1', item_name: 'Supabase Pro', monthly_cost: 25, description: 'Database and Authentication', updated_at: new Date().toISOString() },
    { id: 'dummy-2', item_name: 'Vercel Pro', monthly_cost: 20, description: 'Frontend Hosting', updated_at: new Date().toISOString() },
];

const formatCurrency = (amount: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);

function CostsManagementPage() {
    const router = useRouter();
    const { user, isAdmin, isLoading: authLoading } = useAuth();
    const queryClient = useQueryClient();

    const [isEditing, setIsEditing] = useState(false);
    const [editingCost, setEditingCost] = useState<ServerCost | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [formData, setFormData] = useState({ item_name: "", monthly_cost: "", description: "" });

    // 권한 체크
    useEffect(() => {
        if (!authLoading && (!user || !isAdmin)) {
            router.push('/');
        }
    }, [authLoading, user, isAdmin, router]);

    const { data: costs = [], isLoading } = useQuery({
        queryKey: ['server-costs-admin'],
        queryFn: async () => {
            try {
                const { data, error } = await supabase.from('server_costs').select('*').order('monthly_cost', { ascending: false });
                if (error) return DUMMY_SERVER_COSTS;
                const serverCosts = (data || []) as ServerCost[];
                return serverCosts.length === 0 ? DUMMY_SERVER_COSTS : serverCosts;
            } catch {
                return DUMMY_SERVER_COSTS;
            }
        },
        staleTime: 1000 * 60 * 5,
    });

    const createMutation = useMutation({
        mutationFn: async (newCost: { item_name: string; monthly_cost: number; description: string }) => {
            const { error } = await (supabase.from('server_costs') as any).insert([newCost]);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['server-costs-admin'] });
            toast({ title: "추가 완료", description: "비용 항목이 추가되었습니다" });
            setIsCreating(false);
            setFormData({ item_name: "", monthly_cost: "", description: "" });
        },
        onError: (error: Error) => toast({ title: "추가 실패", description: error.message, variant: "destructive" }),
    });

    const updateMutation = useMutation({
        mutationFn: async (updatedCost: ServerCost) => {
            const { error } = await (supabase.from('server_costs') as any)
                .update({ item_name: updatedCost.item_name, monthly_cost: updatedCost.monthly_cost, description: updatedCost.description })
                .eq('id', updatedCost.id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['server-costs-admin'] });
            toast({ title: "수정 완료", description: "비용 항목이 수정되었습니다" });
            setIsEditing(false);
            setEditingCost(null);
        },
        onError: (error: Error) => toast({ title: "수정 실패", description: error.message, variant: "destructive" }),
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('server_costs').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['server-costs-admin'] });
            toast({ title: "삭제 완료", description: "비용 항목이 삭제되었습니다" });
        },
        onError: (error: Error) => toast({ title: "삭제 실패", description: error.message, variant: "destructive" }),
    });

    const totalMonthlyCost = costs.reduce((sum, cost) => sum + cost.monthly_cost, 0);

    const handleEdit = useCallback((cost: ServerCost) => { setEditingCost({ ...cost }); setIsEditing(true); }, []);
    const handleSave = useCallback(() => { if (editingCost) updateMutation.mutate(editingCost); }, [editingCost, updateMutation]);
    const handleCreate = useCallback(() => {
        if (!formData.item_name || !formData.monthly_cost) {
            toast({ title: "필수 항목 누락", description: "항목명과 월 비용을 입력해주세요", variant: "destructive" });
            return;
        }
        createMutation.mutate({ item_name: formData.item_name, monthly_cost: parseFloat(formData.monthly_cost), description: formData.description.trim() || "" });
    }, [formData, createMutation]);
    const handleDelete = useCallback((id: string) => { if (confirm("정말로 이 비용 항목을 삭제하시겠습니까?")) deleteMutation.mutate(id); }, [deleteMutation]);

    if (authLoading || !user || !isAdmin) return <CostsSkeleton count={3} />;

    return (
        <div className="min-h-screen bg-[#fdfbf7] font-serif">
            {/* 한지 질감 오버레이 */}
            <div
                className="fixed inset-0 opacity-30 pointer-events-none z-0"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")`,
                }}
            />

            <div className="relative z-10 container mx-auto p-4 md:p-6 max-w-4xl">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.back()}
                            className="hover:bg-stone-200/50 h-8 w-8 md:h-10 md:w-10"
                        >
                            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
                        </Button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-stone-900">서버 운영 비용</h1>
                            <p className="text-sm text-stone-500 hidden md:block">매월 발생하는 서버 및 인프라 비용을 관리합니다</p>
                        </div>
                    </div>
                    <Button onClick={() => setIsCreating(true)} className="bg-stone-800 hover:bg-stone-700">
                        <Plus className="h-4 w-4 mr-2" />
                        <span className="hidden md:inline">비용 항목 추가</span>
                        <span className="md:hidden">추가</span>
                    </Button>
                </div>

                {isLoading ? (
                    <CostsSkeleton count={5} />
                ) : (
                    <>
                        {/* 비용 요약 카드 */}
                        <Card className="mb-6 p-6 bg-white border-stone-200 shadow-sm">
                            <div className="flex flex-col items-center justify-center text-center">
                                <p className="text-sm text-stone-500 mb-1">총 월 운영 비용</p>
                                <p className="text-3xl font-bold text-green-700">{formatCurrency(totalMonthlyCost)}</p>
                                <p className="text-xs text-stone-400 mt-2">{costs.length}개 항목 기준</p>
                            </div>
                        </Card>

                        {/* 비용 목록 */}
                        <Card className="border-stone-200 overflow-hidden bg-white shadow-sm">
                            <Table>
                                <TableHeader className="bg-stone-50">
                                    <TableRow>
                                        <TableHead>항목명</TableHead>
                                        <TableHead className="text-right">월 비용</TableHead>
                                        <TableHead className="text-right">비율</TableHead>
                                        <TableHead className="hidden md:table-cell">설명</TableHead>
                                        <TableHead className="text-right">작업</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {costs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                                                등록된 비용 항목이 없습니다
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        costs.map((cost) => {
                                            const percentage = totalMonthlyCost > 0 ? ((cost.monthly_cost / totalMonthlyCost) * 100).toFixed(1) : "0.0";
                                            return (
                                                <TableRow key={cost.id} className="hover:bg-stone-50">
                                                    <TableCell className="font-medium">{cost.item_name}</TableCell>
                                                    <TableCell className="text-right font-bold">{formatCurrency(cost.monthly_cost)}</TableCell>
                                                    <TableCell className="text-right"><Badge variant="outline">{percentage}%</Badge></TableCell>
                                                    <TableCell className="hidden md:table-cell max-w-[200px]"><span className="text-sm text-stone-500 truncate block">{cost.description || "-"}</span></TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(cost)}><Edit className="h-4 w-4" /></Button>
                                                            <Button variant="ghost" size="sm" onClick={() => handleDelete(cost.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </Card>
                    </>
                )}
            </div>

            {/* 수정 다이얼로그 */}
            <Dialog open={isEditing} onOpenChange={setIsEditing}>
                <DialogContent>
                    <DialogHeader><DialogTitle>비용 항목 수정</DialogTitle><DialogDescription>비용 항목의 정보를 수정합니다</DialogDescription></DialogHeader>
                    {editingCost && (
                        <div className="space-y-4 mt-4">
                            <div><Label>항목명</Label><Input value={editingCost.item_name} onChange={(e) => setEditingCost({ ...editingCost, item_name: e.target.value })} /></div>
                            <div><Label>월 비용 (₩)</Label><Input type="number" value={editingCost.monthly_cost} onChange={(e) => setEditingCost({ ...editingCost, monthly_cost: parseFloat(e.target.value) || 0 })} /></div>
                            <div><Label>설명</Label><Textarea value={editingCost.description || ""} onChange={(e) => setEditingCost({ ...editingCost, description: e.target.value })} rows={3} /></div>
                            <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={() => setIsEditing(false)}><X className="h-4 w-4 mr-2" />취소</Button>
                                <Button onClick={handleSave} className="bg-stone-800 hover:bg-stone-700 text-white"><Save className="h-4 w-4 mr-2" />저장</Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 생성 다이얼로그 */}
            <Dialog open={isCreating} onOpenChange={setIsCreating}>
                <DialogContent>
                    <DialogHeader><DialogTitle>비용 항목 추가</DialogTitle><DialogDescription>새로운 비용 항목을 추가합니다</DialogDescription></DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div><Label>항목명 *</Label><Input value={formData.item_name} onChange={(e) => setFormData({ ...formData, item_name: e.target.value })} placeholder="예: Google Maps API" /></div>
                        <div><Label>월 비용 (₩) *</Label><Input type="number" value={formData.monthly_cost} onChange={(e) => setFormData({ ...formData, monthly_cost: e.target.value })} placeholder="0" /></div>
                        <div><Label>설명</Label><Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="비용 항목에 대한 추가 설명" rows={3} /></div>
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => setIsCreating(false)}><X className="h-4 w-4 mr-2" />취소</Button>
                            <Button onClick={handleCreate} className="bg-stone-800 hover:bg-stone-700 text-white"><Plus className="h-4 w-4 mr-2" />추가</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function CostsPageWrapper() {
    return (
        <Suspense fallback={<CostsSkeleton count={5} />}>
            <CostsManagementPage />
        </Suspense>
    );
}
