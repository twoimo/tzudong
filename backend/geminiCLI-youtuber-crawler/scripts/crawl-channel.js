/**
 * 유튜브 채널 영상 목록 수집 스크립트
 * 정육왕 MeatCreator 채널의 모든 영상 정보를 수집합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 로드
const envPaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        config({ path: envPath });
        break;
    }
}

// 설정
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY_BYEON;
const CHANNEL_HANDLE = '@meatcreator'; // 정육왕 MeatCreator

// 디버깅: API 키 확인
console.log(`[DEBUG] YOUTUBE_API_KEY 설정됨: ${YOUTUBE_API_KEY ? '예 (길이: ' + YOUTUBE_API_KEY.length + ')' : '아니오'}`);

// 한국 시간 (KST)
function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}

function getTodayFolder() {
    const pipelineDate = process.env.PIPELINE_DATE;
    if (pipelineDate) return pipelineDate;

    const now = getKSTDate();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

// 데이터 디렉토리
const DATA_DIR = path.resolve(__dirname, '../data');
const TODAY_FOLDER = getTodayFolder();
const TODAY_PATH = path.join(DATA_DIR, TODAY_FOLDER);

// 디렉토리 생성
if (!fs.existsSync(TODAY_PATH)) {
    fs.mkdirSync(TODAY_PATH, { recursive: true });
}

// 로그 함수
function log(level, msg) {
    const time = getKSTDate().toTimeString().slice(0, 8);
    const tags = { info: '[INFO]', success: '[OK]', warning: '[WARN]', error: '[ERR]', debug: '[DBG]' };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

/**
 * 핸들(@username)로 채널 정보 가져오기
 * YouTube API v3의 forHandle 파라미터 사용
 */
async function getChannelByHandle(handle) {
    // @ 기호 제거 (있는 경우)
    const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;

    log('info', `핸들로 채널 검색: ${cleanHandle}`);

    const url = `https://www.googleapis.com/youtube/v3/channels?part=id,snippet,contentDetails&forHandle=${encodeURIComponent(cleanHandle)}&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
        log('error', `API 응답: ${JSON.stringify(data.error)}`);
        throw new Error(`YouTube API 오류: ${data.error.message}`);
    }

    if (!data.items || data.items.length === 0) {
        // forHandle이 작동하지 않으면 검색 API로 폴백
        log('warning', 'forHandle로 채널을 찾을 수 없습니다. 검색 API로 시도...');
        return await searchChannelByName(cleanHandle);
    }

    const channel = data.items[0];
    log('success', `채널 발견: ${channel.snippet.title} (ID: ${channel.id})`);

    return {
        id: channel.id,
        title: channel.snippet.title,
        uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    };
}

/**
 * 검색 API로 채널 찾기 (폴백)
 */
async function searchChannelByName(query) {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=channel&maxResults=5&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(searchUrl);
    const data = await response.json();

    if (data.error) {
        throw new Error(`YouTube 검색 API 오류: ${data.error.message}`);
    }

    if (!data.items || data.items.length === 0) {
        throw new Error(`채널을 찾을 수 없습니다: ${query}`);
    }

    // 검색 결과에서 첫 번째 채널 사용
    const channelId = data.items[0].snippet.channelId;
    const channelTitle = data.items[0].snippet.title;

    log('info', `검색 결과 채널: ${channelTitle} (ID: ${channelId})`);

    // 채널 상세 정보 가져오기
    return await getChannelById(channelId);
}

/**
 * 채널 ID로 채널 정보 가져오기
 */
async function getChannelById(channelId) {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id,snippet,contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
        throw new Error(`YouTube API 오류: ${data.error.message}`);
    }

    if (!data.items || data.items.length === 0) {
        throw new Error('채널을 찾을 수 없습니다.');
    }

    const channel = data.items[0];

    return {
        id: channel.id,
        title: channel.snippet.title,
        uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    };
}

/**
 * 플레이리스트의 모든 영상 가져오기
 */
async function getAllVideosFromPlaylist(playlistId, maxResults = null) {
    const videos = [];
    let nextPageToken = null;
    let pageCount = 0;

    do {
        const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
        url.searchParams.set('part', 'snippet,contentDetails');
        url.searchParams.set('playlistId', playlistId);
        url.searchParams.set('maxResults', '50');
        url.searchParams.set('key', YOUTUBE_API_KEY);
        if (nextPageToken) {
            url.searchParams.set('pageToken', nextPageToken);
        }

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.error) {
            throw new Error(`YouTube API 오류: ${data.error.message}`);
        }

        pageCount++;

        for (const item of data.items) {
            const videoId = item.contentDetails.videoId;
            const snippet = item.snippet;

            videos.push({
                videoId,
                youtube_link: `https://www.youtube.com/watch?v=${videoId}`,
                title: snippet.title,
                description: snippet.description,
                publishedAt: snippet.publishedAt,
                thumbnails: snippet.thumbnails,
                channelTitle: snippet.channelTitle,
                channelId: snippet.channelId,
            });
        }

        log('info', `페이지 ${pageCount} 완료 - 현재 ${videos.length}개 영상`);

        nextPageToken = data.nextPageToken;

        // maxResults 제한
        if (maxResults && videos.length >= maxResults) {
            videos.length = maxResults;
            break;
        }

        // Rate limit 대응 (1-2초 랜덤 딜레이)
        if (nextPageToken) {
            const delay = 1000 + Math.floor(Math.random() * 1000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

    } while (nextPageToken);

    return videos;
}

