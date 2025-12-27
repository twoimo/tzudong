'use client'; // [CSR] onClick 이벤트 처리

import { memo } from 'react';
import { Button } from "@/components/ui/button";

interface HomeModeToggleProps {
    mode: 'domestic' | 'overseas';
    onModeChange: (mode: 'domestic' | 'overseas') => void;
    isAdmin?: boolean; // 관리자 여부
}

// [최적화] React.memo로 불필요한 리렌더링 방지
// [권한 관리] 해외 모드는 관리자만 사용 가능
const HomeModeToggle = memo(function HomeModeToggle({ mode, onModeChange, isAdmin = false }: HomeModeToggleProps) {
    // 관리자가 아니면 토글 버튼 자체를 숨김 (국내만 사용)
    if (!isAdmin) {
        return null;
    }

    return (
        <>
            {/* 모바일: 좌측 하단 세그먼트 컨트롤 */}
            <div className="max-[1599px]:block min-[1600px]:hidden fixed bottom-44 left-4 z-40">
                <div className="flex items-center gap-0.5 p-0.5 bg-background/95 backdrop-blur-sm rounded-full shadow-lg border border-border w-[105px]">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onModeChange('domestic')}
                        className={`rounded-full h-8 px-2 text-xs font-medium transition-all flex-1 ${mode === 'domestic'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                            }`}
                    >
                        국내
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onModeChange('overseas')}
                        className={`rounded-full h-8 px-2 text-xs font-medium transition-all flex-1 ${mode === 'overseas'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                            }`}
                    >
                        해외
                    </Button>
                </div>
            </div>

            {/* 데스크탑: 기존 스타일 */}
            <div className="hidden min-[1600px]:block absolute top-6 left-4 z-10">
                <div className="flex items-center p-1 bg-white/90 backdrop-blur-md rounded-xl shadow-sm border border-gray-200/50">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onModeChange('domestic')}
                        className={`rounded-lg px-4 py-1.5 h-8 text-sm font-medium transition-all duration-200 ${mode === 'domestic'
                            ? 'bg-[#8B5A2B] text-white shadow-sm hover:bg-[#7A4E25]'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                            }`}
                    >
                        국내
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onModeChange('overseas')}
                        className={`rounded-lg px-4 py-1.5 h-8 text-sm font-medium transition-all duration-200 ${mode === 'overseas'
                            ? 'bg-[#8B5A2B] text-white shadow-sm hover:bg-[#7A4E25]'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                            }`}
                    >
                        해외
                    </Button>
                </div>
            </div>
        </>
    );
});

export default HomeModeToggle;
