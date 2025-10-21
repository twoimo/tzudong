import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
    DollarSign,
    Server,
    Zap,
    Brain,
    TrendingUp,
    TrendingDown,
    Edit,
    Save,
    X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface MonthlyCost {
    yearMonth: string;
    hostingCost: number;
    apiCost: number;
    aiCost: number;
    totalCost: number;
    notes: string;
}

// Mock data
const mockCosts: MonthlyCost[] = [
    {
        yearMonth: "2025-01",
        hostingCost: 15000,
        apiCost: 8000,
        aiCost: 12000,
        totalCost: 35000,
        notes: "초기 서비스 시작, 트래픽 증가 예상",
    },
    {
        yearMonth: "2024-12",
        hostingCost: 15000,
        apiCost: 6000,
        aiCost: 10000,
        totalCost: 31000,
        notes: "베타 테스트 기간",
    },
    {
        yearMonth: "2024-11",
        hostingCost: 15000,
        apiCost: 5000,
        aiCost: 8000,
        totalCost: 28000,
        notes: "개발 단계",
    },
];

const ServerCostsPage = () => {
    const { isAdmin } = useAuth();
    const [costs, setCosts] = useState<MonthlyCost[]>(mockCosts);
    const [isEditing, setIsEditing] = useState(false);
    const [editingMonth, setEditingMonth] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<MonthlyCost | null>(null);

    const currentMonth = costs[0];
    const previousMonth = costs[1];
    const totalHosting = costs.reduce((sum, c) => sum + c.hostingCost, 0);
    const totalApi = costs.reduce((sum, c) => sum + c.apiCost, 0);
    const totalAi = costs.reduce((sum, c) => sum + c.aiCost, 0);
    const grandTotal = costs.reduce((sum, c) => sum + c.totalCost, 0);

    const getCostTrend = (current: number, previous: number) => {
        if (current > previous) {
            return {
                icon: <TrendingUp className="h-4 w-4 text-red-500" />,
                color: "text-red-500",
                text: `+${((current - previous) / previous * 100).toFixed(1)}%`,
            };
        } else if (current < previous) {
            return {
                icon: <TrendingDown className="h-4 w-4 text-green-500" />,
                color: "text-green-500",
                text: `-${((previous - current) / previous * 100).toFixed(1)}%`,
            };
        }
        return {
            icon: null,
            color: "text-muted-foreground",
            text: "0%",
        };
    };

    const hostingTrend = getCostTrend(currentMonth.hostingCost, previousMonth.hostingCost);
    const apiTrend = getCostTrend(currentMonth.apiCost, previousMonth.apiCost);
    const aiTrend = getCostTrend(currentMonth.aiCost, previousMonth.aiCost);
    const totalTrend = getCostTrend(currentMonth.totalCost, previousMonth.totalCost);

    const handleEdit = (cost: MonthlyCost) => {
        setEditingMonth(cost.yearMonth);
        setEditForm({ ...cost });
        setIsEditing(true);
    };

    const handleSave = () => {
        if (editForm) {
            setCosts(costs.map(c =>
                c.yearMonth === editForm.yearMonth ? editForm : c
            ));
            setIsEditing(false);
            setEditingMonth(null);
            setEditForm(null);
        }
    };

    const handleCancel = () => {
        setIsEditing(false);
        setEditingMonth(null);
        setEditForm(null);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: 'KRW',
        }).format(amount);
    };

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            <DollarSign className="h-6 w-6 text-primary" />
                            월 서버 운영 비용
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            투명한 서비스 운영을 위한 비용 공개
                        </p>
                    </div>
                </div>

                {/* Current Month Summary */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                    <Card className="p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Server className="h-4 w-4 text-blue-500" />
                                <span className="text-sm font-medium text-muted-foreground">호스팅</span>
                            </div>
                            <div className="flex items-center gap-1">
                                {hostingTrend.icon}
                                <span className={`text-xs ${hostingTrend.color}`}>
                                    {hostingTrend.text}
                                </span>
                            </div>
                        </div>
                        <p className="text-2xl font-bold">{formatCurrency(currentMonth.hostingCost)}</p>
                    </Card>

                    <Card className="p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Zap className="h-4 w-4 text-yellow-500" />
                                <span className="text-sm font-medium text-muted-foreground">API</span>
                            </div>
                            <div className="flex items-center gap-1">
                                {apiTrend.icon}
                                <span className={`text-xs ${apiTrend.color}`}>
                                    {apiTrend.text}
                                </span>
                            </div>
                        </div>
                        <p className="text-2xl font-bold">{formatCurrency(currentMonth.apiCost)}</p>
                    </Card>

                    <Card className="p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Brain className="h-4 w-4 text-purple-500" />
                                <span className="text-sm font-medium text-muted-foreground">AI</span>
                            </div>
                            <div className="flex items-center gap-1">
                                {aiTrend.icon}
                                <span className={`text-xs ${aiTrend.color}`}>
                                    {aiTrend.text}
                                </span>
                            </div>
                        </div>
                        <p className="text-2xl font-bold">{formatCurrency(currentMonth.aiCost)}</p>
                    </Card>

                    <Card className="p-4 border-primary border-2">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-primary" />
                                <span className="text-sm font-medium text-muted-foreground">총 비용</span>
                            </div>
                            <div className="flex items-center gap-1">
                                {totalTrend.icon}
                                <span className={`text-xs ${totalTrend.color}`}>
                                    {totalTrend.text}
                                </span>
                            </div>
                        </div>
                        <p className="text-2xl font-bold text-primary">
                            {formatCurrency(currentMonth.totalCost)}
                        </p>
                    </Card>
                </div>

                {/* Current Month Notes */}
                {currentMonth.notes && (
                    <Card className="p-4 mt-4 bg-muted/50">
                        <p className="text-sm">
                            <span className="font-semibold">💡 {currentMonth.yearMonth}: </span>
                            {currentMonth.notes}
                        </p>
                    </Card>
                )}
            </div>

            {/* Cost History Table */}
            <div className="flex-1 overflow-hidden p-6">
                <Card className="h-full flex flex-col">
                    <div className="p-4 border-b border-border flex items-center justify-between">
                        <h2 className="font-semibold">월별 운영 비용 내역</h2>
                        <Badge variant="outline">
                            누적 총액: {formatCurrency(grandTotal)}
                        </Badge>
                    </div>

                    <ScrollArea className="flex-1">
                        <Table>
                            <TableHeader className="sticky top-0 bg-muted">
                                <TableRow>
                                    <TableHead>년월</TableHead>
                                    <TableHead className="text-right">호스팅 비용</TableHead>
                                    <TableHead className="text-right">API 비용</TableHead>
                                    <TableHead className="text-right">AI 비용</TableHead>
                                    <TableHead className="text-right">총 비용</TableHead>
                                    <TableHead>비고</TableHead>
                                    {isAdmin && <TableHead className="text-right">작업</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {costs.map((cost) => (
                                    <TableRow key={cost.yearMonth}>
                                        <TableCell className="font-medium">
                                            {cost.yearMonth}
                                            {cost === currentMonth && (
                                                <Badge variant="default" className="ml-2">현재</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(cost.hostingCost)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(cost.apiCost)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(cost.aiCost)}
                                        </TableCell>
                                        <TableCell className="text-right font-bold">
                                            {formatCurrency(cost.totalCost)}
                                        </TableCell>
                                        <TableCell className="max-w-md truncate">
                                            {cost.notes}
                                        </TableCell>
                                        {isAdmin && (
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleEdit(cost)}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>

                    {/* Cumulative Stats */}
                    <div className="p-4 border-t border-border bg-muted/30">
                        <div className="grid grid-cols-4 gap-4 text-sm">
                            <div>
                                <p className="text-muted-foreground mb-1">총 호스팅 비용</p>
                                <p className="font-bold">{formatCurrency(totalHosting)}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground mb-1">총 API 비용</p>
                                <p className="font-bold">{formatCurrency(totalApi)}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground mb-1">총 AI 비용</p>
                                <p className="font-bold">{formatCurrency(totalAi)}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground mb-1">누적 총 비용</p>
                                <p className="font-bold text-primary text-lg">{formatCurrency(grandTotal)}</p>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Edit Modal (Simple inline for demo) */}
            {isEditing && editForm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <Card className="w-full max-w-2xl p-6">
                        <h3 className="text-lg font-bold mb-4">{editForm.yearMonth} 비용 수정</h3>

                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <Label>호스팅 비용</Label>
                                    <Input
                                        type="number"
                                        value={editForm.hostingCost}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            hostingCost: parseFloat(e.target.value) || 0,
                                            totalCost: (parseFloat(e.target.value) || 0) + editForm.apiCost + editForm.aiCost,
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label>API 비용</Label>
                                    <Input
                                        type="number"
                                        value={editForm.apiCost}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            apiCost: parseFloat(e.target.value) || 0,
                                            totalCost: editForm.hostingCost + (parseFloat(e.target.value) || 0) + editForm.aiCost,
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label>AI 비용</Label>
                                    <Input
                                        type="number"
                                        value={editForm.aiCost}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            aiCost: parseFloat(e.target.value) || 0,
                                            totalCost: editForm.hostingCost + editForm.apiCost + (parseFloat(e.target.value) || 0),
                                        })}
                                    />
                                </div>
                            </div>

                            <div>
                                <Label>비고</Label>
                                <Textarea
                                    value={editForm.notes}
                                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                    rows={3}
                                />
                            </div>

                            <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={handleCancel}>
                                    <X className="h-4 w-4 mr-2" />
                                    취소
                                </Button>
                                <Button onClick={handleSave} className="bg-gradient-primary">
                                    <Save className="h-4 w-4 mr-2" />
                                    저장
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default ServerCostsPage;

