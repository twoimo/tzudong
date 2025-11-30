'use client'; // [CSR] onClick 이벤트 처리

import { Button } from "@/components/ui/button";

interface HomeModeToggleProps {
    mode: 'domestic' | 'overseas';
    onModeChange: (mode: 'domestic' | 'overseas') => void;
}

// [CSR] 국내/해외 모드 토글 버튼 - 사용자 클릭 이벤트 처리
export default function HomeModeToggle({ mode, onModeChange }: HomeModeToggleProps) {
    return (
        <div className="absolute top-6 left-4 z-10">
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
    );
}
