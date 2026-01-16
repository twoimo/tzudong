'use client';

import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export default function AdminRestaurantsPage() {
    const { isAdmin } = useAuth();

    if (!isAdmin) {
        return (
            <div className="container mx-auto py-8 px-4 text-center text-muted-foreground">
                관리자 권한이 필요합니다.
            </div>
        );
    }

    return (
        <div className="container mx-auto py-6 px-4 max-w-[1600px]">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <Link href="/admin">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <h1 className="text-xl font-bold">맛집 데이터 관리</h1>
                </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-12 text-center text-muted-foreground">
                <p>맛집 목록 및 관리 기능 준비 중...</p>
            </div>
        </div>
    );
}
