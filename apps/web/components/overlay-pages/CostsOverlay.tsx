'use client';

import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Server, Edit, Save, X, Plus, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { GlobalLoader } from "@/components/ui/global-loader";

interface CostsOverlayProps {
    onClose?: () => void;
}

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

/**
 * 비용 오버레이
 * - 헤더 통합 (타이틀 + 닫기 버튼 + 총 비용)
 */
export default function CostsOverlay({ onClose }: CostsOverlayProps) {
    const { isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [isEditing, setIsEditing] = useState(false);
    const [editingCost, setEditingCost] = useState<ServerCost | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [formData, setFormData] = useState({ item_name: "", monthly_cost: "", description: "" });

    const { data: costs = [], isLoading } = useQuery({
        queryKey: ['server-costs-overlay'],
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
            queryClient.invalidateQueries({ queryKey: ['server-costs-overlay'] });
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
            queryClient.invalidateQueries({ queryKey: ['server-costs-overlay'] });
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
            queryClient.invalidateQueries({ queryKey: ['server-costs-overlay'] });
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

    if (isLoading) return <GlobalLoader message="비용 데이터를 불러오는 중..." />;

    return (
        <div className="flex flex-col h-full bg-background">
            {/* 통합 헤더 */}
            <div className="border-b border-border bg-background p-4 shrink-0 rounded-t-2xl">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-bold text-foreground">월 서버 운영 비용</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {isAdmin && (
                            <Button size="sm" onClick={() => setIsCreating(true)} className="bg-gradient-primary">
                                <Plus className="h-4 w-4 mr-1" />추가
                            </Button>
                        )}
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 hover:bg-muted rounded-full">
                                <X className="h-5 w-5" />
                            </Button>
                        )}
                    </div>
                </div>
                <Card className="p-3 bg-gradient-primary">
                    <div className="text-center text-white">
                        <p className="text-xs opacity-90 mb-1">총 월 운영 비용</p>
                        <p className="text-xl font-bold">{formatCurrency(totalMonthlyCost)}</p>
                        <p className="text-xs opacity-80">{costs.length}개 항목</p>
                    </div>
                </Card>
            </div>

            {/* 비용 목록 */}
            <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                    {costs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <Server className="h-12 w-12 mb-4" />
                            <p>등록된 비용 항목이 없습니다</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 bg-muted">
                                <TableRow>
                                    <TableHead>항목명</TableHead>
                                    <TableHead className="text-right">월 비용</TableHead>
                                    <TableHead className="text-right">비율</TableHead>
                                    <TableHead>설명</TableHead>
                                    {isAdmin && <TableHead className="text-right">작업</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {costs.map((cost) => {
                                    const percentage = totalMonthlyCost > 0 ? ((cost.monthly_cost / totalMonthlyCost) * 100).toFixed(1) : "0.0";
                                    return (
                                        <TableRow key={cost.id}>
                                            <TableCell className="font-medium">{cost.item_name}</TableCell>
                                            <TableCell className="text-right font-bold">{formatCurrency(cost.monthly_cost)}</TableCell>
                                            <TableCell className="text-right"><Badge variant="outline">{percentage}%</Badge></TableCell>
                                            <TableCell className="max-w-[200px]"><span className="text-sm text-muted-foreground truncate block">{cost.description || "-"}</span></TableCell>
                                            {isAdmin && (
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button variant="ghost" size="sm" onClick={() => handleEdit(cost)}><Edit className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(cost.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </ScrollArea>
            </div>

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
                                <Button onClick={handleSave} className="bg-gradient-primary"><Save className="h-4 w-4 mr-2" />저장</Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={isCreating} onOpenChange={setIsCreating}>
                <DialogContent>
                    <DialogHeader><DialogTitle>비용 항목 추가</DialogTitle><DialogDescription>새로운 비용 항목을 추가합니다</DialogDescription></DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div><Label>항목명 *</Label><Input value={formData.item_name} onChange={(e) => setFormData({ ...formData, item_name: e.target.value })} placeholder="예: Google Maps API" /></div>
                        <div><Label>월 비용 (₩) *</Label><Input type="number" value={formData.monthly_cost} onChange={(e) => setFormData({ ...formData, monthly_cost: e.target.value })} placeholder="0" /></div>
                        <div><Label>설명</Label><Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="비용 항목에 대한 추가 설명" rows={3} /></div>
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => setIsCreating(false)}><X className="h-4 w-4 mr-2" />취소</Button>
                            <Button onClick={handleCreate} className="bg-gradient-primary"><Plus className="h-4 w-4 mr-2" />추가</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
