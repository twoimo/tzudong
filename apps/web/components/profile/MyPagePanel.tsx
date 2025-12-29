'use client';

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, ChevronRight, ChevronLeft, User, List, Star, Bookmark } from "lucide-react";
import ProfileTab from "./ProfileTab";
import SubmissionsTab from "./SubmissionsTab";
import ReviewsTab from "./ReviewsTab";
import BookmarksTab from "./BookmarksTab";

interface MyPagePanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
    initialTab?: string;
}

export default function MyPagePanel({ isOpen, onClose, onToggleCollapse, isCollapsed, initialTab = 'profile' }: MyPagePanelProps) {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState(initialTab);

    // initialTab 변경 시 탭 업데이트
    useEffect(() => {
        if (initialTab) setActiveTab(initialTab);
    }, [initialTab]);

    if (!user) {
        return (
            <div className="h-full flex flex-col bg-background border-l border-border relative">
                <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                    <h2 className="text-lg font-bold">마이페이지</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
                </div>
                <div className="flex-1 flex items-center justify-center p-4">
                    <Card className="p-8 text-center">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-semibold mb-2">로그인이 필요합니다</h3>
                        <p className="text-sm text-muted-foreground">로그인 후 이용해주세요</p>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background border-l border-border relative">
            {/* 접기/펼치기 버튼 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronLeft className="h-4 w-4 text-muted-foreground" />}
                </button>
            )}

            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card shadow-sm z-10">
                <div>
                    <h2 className="text-lg font-bold">마이페이지</h2>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-muted">
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {/* 메인 탭 컨텐츠 */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-hidden relative">
                    <TabsContent value="profile" className="h-full m-0 overflow-auto data-[state=active]:block hidden">
                        <ProfileTab />
                    </TabsContent>
                    <TabsContent value="activity" className="h-full m-0 overflow-hidden data-[state=active]:block hidden">
                        <SubmissionsTab />
                    </TabsContent>
                    <TabsContent value="reviews" className="h-full m-0 overflow-hidden data-[state=active]:block hidden">
                        <ReviewsTab />
                    </TabsContent>
                    <TabsContent value="bookmarks" className="h-full m-0 overflow-hidden data-[state=active]:block hidden">
                        <BookmarksTab />
                    </TabsContent>
                </div>

                {/* 하단 탭 네비게이션 */}
                <div className="border-t border-border bg-background p-1 shadow-md z-10 pb-4">
                    <TabsList className="grid w-full grid-cols-4 h-14 bg-transparent p-0">
                        <TabsTrigger value="profile" className="flex flex-col items-center gap-1 data-[state=active]:bg-accent data-[state=active]:text-primary h-full rounded-none border-t-2 border-transparent data-[state=active]:border-primary transition-all">
                            <User className="h-5 w-5" />
                            <span className="text-[10px]">프로필</span>
                        </TabsTrigger>
                        <TabsTrigger value="activity" className="flex flex-col items-center gap-1 data-[state=active]:bg-accent data-[state=active]:text-primary h-full rounded-none border-t-2 border-transparent data-[state=active]:border-primary transition-all">
                            <List className="h-5 w-5" />
                            <span className="text-[10px]">제보/요청</span>
                        </TabsTrigger>
                        <TabsTrigger value="reviews" className="flex flex-col items-center gap-1 data-[state=active]:bg-accent data-[state=active]:text-primary h-full rounded-none border-t-2 border-transparent data-[state=active]:border-primary transition-all">
                            <Star className="h-5 w-5" />
                            <span className="text-[10px]">리뷰</span>
                        </TabsTrigger>
                        <TabsTrigger value="bookmarks" className="flex flex-col items-center gap-1 data-[state=active]:bg-accent data-[state=active]:text-primary h-full rounded-none border-t-2 border-transparent data-[state=active]:border-primary transition-all">
                            <Bookmark className="h-5 w-5" />
                            <span className="text-[10px]">북마크</span>
                        </TabsTrigger>
                    </TabsList>
                </div>
            </Tabs>
        </div>
    );
}
