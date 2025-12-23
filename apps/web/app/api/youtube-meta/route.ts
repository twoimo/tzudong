import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// YouTube 비디오 ID 추출
function extractVideoId(url: string): string | null {
    const patterns = [
        /youtube\.com\/watch\?v=([^&]+)/,
        /youtu\.be\/([^?]+)/,
        /youtube\.com\/embed\/([^?]+)/,
        /youtube\.com\/shorts\/([^?]+)/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
}

// ISO 8601 duration을 초로 변환
function parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const seconds = match[3] ? parseInt(match[3]) : 0;

    return hours * 3600 + minutes * 60 + seconds;
}

// 광고/협찬 주체 분석 (api-youtube-meta.py와 동일한 프롬프트)
async function analyzeAdContent(text: string, openai: OpenAI): Promise<string[] | null> {
    const textPreview = text.slice(0, 100);
    
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.3,
            messages: [
                {
                    role: 'system',
                    content: `광고/협찬/지원을 한 **정확한 주체들의 전체 이름(기업명 + 브랜드명 조합 또는 기관명 형태)**을 **리스트** 형식으로 모아 답변하세요.
                    예시: ['하이트진로', '영양군청'], ['하림 멜팅피스']
                    반드시 추측하지 않고 **본문 내용에 쓰여 있는 주체들을 모두 작성**해야 합니다.
                    주체를 찾을 수 없거나 애매하면, 'None'을 출력합니다.`,
                },
                {
                    role: 'user',
                    content: textPreview,
                },
            ],
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content || content.toLowerCase() === 'none') {
            return null;
        }

        // JSON 파싱 시도
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                return parsed.map(x => String(x).trim()).filter(x => x);
            }
            return [String(parsed).trim()];
        } catch {
            // 문자열 하나인 경우
            return [content.trim()];
        }
    } catch (error) {
        console.error('Error analyzing ad content:', error);
        return null;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { youtube_link } = body;

        if (!youtube_link) {
            return NextResponse.json({ error: 'youtube_link is required' }, { status: 400 });
        }

        const videoId = extractVideoId(youtube_link);
        if (!videoId) {
            return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
        }

        const youtubeApiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
        if (!youtubeApiKey) {
            return NextResponse.json({ error: 'YouTube API key not configured' }, { status: 500 });
        }

        // YouTube Data API 호출
        const ytResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${youtubeApiKey}`
        );

        if (!ytResponse.ok) {
            throw new Error(`YouTube API error: ${ytResponse.status}`);
        }

        const ytData = await ytResponse.json();

        if (!ytData.items || ytData.items.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        const videoData = ytData.items[0];
        const snippet = videoData.snippet;
        const contentDetails = videoData.contentDetails;

        const duration = parseDuration(contentDetails.duration);
        const isShorts = duration <= 180;

        // 광고 정보 분석
        const description = snippet.description || '';
        const descriptionLower = description.toLowerCase();
        const adKeywords = ['유료', '광고', '지원', '협찬'];
        const isAds = adKeywords.some(keyword => descriptionLower.includes(keyword));

        let whatAds: string[] | null = null;
        if (isAds) {
            const openaiApiKey = process.env.NEXT_OPENAI_API_KEY_BYEON;
            if (openaiApiKey) {
                const openai = new OpenAI({ apiKey: openaiApiKey });
                whatAds = await analyzeAdContent(description, openai);
            }
        }

        const result = {
            title: snippet.title,
            publishedAt: snippet.publishedAt,
            duration,
            is_shorts: isShorts,
            ads_info: {
                is_ads: isAds,
                what_ads: whatAds,
            },
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('YouTube metadata fetch error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch YouTube metadata' },
            { status: 500 }
        );
    }
}
