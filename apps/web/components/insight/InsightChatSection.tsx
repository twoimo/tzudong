'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    MessageSquare,
    Send,
    Plus,
    Sparkles,
    Bot,
    User,
    Loader2,
    ExternalLink,
    TrendingUp,
    MapPin,
    BarChart3,
    Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// [TYPES] 채팅 관련 타입 정의
type VisualComponentType = 'heatmap' | 'map' | 'wordcloud' | 'calendar' | 'stats';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: TranscriptSource[];
    visualComponent?: VisualComponentType;
    createdAt: Date;
}

interface TranscriptSource {
    videoTitle: string;
    youtubeLink: string;
    timestamp: string;
    text: string;
}

interface ChatSession {
    id: string;
    title: string;
    createdAt: Date;
    messages: ChatMessage[];
}

// [MOCK] 모의 데이터 - 추후 실제 API로 대체

// 종합 인사이트 초기 메시지 (간결한 버전)
const INITIAL_INSIGHT_MESSAGE: ChatMessage = {
    id: 'initial-insight',
    role: 'assistant',
    content: `**쯔양 채널 종합 인사이트** (최근 30일 분석)

🔥 **TOP 3**: 890원 초밥 121접시(210만) · 성심당 빵(195만) · 전주 비빔밥(158만)

📈 **트렌드**: 가성비 콘텐츠 +35% | 지역투어 65% | 빵/디저트 +28%

💡 **추천**: 가성비 챌린지 · 지방맛집(부산/대전/전주) · 시즌콘텐츠`,
    visualComponent: 'stats',
    sources: [],
    createdAt: new Date()
};

const MOCK_SESSIONS: ChatSession[] = [
    {
        id: 'session-main',
        title: '종합 인사이트',
        createdAt: new Date(),
        messages: [
            INITIAL_INSIGHT_MESSAGE,
            {
                id: 'msg-user-1',
                role: 'user',
                content: '최근 인기 콘텐츠 TOP 3 자세히 분석해줘',
                createdAt: new Date(Date.now() - 300000)
            },
            {
                id: 'msg-ai-1',
                role: 'assistant',
                content: `**890원 회전초밥 121접시** 분석

🎯 **성공 요인**: 극단적 가성비 + 도전 포맷 조합
📈 **조회수**: 210만 (채널 평균 대비 +48%)
⏱️ **피크 구간**: 100접시 돌파 순간 (8:30)
💬 **댓글 반응**: "가성비 미쳤다", "도전 성공각"`,
                visualComponent: 'heatmap',
                sources: [{
                    videoTitle: '[쯔양] 890원 회전초밥 121접시!',
                    youtubeLink: 'https://www.youtube.com/watch?v=Tx_yrWwGCL4',
                    timestamp: '8:30',
                    text: '100접시 돌파!'
                }],
                createdAt: new Date(Date.now() - 280000)
            },
            {
                id: 'msg-user-2',
                role: 'user',
                content: '지역별 맛집 분포는 어때?',
                createdAt: new Date(Date.now() - 200000)
            },
            {
                id: 'msg-ai-2',
                role: 'assistant',
                content: `**지역별 맛집 분포** (총 312개)

🏙️ **수도권**: 서울(98) + 경기(65) = 52%
🌊 **부산권**: 32개 (평균 조회수 142만, 효율 TOP)
🍞 **대전권**: 28개 (성심당 효과로 156만 평균)

💡 **미개척 지역**: 광주, 울산, 세종 - 성장 잠재력 높음`,
                visualComponent: 'map',
                sources: [],
                createdAt: new Date(Date.now() - 180000)
            },
            {
                id: 'msg-user-3',
                role: 'user',
                content: '이번 달 시즌 콘텐츠 추천해줘',
                createdAt: new Date(Date.now() - 100000)
            },
            {
                id: 'msg-ai-3',
                role: 'assistant',
                content: `**12월 시즌 콘텐츠 추천**

🎄 **크리스마스 특집** (12/20~25)
- 홈파티 음식 대량 구매
- 케이크 먹방 + 디저트 투어

🍗 **연말 치킨 특집** (12/24~31)
- 전국 치킨 맛집 TOP 10
- 치킨 50마리 도전

⏰ **추천 업로드 시점**: 12/18~20 (검색량 피크 예상)`,
                visualComponent: 'calendar',
                sources: [],
                createdAt: new Date(Date.now() - 80000)
            }
        ]
    },
    {
        id: 'session-1',
        title: '초밥 맛집 분석',
        createdAt: new Date('2025-12-17T10:00:00'),
        messages: [
            {
                id: 'msg-1',
                role: 'user',
                content: '쯔양이 최근에 간 초밥집 어디야?',
                createdAt: new Date('2025-12-17T10:00:00'),
            },
            {
                id: 'msg-2',
                role: 'assistant',
                content: '최근 쯔양님이 방문한 초밥집은 **오늘초밥 수지구청점**입니다.\n\n주요 특징:\n- 1접시 890원의 가성비 회전초밥\n- 50~60가지 다양한 메뉴\n- 아귀간한치, 연어장초밥 등 특색 메뉴',
                sources: [
                    {
                        videoTitle: '[쯔양] 890원 회전초밥 121접시 도전!',
                        youtubeLink: 'https://www.youtube.com/watch?v=Tx_yrWwGCL4',
                        timestamp: '0:00',
                        text: '오늘은 초밥을 먹으러 왔는데 제가 진짜 엄청난 가성비 초밥을 먹으러 왔거든요'
                    }
                ],
                createdAt: new Date('2025-12-17T10:00:10'),
            }
        ]
    },
    {
        id: 'session-2',
        title: '지역별 맛집 현황',
        createdAt: new Date('2025-12-16T14:30:00'),
        messages: []
    },
    {
        id: 'session-3',
        title: '시즌별 콘텐츠 트렌드',
        createdAt: new Date('2025-12-15T09:15:00'),
        messages: []
    },
    {
        id: 'session-4',
        title: '고기 맛집 추천',
        createdAt: new Date('2025-12-14T11:20:00'),
        messages: []
    },
    {
        id: 'session-5',
        title: '부산 맛집 분석',
        createdAt: new Date('2025-12-13T16:45:00'),
        messages: []
    }
];

