const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);

// 해외 모드 패널 관리
const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);
const [isPanelOpen, setIsPanelOpen] = useState(false);
const [panelRestaurant, setPanelRestaurant] = useState<Restaurant | null>(null);
const [editFormData, setEditFormData] = useState({
    name: '',
    address: '',
    phone: '',
    category: [] as string[],
    youtube_reviews: [] as { youtube_link: string; tzuyang_review: string; unique_id?: string }[]
});
const [filters, setFilters] = useState<FilterState>({
    categories: [],
    minRating: 1,
    minReviews: 0,
    minUserVisits: 0,
    minJjyangVisits: 0,
});
const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

// 글로벌 국가 목록
const GLOBAL_COUNTRIES = [
    "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

// 페이지가 너무 길어서 일단 기본 구조만 만들고 점진적으로 추가
return (
    <div className="h-full w-full flex items-center justify-center">
        <div className="text-center">
            <h1 className="text-4xl font-bold mb-4">홈페이지</h1>
            <p className="text-muted-foreground">지도 및 필터링 UI 이전 중...</p>
            <p className="text-sm text-muted-foreground mt-2">Index.tsx 파일이 917줄로 매우 복잡하여 단계적으로 이전 예정</p>
        </div>
    </div>
);
}