/**
 * 영상 상세 정보 가져오기 (배치)
 */
async function getVideoDetails(videoIds) {
    const details = {};
    const batchSize = 50;

    for (let i = 0; i < videoIds.length; i += batchSize) {
        const batch = videoIds.slice(i, i + batchSize);
        const url = new URL('https://www.googleapis.com/youtube/v3/videos');
        url.searchParams.set('part', 'snippet,contentDetails,statistics');
        url.searchParams.set('id', batch.join(','));
        url.searchParams.set('key', YOUTUBE_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.error) {
            log('warning', `영상 상세 정보 조회 실패: ${data.error.message}`);
            continue;
        }

        for (const item of data.items) {
            details[item.id] = {
                duration: item.contentDetails.duration,
                viewCount: parseInt(item.statistics.viewCount || '0'),
                likeCount: parseInt(item.statistics.likeCount || '0'),
                commentCount: parseInt(item.statistics.commentCount || '0'),
                description: item.snippet.description,
                tags: item.snippet.tags || [],
            };
        }

        log('debug', `영상 상세 정보 ${i + batch.length}/${videoIds.length} 완료`);

        // Rate limit 대응 (1-2초 랜덤 딜레이)
        const delay = 1000 + Math.floor(Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    return details;
}

/**
 * ISO 8601 duration을 초로 변환
 */
function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    return hours * 3600 + minutes * 60 + seconds;
}

/**
 * description에서 지도 URL 추출
 */
function extractMapUrls(description) {
    const mapUrls = [];

    // 각 지도 서비스별 패턴
    const patterns = [
        // 구글 지도
        { type: 'google', regex: /https?:\/\/(?:www\.)?(?:maps\.google\.com|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s\n)>]*/gi },
        // 네이버 지도
        { type: 'naver', regex: /https?:\/\/(?:naver\.me|map\.naver\.com|place\.naver\.com)[^\s\n)>]*/gi },
        // 카카오 지도
        { type: 'kakao', regex: /https?:\/\/(?:map\.kakao\.com|kko\.to)[^\s\n)>]*/gi },
    ];

    for (const { type, regex } of patterns) {
        const matches = description.match(regex) || [];
        for (const url of matches) {
            mapUrls.push({ type, url: url.trim() });
        }
    }

    return mapUrls;
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '='.repeat(60));
    log('info', '  정육왕 MeatCreator 채널 크롤링 시작');
    log('info', '='.repeat(60));

    if (!YOUTUBE_API_KEY) {
        log('error', 'YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.');
        process.exit(1);
    }

    // 캐시 체크: 기존 데이터가 있고 6시간 이내면 스킵
    const outputFile = path.join(TODAY_PATH, 'meatcreator_videos.json');
    const CACHE_HOURS = 6; // 캐시 유효 시간 (시간)
    const FORCE_CRAWL = process.env.FORCE_CRAWL === 'true'; // 강제 크롤링 옵션

    if (!FORCE_CRAWL && fs.existsSync(outputFile)) {
        const stats = fs.statSync(outputFile);
        const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

        if (ageHours < CACHE_HOURS) {
            log('success', `캐시 유효 (${Math.round(ageHours * 60)}분 전 수집) - 크롤링 스킵`);

            // 기존 데이터 로드하여 통계 출력
            try {
                const existingData = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
                log('info', `기존 데이터: ${existingData.videos?.length || 0}개 영상`);
                log('info', `지도 URL 포함: ${existingData.stats?.videosWithMapUrl || 0}개`);
            } catch { }

            log('info', '💡 강제 크롤링: FORCE_CRAWL=true bun run crawl');
            return;
        } else {
            log('info', `캐시 만료 (${Math.round(ageHours)}시간 전) - 재크롤링`);
        }
    }

    const startTime = Date.now();

    try {
        // 1. 핸들로 채널 정보 가져오기
        log('info', '채널 정보 조회 중...');
        const channelInfo = await getChannelByHandle(CHANNEL_HANDLE);
        const uploadsPlaylistId = channelInfo.uploadsPlaylistId;
        log('success', `채널: ${channelInfo.title} (ID: ${channelInfo.id})`);
        log('success', `Uploads 플레이리스트 ID: ${uploadsPlaylistId}`);

        // 2. 모든 영상 목록 가져오기
        log('info', '영상 목록 수집 중...');
        const videos = await getAllVideosFromPlaylist(uploadsPlaylistId);
        log('success', `총 ${videos.length}개 영상 수집 완료`);

        // 3. 영상 상세 정보 가져오기
        log('info', '영상 상세 정보 수집 중...');
        const videoIds = videos.map(v => v.videoId);
        const details = await getVideoDetails(videoIds);

        // 4. 영상 정보에 상세 정보 병합 및 지도 URL 추출
        for (const video of videos) {
            const detail = details[video.videoId];
            if (detail) {
                video.duration = parseDuration(detail.duration);
                video.durationRaw = detail.duration;
                video.viewCount = detail.viewCount;
                video.likeCount = detail.likeCount;
                video.commentCount = detail.commentCount;
                video.tags = detail.tags;

                // description이 비어있으면 상세 정보에서 가져오기
                if (!video.description || video.description.length < detail.description.length) {
                    video.description = detail.description;
                }
            }

            // 지도 URL 추출
            video.mapUrls = extractMapUrls(video.description);
            video.hasMapUrl = video.mapUrls.length > 0;
        }

        // 5. 통계 계산
        const stats = {
            totalVideos: videos.length,
            videosWithMapUrl: videos.filter(v => v.hasMapUrl).length,
            mapUrlsByType: {
                google: videos.filter(v => v.mapUrls.some(m => m.type === 'google')).length,
                naver: videos.filter(v => v.mapUrls.some(m => m.type === 'naver')).length,
                kakao: videos.filter(v => v.mapUrls.some(m => m.type === 'kakao')).length,
            }
        };

        // 6. 결과 저장
        const outputFile = path.join(TODAY_PATH, 'meatcreator_videos.json');
        const output = {
            channel: {
                id: channelInfo.id,
                handle: CHANNEL_HANDLE,
                name: channelInfo.title,
            },
            crawledAt: getKSTDate().toISOString(),
            stats,
            videos,
        };

        fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf-8');
        log('success', `결과 저장: ${outputFile}`);

        // 7. 지도 URL이 있는 영상만 별도 저장 (다음 단계 입력용)
        const videosWithMapUrl = videos.filter(v => v.hasMapUrl);
        const mapUrlOutputFile = path.join(TODAY_PATH, 'meatcreator_videos_with_map.jsonl');
        const mapUrlContent = videosWithMapUrl.map(v => JSON.stringify(v)).join('\n');
        fs.writeFileSync(mapUrlOutputFile, mapUrlContent, 'utf-8');
        log('success', `지도 URL 포함 영상 저장: ${mapUrlOutputFile} (${videosWithMapUrl.length}개)`);

        // 8. 결과 출력
        const duration = Date.now() - startTime;
        log('info', '');
        log('info', '='.repeat(60));
        log('success', '크롤링 완료');
        log('info', '='.repeat(60));
        log('info', `총 영상: ${stats.totalVideos}개`);
        log('info', `지도 URL 포함: ${stats.videosWithMapUrl}개`);
        log('info', `  - 구글 지도: ${stats.mapUrlsByType.google}개`);
        log('info', `  - 네이버 지도: ${stats.mapUrlsByType.naver}개`);
        log('info', `  - 카카오 지도: ${stats.mapUrlsByType.kakao}개`);
        log('info', `소요 시간: ${Math.round(duration / 1000)}초`);
        log('info', '='.repeat(60));

    } catch (error) {
        log('error', `크롤링 실패: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

main();