const MOCK_RESPONSES: { [key: string]: { content: string; sources: TranscriptSource[]; visualComponent?: VisualComponentType } } = {
    default: {
        content: '해당 질문에 대한 구체적인 데이터를 찾지 못했습니다.\n\n다음과 같은 질문을 시도해 보세요:\n- "최근 인기 콘텐츠 분석해줘"\n- "초밥 맛집 어디 갔어?"\n- "지역별 맛집 현황 알려줘"\n- "시즌별 추천 콘텐츠는?"',
        sources: []
    },
    '초밥': {
        content: `## 🍣 초밥 콘텐츠 분석

### 최근 방문 초밥집
| 맛집명 | 가격 | 특징 | 조회수 |
|--------|------|------|--------|
| 오늘초밥 수지구청점 | 890원/접시 | 회전초밥 121접시 도전 | 210만 |
| 스시로 강남점 | 1,500원/접시 | 연어 특집 | 89만 |
| 쿠우쿠우 홍대점 | 뷔페 25,900원 | 무한리필 | 156만 |

### 인사이트
- 가성비 초밥집이 조회수 **2배 이상** 높음
- "121접시", "100접시" 등 **도전 포맷**이 효과적
- 연어, 참치 등 **고급 메뉴** 집중 시 반응 좋음

### 추천 콘텐츠 방향
1. 전국 가성비 초밥집 투어
2. 초밥 100접시 시리즈화
3. 오마카세 vs 회전초밥 비교`,
        sources: [
            {
                videoTitle: '[쯔양] 890원 회전초밥 121접시!',
                youtubeLink: 'https://www.youtube.com/watch?v=Tx_yrWwGCL4',
                timestamp: '2:30',
                text: '1접시에 890원, 저는 처음 봐요'
            },
            {
                videoTitle: '[쯔양] 스시로 연어 특집!',
                youtubeLink: 'https://example.com',
                timestamp: '1:15',
                text: '연어가 진짜 신선해요'
            }
        ],
        visualComponent: 'heatmap'
    },
    '조회수': {
        content: `## 📈 조회수 트렌드 분석 (최근 3개월)

### TOP 10 콘텐츠
| 순위 | 제목 | 조회수 | 카테고리 |
|------|------|--------|----------|
| 1 | 890원 회전초밥 121접시 | 210만 | 초밥 |
| 2 | 대전 성심당 빵 대량 구매 | 195만 | 빵 |
| 3 | 전주 한옥마을 비빔밥 | 158만 | 한식 |
| 4 | 서울 삼겹살 맛집 TOP5 | 142만 | 고기 |
| 5 | 부산 해운대 횟집 | 128만 | 해산물 |
| 6 | 대구 막창 골목 | 115만 | 고기 |
| 7 | 제주 흑돼지 먹방 | 108만 | 고기 |
| 8 | 인천 차이나타운 짜장면 | 98만 | 중식 |
| 9 | 강릉 커피거리 투어 | 89만 | 카페 |
| 10 | 춘천 닭갈비 | 82만 | 한식 |

### 카테고리별 평균 조회수
- 🍣 초밥/해산물: 145만
- 🥩 고기: 122만
- 🍞 빵/디저트: 118만
- 🍜 한식: 105만

### 성장 트렌드
- 빵/디저트: **+28%** 급성장
- 지역 투어: **+15%** 꾸준한 상승
- 가성비 콘텐츠: **+35%** 폭발적 성장`,
        sources: [
            {
                videoTitle: '[쯔양] 대전 성심당 빵 대량 구매!',
                youtubeLink: 'https://example.com',
                timestamp: '5:20',
                text: '유명한 튀김소보로를 포함해 인기 메뉴들을 트레이 가득'
            }
        ],
        visualComponent: 'heatmap'
    },
    '지역': {
        content: `## 🗺️ 지역별 맛집 분포 분석

### TOP 10 지역
| 순위 | 지역 | 맛집 수 | 비율 | 평균 조회수 |
|------|------|---------|------|-------------|
| 1 | 서울 | 98개 | 31% | 125만 |
| 2 | 경기 | 65개 | 21% | 108만 |
| 3 | 부산 | 32개 | 10% | 142만 |
| 4 | 대전 | 28개 | 9% | 156만 |
| 5 | 전주 | 18개 | 6% | 135만 |
| 6 | 대구 | 15개 | 5% | 98만 |
| 7 | 인천 | 14개 | 4% | 89만 |
| 8 | 제주 | 12개 | 4% | 148만 |
| 9 | 강릉 | 10개 | 3% | 92만 |
| 10 | 춘천 | 8개 | 3% | 85만 |

### 인사이트
- **수도권 집중도**: 52% (서울+경기)
- **조회수 효율 TOP**: 대전, 제주, 부산 (지방 콘텐츠)
- **미개척 지역**: 광주, 울산, 세종 (성장 잠재력)

### 지역 콘텐츠 추천
1. 🔥 대전: 성심당 외 로컬 맛집 발굴
2. 🌊 부산: 해산물 + 돼지국밥 시리즈
3. 🍃 제주: 흑돼지 + 해산물 투어`,
        sources: [],
        visualComponent: 'map'
    },
    '고기': {
        content: `## 🥩 고기 콘텐츠 분석

### 최근 방문 고기집
| 맛집명 | 지역 | 메뉴 | 조회수 |
|--------|------|------|--------|
| 하남돼지집 | 서울 | 삼겹살 | 142만 |
| 대구 막창골목 | 대구 | 막창 | 115만 |
| 제주 흑돼지 | 제주 | 흑돼지 | 108만 |
| 수원왕갈비 | 수원 | 갈비 | 95만 |
| 춘천 닭갈비 | 춘천 | 닭갈비 | 82만 |

### 고기 카테고리 분석
- **삼겹살**: 가장 높은 조회수, 꾸준한 인기
- **특수부위**: 막창, 곱창 등 마니아층 타겟
- **지역 특산**: 제주 흑돼지, 수원 갈비 등 차별화

### 추천 콘텐츠
1. 전국 삼겹살 맛집 TOP 10
2. 특수부위 챌린지 (막창, 곱창, 대창)
3. 고기 무한리필 도전`,
        sources: [
            {
                videoTitle: '[쯔양] 서울 삼겹살 맛집 TOP5',
                youtubeLink: 'https://example.com',
                timestamp: '3:45',
                text: '이 집 삼겹살 진짜 두꺼워요'
            }
        ],
        visualComponent: 'heatmap'
    },
    '빵': {
        content: `## 🍞 빵/베이커리 콘텐츠 분석

### 최근 방문 베이커리
| 맛집명 | 지역 | 시그니처 | 조회수 |
|--------|------|----------|--------|
| 성심당 | 대전 | 튀김소보로 | 195만 |
| 태극당 | 서울 | 야채사라다빵 | 78만 |
| 기장빵집 | 부산 | 소금빵 | 65만 |
| 뚜레쥬르 대량구매 | 전국 | 다양 | 52만 |

### 인사이트
- **성심당 효과**: 대전 콘텐츠 조회수 견인
- **대량 구매** 포맷이 시청자 반응 좋음
- 빵/디저트 카테고리 **+28% 성장**

### 빵 콘텐츠 추천
1. 전국 유명 빵집 투어
2. 빵 100개 대량 구매 시리즈
3. 지역별 시그니처 빵 탐방`,
        sources: [
            {
                videoTitle: '[쯔양] 대전 성심당 빵 대량 구매!',
                youtubeLink: 'https://example.com',
                timestamp: '2:10',
                text: '튀김소보로 20개 주세요!'
            }
        ],
        visualComponent: 'wordcloud'
    },
    '시즌': {
        content: `## 📅 시즌별 콘텐츠 분석

### 월별 인기 키워드
| 월 | 키워드 | 추천 콘텐츠 |
|----|--------|-------------|
| 1월 | 떡국, 설음식 | 설 맞이 전통 음식 |
| 2월 | 발렌타인, 딸기 | 딸기 디저트 투어 |
| 3월 | 봄나물, 꽃구경 | 봄 시즌 한정 메뉴 |
| 4월 | 벚꽃, 도시락 | 벚꽃 명소 맛집 |
| 5월 | 어버이날, 가정식 | 효도 맛집 |
| 6월 | 냉면, 콩국수 | 여름 시원한 음식 |
| 7월 | 삼계탕, 보양식 | 복날 특집 |
| 8월 | 휴가, 바다 | 해수욕장 맛집 |
| 9월 | 추석, 송편 | 추석 음식 |
| 10월 | 축제, 야외 | 축제장 맛집 |
| 11월 | 김장, 김치 | 김장 특집 |
| 12월 | 크리스마스 | 연말 파티 음식 |

### 현재 시즌 추천 (12월)
- 🎄 크리스마스 홈파티 음식
- 🍗 연말 치킨 특집
- 🎂 케이크/디저트 대량 구매`,
        sources: [],
        visualComponent: 'calendar'
    },
    '부산': {
        content: `## 🌊 부산 맛집 분석

### 부산 방문 맛집 (32개)
| 맛집명 | 카테고리 | 조회수 | 특징 |
|--------|----------|--------|------|
| 해운대 횟집 | 해산물 | 128만 | 회 대량 주문 |
| 기장 멸치국수 | 면류 | 85만 | 멸치 육수 |
| 부평 깡통시장 | 분식 | 72만 | 야시장 |
| 자갈치시장 | 해산물 | 95만 | 싱싱한 회 |
| 밀면골목 | 면류 | 68만 | 부산 대표 음식 |

### 인사이트
- **해산물** 콘텐츠 평균 조회수 142만
- 자갈치, 해운대 등 **관광지 연계** 효과적
- 부산 고유 음식 (밀면, 돼지국밥) 반응 좋음

### 추천 콘텐츠
1. 자갈치 시장 해산물 올킬
2. 부산 돼지국밥 맛집 TOP5
3. 해운대 해변 맛집 투어`,
        sources: [
            {
                videoTitle: '[쯔양] 부산 해운대 횟집 먹방',
                youtubeLink: 'https://example.com',
                timestamp: '4:30',
                text: '회가 정말 신선해요'
            }
        ],
        visualComponent: 'map'
    },
    '추천': {
        content: `## 💡 콘텐츠 추천 분석

### 데이터 기반 추천 콘텐츠 TOP 5

#### 1. 🍣 전국 가성비 초밥집 투어
- 예상 조회수: 180만+
- 근거: 890원 초밥 영상 210만 조회 기록
- 키워드: 가성비, 도전, 대식

#### 2. 🥩 특수부위 무한리필 도전
- 예상 조회수: 150만+
- 근거: 고기 콘텐츠 평균 122만 조회
- 키워드: 도전, 무한리필, 막창

#### 3. 🍞 전국 빵지순례 시리즈
- 예상 조회수: 140만+
- 근거: 성심당 195만 조회 + 빵 카테고리 28% 성장
- 키워드: 대량구매, 지역특산

#### 4. 🌊 제주도 먹방 투어
- 예상 조회수: 130만+
- 근거: 제주 콘텐츠 평균 148만 조회
- 키워드: 흑돼지, 해산물, 여행

#### 5. 🎄 크리스마스 특집
- 예상 조회수: 120만+
- 근거: 시즌 콘텐츠 반응 좋음
- 키워드: 파티, 케이크, 치킨`,
        sources: [],
        visualComponent: 'stats'
    },
    '인기': {
        content: `## 🔥 인기 콘텐츠 상세 분석

### 최근 30일 TOP 5

#### 1위: 890원 회전초밥 121접시 (210만)
- **성공 요인**: 극단적 가성비 + 도전 포맷
- **피크 구간**: 100접시 돌파 순간 (8분 30초)
- **댓글 키워드**: "가성비", "미쳤다", "도전"

#### 2위: 대전 성심당 빵 대량 구매 (195만)
- **성공 요인**: 유명 베이커리 + 대량 구매
- **피크 구간**: 트레이 가득 담는 장면 (5분 20초)
- **댓글 키워드**: "빵지순례", "성심당", "부럽다"

#### 3위: 전주 한옥마을 비빔밥 (158만)
- **성공 요인**: 지역 맛집 투어 + 전통 음식
- **피크 구간**: 비빔밥 비비는 장면 (4분 10초)
- **댓글 키워드**: "전주", "비빔밥", "여행"

### 성공 패턴 분석
1. **도전 포맷**: "100개", "대량", "올킬" 키워드
2. **가성비**: 저렴한 가격 강조
3. **지역 특산**: 로컬 맛집 발굴`,
        sources: [
            {
                videoTitle: '[쯔양] 890원 회전초밥 121접시!',
                youtubeLink: 'https://www.youtube.com/watch?v=Tx_yrWwGCL4',
                timestamp: '8:30',
                text: '100접시 돌파!'
            }
        ],
        visualComponent: 'wordcloud'
    }
};

