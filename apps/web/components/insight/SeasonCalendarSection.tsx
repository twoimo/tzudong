'use client';

import { memo, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    CalendarDays,
    TrendingUp,
    ChevronLeft,
    ChevronRight,
    Flame,
    Clock,
    Video,
    AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

// [TYPE] 시즌 키워드 타입
interface SeasonalKeyword {
    keyword: string;
    category: string;
    peakWeek: string;
    lastYearGrowth: number;
    predictedGrowth: number;
    recommendedUploadDate: string;  // 추천 영상 업로드일
    recommendedShootDate: string;   // 최소 촬영 시작일 (업로드일 - 5~7일)
    relatedVideos: string[];
    icon: string;
    peakDays: number[]; // 해당 월의 피크 일자들
}

interface MonthlySeasonData {
    month: number;
    monthName: string;
    keywords: SeasonalKeyword[];
}

// [MOCK] 월별 시즌 키워드 데이터
const SEASONAL_DATA: MonthlySeasonData[] = [
    {
        month: 1,
        monthName: '1월',
        keywords: [
            {
                keyword: '떡국',
                category: '한식',
                peakWeek: '1월 1주차',
                lastYearGrowth: 420,
                predictedGrowth: 380,
                recommendedUploadDate: '12월 28일',
                recommendedShootDate: '12월 21일',
                relatedVideos: ['[쯔양] 떡국 10그릇 도전', '새해 첫 먹방'],
                icon: '🍲',
                peakDays: [1, 2, 3]
            },
            {
                keyword: '굴',
                category: '해산물',
                peakWeek: '1월 전체',
                lastYearGrowth: 180,
                predictedGrowth: 200,
                recommendedUploadDate: '1월 5일',
                recommendedShootDate: '1월 1일',
                relatedVideos: ['통영 굴 먹방', '굴국밥 탐방'],
                icon: '🦪',
                peakDays: [5, 12, 19, 26]
            },
            {
                keyword: '한우 소고기',
                category: '고기',
                peakWeek: '1월 전체',
                lastYearGrowth: 150,
                predictedGrowth: 170,
                recommendedUploadDate: '1월 10일',
                recommendedShootDate: '1월 3일',
                relatedVideos: ['신년 한우 먹방', '투뿔 한우 코스'],
                icon: '🥩',
                peakDays: [1, 10, 20]
            },
            {
                keyword: '어묵탕',
                category: '분식',
                peakWeek: '1월 전체',
                lastYearGrowth: 120,
                predictedGrowth: 140,
                recommendedUploadDate: '1월 15일',
                recommendedShootDate: '1월 8일',
                relatedVideos: ['겨울 어묵탕 먹방', '부산 어묵 탐방'],
                icon: '🍢',
                peakDays: [5, 15, 25]
            },
        ]
    },
    {
        month: 2,
        monthName: '2월',
        keywords: [
            {
                keyword: '딸기',
                category: '디저트',
                peakWeek: '2월 전체',
                lastYearGrowth: 250,
                predictedGrowth: 280,
                recommendedUploadDate: '2월 1일',
                recommendedShootDate: '2월 1일',
                relatedVideos: ['딸기 뷔페 먹방', '논산 딸기 탐방'],
                icon: '🍓',
                peakDays: [1, 8, 14, 15, 22]
            },
            {
                keyword: '발렌타인 초콜릿',
                category: '디저트',
                peakWeek: '2월 2주차',
                lastYearGrowth: 350,
                predictedGrowth: 320,
                recommendedUploadDate: '2월 10일',
                recommendedShootDate: '2월 3일',
                relatedVideos: ['수제 초콜릿 먹방', '발렌타인 디저트'],
                icon: '🍫',
                peakDays: [12, 13, 14]
            },
            {
                keyword: '정월대보름 오곡밥',
                category: '한식',
                peakWeek: '2월 2주차',
                lastYearGrowth: 280,
                predictedGrowth: 260,
                recommendedUploadDate: '2월 5일',
                recommendedShootDate: '2월 1일',
                relatedVideos: ['정월대보름 특집', '오곡밥 만들기'],
                icon: '🌕',
                peakDays: [12, 15]
            },
            {
                keyword: '호떡',
                category: '분식',
                peakWeek: '2월 전체',
                lastYearGrowth: 130,
                predictedGrowth: 150,
                recommendedUploadDate: '2월 8일',
                recommendedShootDate: '2월 1일',
                relatedVideos: ['겨울 호떡 먹방', '꿀호떡 vs 씨앗호떡'],
                icon: '🥞',
                peakDays: [1, 8, 15, 22]
            },
        ]
    },
    {
        month: 3,
        monthName: '3월',
        keywords: [
            {
                keyword: '봄나물',
                category: '한식',
                peakWeek: '3월 2주차',
                lastYearGrowth: 180,
                predictedGrowth: 190,
                recommendedUploadDate: '3월 8일',
                recommendedShootDate: '3월 1일',
                relatedVideos: ['봄나물 비빔밥', '냉이된장국'],
                icon: '🌱',
                peakDays: [8, 15, 22]
            },
            {
                keyword: '딸기',
                category: '디저트',
                peakWeek: '3월 전체',
                lastYearGrowth: 200,
                predictedGrowth: 220,
                recommendedUploadDate: '3월 1일',
                recommendedShootDate: '3월 1일',
                relatedVideos: ['딸기 케이크 먹방'],
                icon: '🍓',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '도다리쑥국',
                category: '한식',
                peakWeek: '3월 2-3주차',
                lastYearGrowth: 160,
                predictedGrowth: 180,
                recommendedUploadDate: '3월 10일',
                recommendedShootDate: '3월 3일',
                relatedVideos: ['봄 도다리쑥국', '통영 도다리 탐방'],
                icon: '🐟',
                peakDays: [10, 15, 20]
            },
            {
                keyword: '화이트데이 사탕',
                category: '디저트',
                peakWeek: '3월 2주차',
                lastYearGrowth: 220,
                predictedGrowth: 200,
                recommendedUploadDate: '3월 10일',
                recommendedShootDate: '3월 3일',
                relatedVideos: ['화이트데이 특집', '사탕 먹방'],
                icon: '🍬',
                peakDays: [12, 13, 14]
            },
            {
                keyword: '주꾸미',
                category: '해산물',
                peakWeek: '3월 전체',
                lastYearGrowth: 190,
                predictedGrowth: 210,
                recommendedUploadDate: '3월 5일',
                recommendedShootDate: '3월 1일',
                relatedVideos: ['봄 주꾸미 먹방', '주꾸미 삼겹살'],
                icon: '🐙',
                peakDays: [5, 12, 19, 26]
            },
        ]
    },
    {
        month: 4,
        monthName: '4월',
        keywords: [
            {
                keyword: '벚꽃 피크닉',
                category: '분위기',
                peakWeek: '4월 1-2주차',
                lastYearGrowth: 290,
                predictedGrowth: 300,
                recommendedUploadDate: '4월 1일',
                recommendedShootDate: '4월 1일',
                relatedVideos: ['여의도 벚꽃 먹방', '피크닉 도시락'],
                icon: '🌸',
                peakDays: [1, 5, 6, 7, 12, 13]
            },
            {
                keyword: '봄 조개',
                category: '해산물',
                peakWeek: '4월 전체',
                lastYearGrowth: 170,
                predictedGrowth: 190,
                recommendedUploadDate: '4월 5일',
                recommendedShootDate: '4월 1일',
                relatedVideos: ['조개구이 먹방', '서해 조개 탐방'],
                icon: '🦪',
                peakDays: [5, 12, 19, 26]
            },
            {
                keyword: '키조개',
                category: '해산물',
                peakWeek: '4월 2주차',
                lastYearGrowth: 150,
                predictedGrowth: 160,
                recommendedUploadDate: '4월 10일',
                recommendedShootDate: '4월 3일',
                relatedVideos: ['키조개 회 먹방', '키조개 관자 구이'],
                icon: '🐚',
                peakDays: [8, 15, 22]
            },
            {
                keyword: '봄나물 비빔밥',
                category: '한식',
                peakWeek: '4월 전체',
                lastYearGrowth: 140,
                predictedGrowth: 160,
                recommendedUploadDate: '4월 8일',
                recommendedShootDate: '4월 1일',
                relatedVideos: ['전주 비빔밥', '봄 비빔밥 먹방'],
                icon: '🍚',
                peakDays: [1, 8, 15, 22, 29]
            },
        ]
    },
    {
        month: 5,
        monthName: '5월',
        keywords: [
            {
                keyword: '어버이날 외식',
                category: '한식',
                peakWeek: '5월 2주차',
                lastYearGrowth: 220,
                predictedGrowth: 240,
                recommendedUploadDate: '5월 5일',
                recommendedShootDate: '5월 1일',
                relatedVideos: ['가족 외식 추천', '한정식 먹방'],
                icon: '🌹',
                peakDays: [8, 9]
            },
            {
                keyword: '어린이날 특식',
                category: '패밀리',
                peakWeek: '5월 1주차',
                lastYearGrowth: 260,
                predictedGrowth: 280,
                recommendedUploadDate: '5월 1일',
                recommendedShootDate: '5월 1일',
                relatedVideos: ['어린이날 먹방', '키즈카페 음식'],
                icon: '🎈',
                peakDays: [4, 5, 6]
            },
            {
                keyword: '스승의날 케이크',
                category: '디저트',
                peakWeek: '5월 2주차',
                lastYearGrowth: 180,
                predictedGrowth: 200,
                recommendedUploadDate: '5월 12일',
                recommendedShootDate: '5월 5일',
                relatedVideos: ['감사 케이크', '플라워 케이크'],
                icon: '🎂',
                peakDays: [14, 15]
            },
            {
                keyword: '딸기',
                category: '디저트',
                peakWeek: '5월 초',
                lastYearGrowth: 140,
                predictedGrowth: 130,
                recommendedUploadDate: '5월 1일',
                recommendedShootDate: '5월 1일',
                relatedVideos: ['마지막 딸기 시즌', '딸기 먹방'],
                icon: '🍓',
                peakDays: [1, 5, 10]
            },
            {
                keyword: '민어',
                category: '해산물',
                peakWeek: '5월 중순~',
                lastYearGrowth: 160,
                predictedGrowth: 180,
                recommendedUploadDate: '5월 15일',
                recommendedShootDate: '5월 8일',
                relatedVideos: ['민어회 먹방', '목포 민어 탐방'],
                icon: '🐟',
                peakDays: [15, 22, 29]
            },
        ]
    },
    {
        month: 6,
        monthName: '6월',
        keywords: [
            {
                keyword: '냉면',
                category: '면류',
                peakWeek: '6월 3주차~',
                lastYearGrowth: 180,
                predictedGrowth: 200,
                recommendedUploadDate: '6월 15일',
                recommendedShootDate: '6월 8일',
                relatedVideos: ['평양냉면 탐방', '물냉면 vs 비빔냉면'],
                icon: '🍜',
                peakDays: [15, 22, 29]
            },
            {
                keyword: '수박',
                category: '과일',
                peakWeek: '6월 말',
                lastYearGrowth: 150,
                predictedGrowth: 160,
                recommendedUploadDate: '6월 25일',
                recommendedShootDate: '6월 18일',
                relatedVideos: ['수박 한통 먹방'],
                icon: '🍉',
                peakDays: [25, 28, 29, 30]
            },
            {
                keyword: '콩국수',
                category: '면류',
                peakWeek: '6월 중순~',
                lastYearGrowth: 170,
                predictedGrowth: 190,
                recommendedUploadDate: '6월 15일',
                recommendedShootDate: '6월 8일',
                relatedVideos: ['콩국수 맛집', '집에서 콩국수'],
                icon: '🥜',
                peakDays: [15, 20, 25, 30]
            },
            {
                keyword: '장어',
                category: '보양식',
                peakWeek: '6월 말',
                lastYearGrowth: 200,
                predictedGrowth: 220,
                recommendedUploadDate: '6월 20일',
                recommendedShootDate: '6월 13일',
                relatedVideos: ['풍천장어 먹방', '장어구이 탐방'],
                icon: '🐍',
                peakDays: [20, 25, 30]
            },
            {
                keyword: '복숭아',
                category: '과일',
                peakWeek: '6월 말~',
                lastYearGrowth: 130,
                predictedGrowth: 150,
                recommendedUploadDate: '6월 25일',
                recommendedShootDate: '6월 18일',
                relatedVideos: ['천도복숭아', '복숭아 화채'],
                icon: '🍑',
                peakDays: [25, 28, 29, 30]
            },
        ]
    },
    {
        month: 7,
        monthName: '7월',
        keywords: [
            {
                keyword: '삼계탕',
                category: '한식',
                peakWeek: '7월 3주차 (초복)',
                lastYearGrowth: 380,
                predictedGrowth: 400,
                recommendedUploadDate: '7월 10일',
                recommendedShootDate: '7월 3일',
                relatedVideos: ['복날 삼계탕 먹방', '한방 삼계탕'],
                icon: '🍗',
                peakDays: [15, 16, 17, 25]
            },
            {
                keyword: '빙수',
                category: '디저트',
                peakWeek: '7월 전체',
                lastYearGrowth: 280,
                predictedGrowth: 300,
                recommendedUploadDate: '7월 1일',
                recommendedShootDate: '7월 1일',
                relatedVideos: ['망고빙수 먹방', '팥빙수 맛집'],
                icon: '🍧',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '복날 보양식',
                category: '한식',
                peakWeek: '7월 2-4주차',
                lastYearGrowth: 320,
                predictedGrowth: 350,
                recommendedUploadDate: '7월 15일',
                recommendedShootDate: '7월 8일',
                relatedVideos: ['삼복 특집', '보양식 총집합'],
                icon: '🐔',
                peakDays: [15, 17, 25, 27]
            },
            {
                keyword: '아이스크림',
                category: '디저트',
                peakWeek: '7월 전체',
                lastYearGrowth: 200,
                predictedGrowth: 220,
                recommendedUploadDate: '7월 5일',
                recommendedShootDate: '7월 1일',
                relatedVideos: ['아이스크림 뷔페', '젤라또 먹방'],
                icon: '🍦',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '수박',
                category: '과일',
                peakWeek: '7월 전체',
                lastYearGrowth: 250,
                predictedGrowth: 270,
                recommendedUploadDate: '7월 1일',
                recommendedShootDate: '7월 1일',
                relatedVideos: ['수박 먹방', '수박 화채'],
                icon: '🍉',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '전복',
                category: '해산물',
                peakWeek: '7월 전체',
                lastYearGrowth: 180,
                predictedGrowth: 200,
                recommendedUploadDate: '7월 10일',
                recommendedShootDate: '7월 3일',
                relatedVideos: ['전복삼계탕', '전복회 먹방'],
                icon: '🐚',
                peakDays: [10, 17, 24]
            },
        ]
    },
    {
        month: 8,
        monthName: '8월',
        keywords: [
            {
                keyword: '중복/말복 보양식',
                category: '한식',
                peakWeek: '8월 1-2주차',
                lastYearGrowth: 350,
                predictedGrowth: 360,
                recommendedUploadDate: '8월 1일',
                recommendedShootDate: '8월 1일',
                relatedVideos: ['장어 먹방', '민어회 탐방'],
                icon: '🐔',
                peakDays: [5, 6, 15, 16]
            },
            {
                keyword: '복숭아',
                category: '과일',
                peakWeek: '8월 전체',
                lastYearGrowth: 220,
                predictedGrowth: 240,
                recommendedUploadDate: '8월 5일',
                recommendedShootDate: '8월 1일',
                relatedVideos: ['천도복숭아 먹방', '영천 복숭아'],
                icon: '🍑',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '포도',
                category: '과일',
                peakWeek: '8월 중순~',
                lastYearGrowth: 180,
                predictedGrowth: 200,
                recommendedUploadDate: '8월 15일',
                recommendedShootDate: '8월 8일',
                relatedVideos: ['포도 먹방', '샤인머스캣'],
                icon: '🍇',
                peakDays: [15, 20, 25, 30]
            },
            {
                keyword: '삼겹살',
                category: '고기',
                peakWeek: '8월 3일',
                lastYearGrowth: 200,
                predictedGrowth: 220,
                recommendedUploadDate: '8월 1일',
                recommendedShootDate: '8월 1일',
                relatedVideos: ['삼겹살 먹방', '삼겹살데이'],
                icon: '🥓',
                peakDays: [3, 10, 17, 24]
            },
            {
                keyword: '물회',
                category: '해산물',
                peakWeek: '8월 전체',
                lastYearGrowth: 190,
                predictedGrowth: 210,
                recommendedUploadDate: '8월 5일',
                recommendedShootDate: '8월 1일',
                relatedVideos: ['여름 물회 먹방', '포항 물회'],
                icon: '🐟',
                peakDays: [1, 8, 15, 22, 29]
            },
        ]
    },
    {
        month: 9,
        monthName: '9월',
        keywords: [
            {
                keyword: '추석 음식',
                category: '한식',
                peakWeek: '9월 2-3주차',
                lastYearGrowth: 280,
                predictedGrowth: 300,
                recommendedUploadDate: '9월 10일',
                recommendedShootDate: '9월 3일',
                relatedVideos: ['송편 만들기', '추석 한상 먹방'],
                icon: '🌕',
                peakDays: [15, 16, 17, 18]
            },
            {
                keyword: '대게',
                category: '해산물',
                peakWeek: '9월 말~',
                lastYearGrowth: 200,
                predictedGrowth: 220,
                recommendedUploadDate: '9월 25일',
                recommendedShootDate: '9월 18일',
                relatedVideos: ['영덕대게 먹방'],
                icon: '🦀',
                peakDays: [25, 28, 29, 30]
            },
            {
                keyword: '송편',
                category: '한식',
                peakWeek: '9월 중순',
                lastYearGrowth: 350,
                predictedGrowth: 380,
                recommendedUploadDate: '9월 12일',
                recommendedShootDate: '9월 5일',
                relatedVideos: ['송편 100개 도전', '송편 만들기'],
                icon: '🥟',
                peakDays: [14, 15, 16, 17]
            },
            {
                keyword: '전',
                category: '한식',
                peakWeek: '9월 중순',
                lastYearGrowth: 250,
                predictedGrowth: 270,
                recommendedUploadDate: '9월 13일',
                recommendedShootDate: '9월 6일',
                relatedVideos: ['명절 전 먹방', '모듬전 탐방'],
                icon: '🥞',
                peakDays: [14, 15, 16, 17]
            },
            {
                keyword: '배',
                category: '과일',
                peakWeek: '9월 전체',
                lastYearGrowth: 160,
                predictedGrowth: 180,
                recommendedUploadDate: '9월 5일',
                recommendedShootDate: '9월 1일',
                relatedVideos: ['나주 배 먹방', '배즙 만들기'],
                icon: '🍐',
                peakDays: [5, 12, 19, 26]
            },
            {
                keyword: '갈비찜',
                category: '한식',
                peakWeek: '9월 중순',
                lastYearGrowth: 220,
                predictedGrowth: 240,
                recommendedUploadDate: '9월 10일',
                recommendedShootDate: '9월 3일',
                relatedVideos: ['명절 갈비찜', '한우 갈비찜'],
                icon: '🍖',
                peakDays: [14, 15, 16, 17]
            },
        ]
    },
    {
        month: 10,
        monthName: '10월',
        keywords: [
            {
                keyword: '전어',
                category: '해산물',
                peakWeek: '10월 전체',
                lastYearGrowth: 240,
                predictedGrowth: 250,
                recommendedUploadDate: '10월 1일',
                recommendedShootDate: '10월 1일',
                relatedVideos: ['가을 전어 먹방', '전어회 탐방'],
                icon: '🐟',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '꽃게',
                category: '해산물',
                peakWeek: '10월 전체',
                lastYearGrowth: 220,
                predictedGrowth: 230,
                recommendedUploadDate: '10월 5일',
                recommendedShootDate: '10월 1일',
                relatedVideos: ['꽃게찜 먹방', '간장게장'],
                icon: '🦀',
                peakDays: [5, 12, 19, 26]
            },
            {
                keyword: '핼러윈 디저트',
                category: '디저트',
                peakWeek: '10월 4주차',
                lastYearGrowth: 280,
                predictedGrowth: 300,
                recommendedUploadDate: '10월 25일',
                recommendedShootDate: '10월 18일',
                relatedVideos: ['핼러윈 파티', '호박 케이크'],
                icon: '🎃',
                peakDays: [25, 28, 29, 30, 31]
            },
            {
                keyword: '고등어',
                category: '해산물',
                peakWeek: '10월 전체',
                lastYearGrowth: 180,
                predictedGrowth: 200,
                recommendedUploadDate: '10월 5일',
                recommendedShootDate: '10월 1일',
                relatedVideos: ['가을 고등어 구이', '고등어 조림'],
                icon: '🐟',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '사과',
                category: '과일',
                peakWeek: '10월 전체',
                lastYearGrowth: 150,
                predictedGrowth: 170,
                recommendedUploadDate: '10월 1일',
                recommendedShootDate: '10월 1일',
                relatedVideos: ['청송 사과 먹방', '사과 파이'],
                icon: '🍎',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '낙엽피크닉',
                category: '분위기',
                peakWeek: '10월 3-4주차',
                lastYearGrowth: 160,
                predictedGrowth: 180,
                recommendedUploadDate: '10월 20일',
                recommendedShootDate: '10월 13일',
                relatedVideos: ['가을 피크닉', '도시락 먹방'],
                icon: '🍂',
                peakDays: [15, 22, 29]
            },
        ]
    },
    {
        month: 11,
        monthName: '11월',
        keywords: [
            {
                keyword: '대게',
                category: '해산물',
                peakWeek: '11월 전체',
                lastYearGrowth: 260,
                predictedGrowth: 280,
                recommendedUploadDate: '11월 1일',
                recommendedShootDate: '11월 1일',
                relatedVideos: ['대게 10마리 먹방'],
                icon: '🦀',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '굴',
                category: '해산물',
                peakWeek: '11월 중순~',
                lastYearGrowth: 200,
                predictedGrowth: 220,
                recommendedUploadDate: '11월 15일',
                recommendedShootDate: '11월 8일',
                relatedVideos: ['통영 굴 탐방', '굴국밥'],
                icon: '🦪',
                peakDays: [15, 22, 29]
            },
            {
                keyword: '빼빼로데이',
                category: '디저트',
                peakWeek: '11월 2주차',
                lastYearGrowth: 380,
                predictedGrowth: 400,
                recommendedUploadDate: '11월 8일',
                recommendedShootDate: '11월 1일',
                relatedVideos: ['빼빼로 만들기', '빼빼로 먹방'],
                icon: '🍫',
                peakDays: [10, 11, 12]
            },
            {
                keyword: '김장',
                category: '한식',
                peakWeek: '11월 중순~',
                lastYearGrowth: 250,
                predictedGrowth: 270,
                recommendedUploadDate: '11월 10일',
                recommendedShootDate: '11월 3일',
                relatedVideos: ['김장 먹방', '삼겹살 + 김치'],
                icon: '🥬',
                peakDays: [15, 20, 25]
            },
            {
                keyword: '홍시',
                category: '과일',
                peakWeek: '11월 전체',
                lastYearGrowth: 170,
                predictedGrowth: 190,
                recommendedUploadDate: '11월 5일',
                recommendedShootDate: '11월 1일',
                relatedVideos: ['홍시 먹방', '곶감 만들기'],
                icon: '🍊',
                peakDays: [1, 8, 15, 22, 29]
            },
            {
                keyword: '추어탕',
                category: '한식',
                peakWeek: '11월 전체',
                lastYearGrowth: 160,
                predictedGrowth: 180,
                recommendedUploadDate: '11월 10일',
                recommendedShootDate: '11월 3일',
                relatedVideos: ['남원 추어탕', '추어탕 5그릇 도전'],
                icon: '🍲',
                peakDays: [5, 12, 19, 26]
            },
        ]
    },
    {
        month: 12,
        monthName: '12월',
        keywords: [
            {
                keyword: '대방어',
                category: '해산물',
                peakWeek: '12월 3주차',
                lastYearGrowth: 320,
                predictedGrowth: 300,
                recommendedUploadDate: '12월 15일',
                recommendedShootDate: '12월 8일',
                relatedVideos: ['[쯔양] 제주 대방어회 탐방', '방어 대량 먹방'],
                icon: '🐟',
                peakDays: [15, 18, 19, 20, 21, 22]
            },
            {
                keyword: '대게',
                category: '해산물',
                peakWeek: '12월 전체',
                lastYearGrowth: 280,
                predictedGrowth: 250,
                recommendedUploadDate: '12월 10일',
                recommendedShootDate: '12월 3일',
                relatedVideos: ['겨울 대게 먹방', '영덕 대게 탐방'],
                icon: '🦀',
                peakDays: [10, 17, 24]
            },
            {
                keyword: '복어',
                category: '해산물',
                peakWeek: '12월 2주차~',
                lastYearGrowth: 180,
                predictedGrowth: 200,
                recommendedUploadDate: '12월 8일',
                recommendedShootDate: '12월 1일',
                relatedVideos: ['복어 코스 요리', '복지리 먹방'],
                icon: '🐡',
                peakDays: [8, 15, 22, 29]
            },
            {
                keyword: '크리스마스 케이크',
                category: '디저트',
                peakWeek: '12월 4주차',
                lastYearGrowth: 420,
                predictedGrowth: 400,
                recommendedUploadDate: '12월 20일',
                recommendedShootDate: '12월 13일',
                relatedVideos: ['크리스마스 케이크 먹방', '디저트 파티'],
                icon: '🎂',
                peakDays: [22, 23, 24, 25]
            },
            {
                keyword: '크리스마스 치킨',
                category: '패스트푸드',
                peakWeek: '12월 4주차',
                lastYearGrowth: 380,
                predictedGrowth: 350,
                recommendedUploadDate: '12월 22일',
                recommendedShootDate: '12월 15일',
                relatedVideos: ['크리스마스 치킨 파티', '치킨 10마리 도전'],
                icon: '🍗',
                peakDays: [23, 24, 25]
            },
            {
                keyword: '연말 송년회',
                category: '분위기',
                peakWeek: '12월 4주차',
                lastYearGrowth: 200,
                predictedGrowth: 220,
                recommendedUploadDate: '12월 26일',
                recommendedShootDate: '12월 19일',
                relatedVideos: ['송년회 먹방', '연말 술자리'],
                icon: '🥂',
                peakDays: [26, 27, 28, 29, 30, 31]
            },
            {
                keyword: '새해 카운트다운',
                category: '분위기',
                peakWeek: '12월 31일',
                lastYearGrowth: 300,
                predictedGrowth: 320,
                recommendedUploadDate: '12월 30일',
                recommendedShootDate: '12월 23일',
                relatedVideos: ['새해맞이 먹방', '밤샘 먹방 도전'],
                icon: '🎆',
                peakDays: [31]
            },
            {
                keyword: '굴',
                category: '해산물',
                peakWeek: '12월 전체',
                lastYearGrowth: 190,
                predictedGrowth: 210,
                recommendedUploadDate: '12월 5일',
                recommendedShootDate: '12월 1일',
                relatedVideos: ['굴 먹방', '굴전 만들기'],
                icon: '🦪',
                peakDays: [5, 12, 19, 26]
            },
        ]
    },
];

// [COMPONENT] 미니 캘린더
const MiniCalendar = memo(({
    currentMonth,
    currentYear,
    selectedKeywords,
    seasonalData,
    onPrevMonth,
    onNextMonth
}: {
    currentMonth: number;
    currentYear: number;
    selectedKeywords: SeasonalKeyword[];
    seasonalData: MonthlySeasonData | undefined;
    onPrevMonth: () => void;
    onNextMonth: () => void;
}) => {
    const today = new Date();
    const todayDate = today.getDate();
    const todayMonth = today.getMonth() + 1;
    const todayYear = today.getFullYear();

    // 해당 월의 첫 날과 마지막 날
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    // 피크 일자 수집
    const peakDays = useMemo(() => {
        const days = new Set<number>();
        seasonalData?.keywords.forEach(k => {
            k.peakDays.forEach(d => days.add(d));
        });
        return days;
    }, [seasonalData]);

    const days = useMemo(() => {
        const result = [];
        // 빈 칸
        for (let i = 0; i < startDayOfWeek; i++) {
            result.push(null);
        }
        // 일자
        for (let i = 1; i <= daysInMonth; i++) {
            result.push(i);
        }
        return result;
    }, [startDayOfWeek, daysInMonth]);

    const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

    return (
        <Card className="h-full">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <Button variant="ghost" size="icon" onClick={onPrevMonth}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <CardTitle className="text-lg">
                        {currentYear}년 {currentMonth}월
                    </CardTitle>
                    <Button variant="ghost" size="icon" onClick={onNextMonth}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-7 gap-1 text-center">
                    {weekDays.map((day, i) => (
                        <div
                            key={day}
                            className={cn(
                                "text-xs font-medium py-1",
                                i === 0 && "text-red-500",
                                i === 6 && "text-blue-500"
                            )}
                        >
                            {day}
                        </div>
                    ))}
                    {days.map((day, index) => (
                        <div
                            key={index}
                            className={cn(
                                "aspect-square flex items-center justify-center text-sm rounded-md relative",
                                day === null && "invisible",
                                day === todayDate && currentMonth === todayMonth && currentYear === todayYear &&
                                "bg-primary text-primary-foreground font-bold",
                                day !== null && peakDays.has(day) && !(day === todayDate && currentMonth === todayMonth) &&
                                "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-medium"
                            )}
                        >
                            {day}
                            {day !== null && peakDays.has(day) && (
                                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-orange-500 rounded-full" />
                            )}
                        </div>
                    ))}
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <div className="h-2 w-2 bg-primary rounded-full" />
                        <span>오늘</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="h-2 w-2 bg-orange-500 rounded-full" />
                        <span>피크 예상일</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
});
MiniCalendar.displayName = 'MiniCalendar';

// [COMPONENT] 키워드 카드
const KeywordCard = memo(({
    keyword
}: {
    keyword: SeasonalKeyword;
}) => (
    <div className="p-4 rounded-lg border transition-all bg-card border-border hover:border-primary/50">
        <div className="flex items-start gap-3">
            <span className="text-2xl">{keyword.icon}</span>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold">{keyword.keyword}</h4>
                    <Badge variant="secondary" className="text-xs">{keyword.category}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm">
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        +{keyword.predictedGrowth}%
                    </span>
                    <span className="text-muted-foreground">예상 증가</span>
                </div>
                <div className="flex items-center gap-2 mt-2 text-xs">
                    <CalendarDays className="h-3 w-3 text-blue-500" />
                    <span className="text-blue-600 dark:text-blue-400 font-medium">업로드: {keyword.recommendedUploadDate}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs">
                    <Video className="h-3 w-3 text-orange-500" />
                    <span className="text-orange-600 dark:text-orange-400">촬영 시작: {keyword.recommendedShootDate}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>피크: {keyword.peakWeek}</span>
                </div>
            </div>
        </div>
        {keyword.relatedVideos.length > 0 && (
            <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Video className="h-3 w-3" />
                    작년 인기 영상
                </p>
                <div className="flex flex-wrap gap-1">
                    {keyword.relatedVideos.slice(0, 2).map((video, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                            {video}
                        </Badge>
                    ))}
                </div>
            </div>
        )}
    </div>
));
KeywordCard.displayName = 'KeywordCard';

// [COMPONENT] 월별 탭
const MonthTabs = memo(({
    selectedMonth,
    onSelectMonth
}: {
    selectedMonth: number;
    onSelectMonth: (month: number) => void;
}) => {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    return (
        <div className="flex gap-1 overflow-x-auto pb-2">
            {months.map(month => (
                <Button
                    key={month}
                    variant={selectedMonth === month ? "default" : "ghost"}
                    size="sm"
                    onClick={() => onSelectMonth(month)}
                    className="shrink-0"
                >
                    {month}월
                </Button>
            ))}
        </div>
    );
});
MonthTabs.displayName = 'MonthTabs';

// [MAIN] 시즌 캘린더 섹션
const SeasonCalendarSectionComponent = () => {
    const today = new Date();
    const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1);
    const [currentYear, setCurrentYear] = useState(today.getFullYear());

    // 현재 월의 시즌 데이터
    const currentSeasonData = useMemo(() =>
        SEASONAL_DATA.find(s => s.month === currentMonth),
        [currentMonth]
    );

    // 이번 주 핫 키워드 (현재 월 + 다음 월 초반)
    const hotKeywords = useMemo(() => {
        const thisMonth = SEASONAL_DATA.find(s => s.month === today.getMonth() + 1);
        const nextMonth = SEASONAL_DATA.find(s => s.month === (today.getMonth() + 2) % 12 || 12);

        const keywords: SeasonalKeyword[] = [];
        if (thisMonth) keywords.push(...thisMonth.keywords);
        if (nextMonth && today.getDate() > 20) {
            keywords.push(...nextMonth.keywords.slice(0, 2));
        }

        return keywords.sort((a, b) => b.predictedGrowth - a.predictedGrowth).slice(0, 4);
    }, [today]);

    const handlePrevMonth = useCallback(() => {
        if (currentMonth === 1) {
            setCurrentMonth(12);
            setCurrentYear(y => y - 1);
        } else {
            setCurrentMonth(m => m - 1);
        }
    }, [currentMonth]);

    const handleNextMonth = useCallback(() => {
        if (currentMonth === 12) {
            setCurrentMonth(1);
            setCurrentYear(y => y + 1);
        } else {
            setCurrentMonth(m => m + 1);
        }
    }, [currentMonth]);

    return (
        <div className="h-full overflow-auto">
            <div className="flex flex-col gap-4 p-1">
                {/* 상단: 캘린더 + 핫 키워드 */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* 미니 캘린더 */}
                    <MiniCalendar
                        currentMonth={currentMonth}
                        currentYear={currentYear}
                        selectedKeywords={hotKeywords}
                        seasonalData={currentSeasonData}
                        onPrevMonth={handlePrevMonth}
                        onNextMonth={handleNextMonth}
                    />

                    {/* 이번 시즌 핫 키워드 */}
                    <Card className="lg:col-span-2">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Flame className="h-5 w-5 text-orange-500" />
                                🔥 이번 시즌 핫 키워드
                            </CardTitle>
                            <CardDescription>
                                작년 데이터 기반 예측 - 지금 촬영하면 알고리즘 흐름에 탈 수 있어요!
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {hotKeywords.map(keyword => (
                                    <KeywordCard
                                        key={keyword.keyword}
                                        keyword={keyword}
                                    />
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 하단: 월별 트렌드 */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <CalendarDays className="h-5 w-5" />
                            📊 월별 시즌 트렌드
                        </CardTitle>
                        <CardDescription>
                            각 월별 핵심 시즌 키워드를 확인하세요
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <MonthTabs
                            selectedMonth={currentMonth}
                            onSelectMonth={setCurrentMonth}
                        />
                        <Separator className="my-3" />
                        {currentSeasonData ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {currentSeasonData.keywords.map(keyword => (
                                    <KeywordCard
                                        key={keyword.keyword}
                                        keyword={keyword}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                <AlertCircle className="h-12 w-12 mb-3" />
                                <p>{currentMonth}월 시즌 데이터가 없습니다</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

const SeasonCalendarSection = memo(SeasonCalendarSectionComponent);
SeasonCalendarSection.displayName = 'SeasonCalendarSection';

export default SeasonCalendarSection;
