"use client";

import { useState, type ReactNode } from "react";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Explain location use when requested, without covering the map while browsing. */
export function DeviceLocationDisclosure({ id, children, onConfirm, skipDisclosure = false }: {
    id: string;
    children: ReactNode;
    onConfirm: () => void;
    skipDisclosure?: boolean;
}) {
    const [open, setOpen] = useState(false);
    return (
        <AlertDialog open={open} onOpenChange={(nextOpen) => {
            if (nextOpen && skipDisclosure) { onConfirm(); return; }
            setOpen(nextOpen);
        }}>
            <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>현재 위치를 지도에서 볼까요?</AlertDialogTitle>
                    <AlertDialogDescription id={id}>
                        현재 위치를 표시하려면 위치 정보가 지도 제공자에 전달돼요. 앱에는 저장하지 않아요.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>현재 위치 보기</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