// [COMPONENT] 미니 히트맵 (컴팩트 버전)
const MiniHeatmap = memo(() => (
    <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
        <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-red-400" />
            <span className="text-xs font-medium">인기 구간 히트맵</span>
        </div>
        <div className="flex gap-0.5 h-8">
            {Array.from({ length: 20 }, (_, i) => {
                const intensity = Math.sin(i * 0.5) * 0.3 + 0.5 + (i > 8 && i < 14 ? 0.3 : 0);
                return (
                    <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                            backgroundColor: `rgba(239, 68, 68, ${intensity})`,
                        }}
                        title={`${Math.round(intensity * 100)}%`}
                    />
                );
            })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0:00</span>
            <span className="text-red-400 font-medium">🔥 피크: 4:30</span>
            <span>15:32</span>
        </div>
    </div>
));
MiniHeatmap.displayName = 'MiniHeatmap';

// [COMPONENT] 미니 지도 (컴팩트 버전)
const MiniMap = memo(() => (
    <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
        <div className="flex items-center gap-2 mb-2">
            <MapPin className="h-4 w-4 text-green-400" />
            <span className="text-xs font-medium">맛집 분포도</span>
        </div>
        <div className="relative h-24 bg-gradient-to-br from-green-900/30 to-blue-900/30 rounded-lg overflow-hidden">
            {/* 간단한 지도 시각화 */}
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="grid grid-cols-5 gap-1 p-2">
                    {[
                        { size: 'lg', pos: 'top-2 left-8' },
                        { size: 'md', pos: 'top-4 right-6' },
                        { size: 'sm', pos: 'bottom-3 left-4' },
                        { size: 'md', pos: 'bottom-2 right-8' },
                        { size: 'lg', pos: 'center' },
                    ].map((marker, i) => (
                        <div key={i} className={cn(
                            "rounded-full bg-primary animate-pulse",
                            marker.size === 'lg' ? 'w-3 h-3' : marker.size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5'
                        )} />
                    ))}
                </div>
            </div>
            <div className="absolute bottom-1 right-1 text-[8px] bg-black/50 px-1 rounded">
                서울/경기 52%
            </div>
        </div>
    </div>
));
MiniMap.displayName = 'MiniMap';

