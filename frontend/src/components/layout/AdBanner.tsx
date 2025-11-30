import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Scroll } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface AdBannerSlide {
    id: number;
    title: string;
    description: string;

}

// 광고 배너 슬라이드 데이터 (옛스러운 말투 적용)
const AD_SLIDES: AdBannerSlide[] = [
    {
        id: 1,
        title: "광고주 모집",
        description: "귀하의 맛집을\n천하에 널리 알리옵소서",

    },
    {
        id: 2,
        title: "명당 자리",
        description: "수많은 미식가들이\n오가는 길목이옵니다",

    },
    {
        id: 3,
        title: "동반 성장",
        description: "쯔동여지도여지도와 더불어\n큰 뜻을 펼치시옵소서",

    }
];

const AdBanner = () => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);

    // 자동 슬라이드 전환
    useEffect(() => {
        if (!isAutoPlaying) return;

        const interval = setInterval(() => {
            setCurrentSlide((prev) => (prev + 1) % AD_SLIDES.length);
        }, 5000);

        return () => clearInterval(interval);
    }, [isAutoPlaying]);

    const goToSlide = (index: number) => {
        setCurrentSlide(index);
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    };

    const nextSlide = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        goToSlide((currentSlide + 1) % AD_SLIDES.length);
    };

    const prevSlide = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        goToSlide((currentSlide - 1 + AD_SLIDES.length) % AD_SLIDES.length);
    };

    const currentAd = AD_SLIDES[currentSlide];

    return (
        <div
            className="relative w-full h-64 rounded-lg overflow-hidden group select-none shadow-md"
            onMouseEnter={() => setIsAutoPlaying(false)}
            onMouseLeave={() => setIsAutoPlaying(true)}
            style={{ backgroundColor: '#fdfbf7' }} // 한지 색상
        >
            {/* 한지 질감 오버레이 */}
            <div className="absolute inset-0 opacity-40 pointer-events-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")` }}
            />

            {/* 전통 문양 테두리 */}
            <div className="absolute inset-2 border-2 border-double border-stone-800/20 rounded-md pointer-events-none" />
            <div className="absolute inset-0 border-4 border-stone-800/10 rounded-lg pointer-events-none" />

            {/* 컨텐츠 */}
            <div className="relative h-full flex flex-col items-center justify-center text-center p-6 z-10">

                {/* 상단 장식 */}
                <div className="mb-3 text-stone-500 opacity-60">
                    <Scroll className="w-6 h-6" />
                </div>

                {/* 제목 (세로쓰기 느낌을 주는 폰트와 레이아웃) */}
                <h3 className="text-2xl font-serif font-bold text-stone-900 mb-3 tracking-widest drop-shadow-sm">
                    {currentAd.title}
                </h3>

                {/* 설명 */}
                <p className="text-base font-serif text-stone-700 whitespace-pre-line leading-loose mb-3 opacity-90">
                    {currentAd.description}
                </p>



                {/* 버튼 */}
                <Button
                    variant="outline"
                    size="sm"
                    className="font-serif bg-stone-100/50 hover:bg-stone-200 text-stone-800 border-stone-400 hover:border-stone-600 transition-all duration-300"
                >
                    전갈 보내기
                </Button>
            </div>

            {/* 네비게이션 컨트롤 */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 pointer-events-auto"
                    onClick={prevSlide}
                >
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 pointer-events-auto"
                    onClick={nextSlide}
                >
                    <ChevronRight className="h-5 w-5" />
                </Button>
            </div>

            {/* 하단 인디케이터 */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                {AD_SLIDES.map((_, index) => (
                    <button
                        key={index}
                        onClick={(e) => {
                            e.stopPropagation();
                            goToSlide(index);
                        }}
                        className={cn(
                            "w-2 h-2 rounded-full transition-all duration-300 border border-stone-400",
                            currentSlide === index
                                ? "bg-stone-800 scale-110"
                                : "bg-transparent hover:bg-stone-300"
                        )}
                        aria-label={`슬라이드 ${index + 1}로 이동`}
                    />
                ))}
            </div>
        </div>
    );
};

export default AdBanner;
