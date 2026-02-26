'use client';

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SubmissionsRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/mypage');
    }, [router]);

    return (
        <div className="flex items-center justify-center h-screen">
            <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-muted-foreground">마이페이지로 이동 중...</p>
            </div>
        </div>
    );
}