// [COMPONENT] 미니 워드클라우드 (컴팩트 버전)
const MiniWordCloud = memo(() => (
    <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
        <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <span className="text-xs font-medium">인기 키워드</span>
        </div>
        <div className="flex flex-wrap gap-1">
            {[
                { text: '삼겹살', size: 'lg', color: 'text-red-400' },
                { text: '초밥', size: 'lg', color: 'text-orange-400' },
                { text: '성심당', size: 'md', color: 'text-yellow-400' },
                { text: '가성비', size: 'md', color: 'text-green-400' },
                { text: '대식가', size: 'sm', color: 'text-blue-400' },
                { text: '맛집', size: 'lg', color: 'text-purple-400' },
                { text: '부산', size: 'sm', color: 'text-pink-400' },
                { text: '빵', size: 'md', color: 'text-amber-400' },
            ].map((word, i) => (
                <span key={i} className={cn(
                    "px-1.5 py-0.5 rounded bg-secondary/50",
                    word.color,
                    word.size === 'lg' ? 'text-sm font-bold' : word.size === 'md' ? 'text-xs font-medium' : 'text-[10px]'
                )}>
                    {word.text}
                </span>
            ))}
        </div>
    </div>
));
MiniWordCloud.displayName = 'MiniWordCloud';

// [COMPONENT] 미니 캘린더 (컴팩트 버전)
const MiniCalendar = memo(() => (
    <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
        <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-blue-400" />
            <span className="text-xs font-medium">12월 시즌 추천</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
            {[
                { emoji: '🎄', text: '크리스마스', date: '12/20~25' },
                { emoji: '🍗', text: '연말 치킨', date: '12/24~31' },
                { emoji: '🎂', text: '케이크', date: '12/20~25' },
            ].map((item, i) => (
                <div key={i} className="text-center p-1.5 bg-secondary/50 rounded">
                    <div className="text-lg">{item.emoji}</div>
                    <div className="text-[10px] font-medium">{item.text}</div>
                    <div className="text-[8px] text-muted-foreground">{item.date}</div>
                </div>
            ))}
        </div>
    </div>
));
MiniCalendar.displayName = 'MiniCalendar';

// [COMPONENT] 미니 통계 카드
const MiniStats = memo(() => (
    <div className="grid grid-cols-4 gap-2 mt-2">
        {[
            { label: '영상', value: '127', change: '+8', color: 'from-blue-500/20 to-blue-600/10' },
            { label: '조회수', value: '142만', change: '▲12%', color: 'from-green-500/20 to-green-600/10' },
            { label: '맛집', value: '312', change: '+15', color: 'from-orange-500/20 to-orange-600/10' },
            { label: '자막', value: '1,024', change: '', color: 'from-purple-500/20 to-purple-600/10' },
        ].map((stat, i) => (
            <div key={i} className={cn("bg-gradient-to-br rounded-lg p-2 border border-border/30", stat.color)}>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                <p className="text-sm font-bold">{stat.value}</p>
                {stat.change && <p className="text-[10px] text-green-400">{stat.change}</p>}
            </div>
        ))}
    </div>
));
MiniStats.displayName = 'MiniStats';

// [COMPONENT] 시각화 컴포넌트 렌더러
const VisualComponentRenderer = memo(({ type }: { type: VisualComponentType }) => {
    switch (type) {
        case 'heatmap': return <MiniHeatmap />;
        case 'map': return <MiniMap />;
        case 'wordcloud': return <MiniWordCloud />;
        case 'calendar': return <MiniCalendar />;
        case 'stats': return <MiniStats />;
        default: return null;
    }
});
VisualComponentRenderer.displayName = 'VisualComponentRenderer';

// [COMPONENT] 채팅 메시지 컴포넌트
const ChatMessageBubble = memo(({ message }: { message: ChatMessage }) => {
    const isUser = message.role === 'user';

    return (
        <div className={cn(
            "flex gap-3 mb-5 animate-in fade-in slide-in-from-bottom-2 duration-300",
            isUser ? "flex-row-reverse" : "flex-row"
        )}>
            <div className={cn(
                "h-9 w-9 rounded-full flex items-center justify-center shrink-0 shadow-lg",
                isUser
                    ? "bg-gradient-to-br from-primary to-primary/80 ring-2 ring-primary/20"
                    : "bg-gradient-to-br from-violet-500 to-purple-600 ring-2 ring-violet-500/20"
            )}>
                {isUser ? (
                    <User className="h-4 w-4 text-primary-foreground" />
                ) : (
                    <Bot className="h-4 w-4 text-white" />
                )}
            </div>
            <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 shadow-md transition-all hover:shadow-lg",
                isUser
                    ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground"
                    : "bg-gradient-to-br from-secondary/80 to-secondary/50 text-foreground border border-border/30"
            )}>
                {isUser ? (
                    <p className="text-sm font-medium">{message.content}</p>
                ) : (
                    <div className="prose prose-sm prose-invert max-w-none
                        [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-2 [&_h2]:text-foreground
                        [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-foreground
                        [&_h4]:text-sm [&_h4]:font-medium [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:text-foreground
                        [&_p]:text-sm [&_p]:mb-2 [&_p]:text-foreground/90 [&_p]:leading-relaxed
                        [&_ul]:text-sm [&_ul]:mb-2 [&_ul]:pl-4
                        [&_ol]:text-sm [&_ol]:mb-2 [&_ol]:pl-4
                        [&_li]:mb-1 [&_li]:text-foreground/90
                        [&_strong]:text-primary [&_strong]:font-semibold
                        [&_table]:w-full [&_table]:text-xs [&_table]:mb-3
                        [&_table]:border-collapse [&_table]:rounded-lg [&_table]:overflow-hidden
                        [&_th]:bg-primary/20 [&_th]:text-foreground [&_th]:font-medium
                        [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:border-b [&_th]:border-border/50
                        [&_td]:px-2 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-border/30 [&_td]:text-foreground/80
                        [&_tr:hover]:bg-primary/5
                        [&_hr]:border-border/50 [&_hr]:my-3
                        [&_a]:text-blue-400 [&_a]:no-underline hover:[&_a]:underline
                        [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs
                    ">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                        </ReactMarkdown>
                    </div>
                )}

                {/* 시각화 컴포넌트 */}
                {message.visualComponent && (
                    <VisualComponentRenderer type={message.visualComponent} />
                )}

                {/* 출처 표시 */}
                {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/30">
                        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> 참고 자료
                        </p>
                        <div className="space-y-1">
                            {message.sources.map((source, idx) => (
                                <a
                                    key={idx}
                                    href={source.youtubeLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 rounded px-2 py-1 hover:bg-blue-500/20"
                                >
                                    {source.videoTitle} ({source.timestamp})
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});
ChatMessageBubble.displayName = 'ChatMessageBubble';

// [COMPONENT] 세션 목록 아이템
const SessionListItem = memo(({
    session,
    isActive,
    onClick
}: {
    session: ChatSession;
    isActive: boolean;
    onClick: () => void;
}) => (
    <button
        onClick={onClick}
        className={cn(
            "w-full text-left px-3 py-2.5 rounded-xl transition-all duration-200 text-sm group",
            isActive
                ? "bg-gradient-to-r from-primary/20 to-violet-500/10 text-primary border border-primary/30 shadow-sm"
                : "hover:bg-secondary/70 text-muted-foreground hover:text-foreground border border-transparent"
        )}
    >
        <div className="flex items-center gap-2">
            <MessageSquare className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
            )} />
            <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{session.title}</p>
                <p className="text-[10px] opacity-60">
                    {session.createdAt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                </p>
            </div>
        </div>
    </button>
));
SessionListItem.displayName = 'SessionListItem';

// [MAIN] 인사이트 채팅 섹션 컴포넌트 (탭 콘텐츠 전체 영역용)
const InsightChatSectionComponent = () => {
    const [sessions, setSessions] = useState<ChatSession[]>(MOCK_SESSIONS);
    const [activeSessionId, setActiveSessionId] = useState<string>(MOCK_SESSIONS[0]?.id || '');
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const activeSession = sessions.find(s => s.id === activeSessionId);

    // 메시지 스크롤
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [activeSession?.messages.length, scrollToBottom]);

    // 새 세션 생성
    const handleNewSession = useCallback(() => {
        const newSession: ChatSession = {
            id: `session-${Date.now()}`,
            title: '새 대화',
            createdAt: new Date(),
            messages: []
        };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
        setInputValue('');
    }, []);

    // 메시지 전송
    const handleSendMessage = useCallback(async () => {
        if (!inputValue.trim() || isLoading) return;

        const userMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'user',
            content: inputValue.trim(),
            createdAt: new Date()
        };

        // 사용자 메시지 추가
        setSessions(prev => prev.map(session =>
            session.id === activeSessionId
                ? {
                    ...session,
                    messages: [...session.messages, userMessage],
                    title: session.messages.length === 0 ? inputValue.trim().slice(0, 20) + '...' : session.title
                }
                : session
        ));

        setInputValue('');
        setIsLoading(true);

        // 모의 응답 생성 (실제로는 API 호출)
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 키워드 매칭으로 응답 선택
        const keywords = Object.keys(MOCK_RESPONSES);
        const matchedKeyword = keywords.find(keyword =>
            userMessage.content.includes(keyword)
        ) || 'default';

        const response = MOCK_RESPONSES[matchedKeyword];

        const assistantMessage: ChatMessage = {
            id: `msg-${Date.now()}-response`,
            role: 'assistant',
            content: response.content,
            sources: response.sources,
            visualComponent: response.visualComponent,
            createdAt: new Date()
        };

        setSessions(prev => prev.map(session =>
            session.id === activeSessionId
                ? { ...session, messages: [...session.messages, assistantMessage] }
                : session
        ));

        setIsLoading(false);
    }, [inputValue, activeSessionId, isLoading]);

    // 엔터키 처리
    const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    }, [handleSendMessage]);

    return (
        <Card className="h-full border-primary/20 bg-gradient-to-br from-card to-primary/5">
            <CardContent className="h-full p-4">
                <div className="flex gap-4 h-full">
                    {/* 좌측: 세션 목록 */}
                    <div className="w-56 shrink-0 border-r border-border pr-4 flex flex-col">
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full mb-3 gap-2"
                            onClick={handleNewSession}
                        >
                            <Plus className="h-4 w-4" />
                            새 대화
                        </Button>
                        <ScrollArea className="flex-1">
                            <div className="space-y-2">
                                {sessions.map(session => (
                                    <SessionListItem
                                        key={session.id}
                                        session={session}
                                        isActive={session.id === activeSessionId}
                                        onClick={() => setActiveSessionId(session.id)}
                                    />
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* 우측: 채팅 영역 */}
                    <div className="flex-1 flex flex-col min-w-0">
                        {/* 메시지 목록 */}
                        <ScrollArea className="flex-1 pr-4">
                            <div className="py-2">
                                {activeSession?.messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
                                        <div className="h-20 w-20 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center mb-6">
                                            <MessageSquare className="h-10 w-10 text-primary/50" />
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2">인사이트 분석을 시작하세요</h3>
                                        <p className="text-muted-foreground text-sm mb-6">
                                            쯔양 자막 데이터를 기반으로<br />
                                            콘텐츠 인사이트를 분석해 드립니다.
                                        </p>
                                        <div className="flex flex-wrap gap-2 justify-center max-w-md">
                                            {[
                                                '초밥 맛집 어디야?',
                                                '조회수 트렌드 분석',
                                                '지역별 맛집 현황',
                                                '최근 인기 콘텐츠는?'
                                            ].map(suggestion => (
                                                <Button
                                                    key={suggestion}
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-xs"
                                                    onClick={() => {
                                                        setInputValue(suggestion);
                                                        inputRef.current?.focus();
                                                    }}
                                                >
                                                    {suggestion}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    activeSession?.messages.map(message => (
                                        <ChatMessageBubble key={message.id} message={message} />
                                    ))
                                )}

                                {/* 로딩 인디케이터 */}
                                {isLoading && (
                                    <div className="flex gap-3 mb-4">
                                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                            <Bot className="h-4 w-4 text-white" />
                                        </div>
                                        <div className="bg-secondary/70 rounded-2xl px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                <span className="text-sm text-muted-foreground">분석 중...</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </ScrollArea>

                        {/* 입력 영역 */}
                        <div className="flex gap-2 pt-4 border-t border-border">
                            <Input
                                ref={inputRef}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="질문을 입력하세요... (예: 최근 인기 콘텐츠 분석)"
                                className="flex-1"
                                disabled={isLoading}
                            />
                            <Button
                                onClick={handleSendMessage}
                                disabled={!inputValue.trim() || isLoading}
                                size="icon"
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Send className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

// [OPTIMIZATION] memo로 불필요한 리렌더링 방지
const InsightChatSection = memo(InsightChatSectionComponent);
InsightChatSection.displayName = 'InsightChatSection';

export default InsightChatSection;
