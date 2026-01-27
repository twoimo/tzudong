/**
 * 유튜브 히트맵 기반 고화질 프레임 추출 및 자동 수집기
 *
 * 이 스크립트는 유튜브 영상의 '가장 많이 다시 본 장면(Heatmap Peak)'을 분석하여
 * 해당 구간의 고화질 프레임을 자동으로 추출합니다.
 *
 * [실행 모드]
 * 1. 자동 배치 수집 (Automatic Batch Mode)
 *    - 사용법: node 04-extract-frames-with-heatmap.js
 *    - 동작: `urls.txt`의 모든 영상을 순회하며 수집 조건(게시 5일 경과, 역주행 등)을 만족하는 경우에만 실행
 *
 * 2. 단일 영상 수집 (Single Video Mode)
 *    - 사용법: node 04-extract-frames-with-heatmap.js --url "https://youtu.be/..."
 *    - 동작: 조건과 관계없이 지정된 영상의 프레임을 즉시 추출
 *
 * [옵션]
 * --url       : 대상 유튜브 영상 URL (생략 시 자동 배치 모드 작동)
 * --channel   : 채널명 (기본: tzuyang)
 * --fps       : 초당 추출 프레임 수 (기본: 1.0)
 * --buffer    : 피크 지점 기준 앞뒤 여유 시간(초) (기본: 0.0)
 * --quality   : 다운로드 화질 (예: 1080p,720p,360p) (기본: 360p) - 쉼표로 구분하여 다중 지정 가능
 * --ext       : 이미지 포맷 (예: webp,png,jpg) (기본: jpg) - 쉼표로 구분하여 다중 지정 가능
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import https from 'https';
// [추가] 정적 빌드 FFmpeg/FFprobe 경로 로드
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
const ffmpegPath = ffmpegStatic;
const ffprobePath = ffprobeStatic.path;

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 환경 설정 ---
const SCRIPT_DIR = __dirname;
const BASE_DATA_DIR = path.resolve(SCRIPT_DIR, '../data');

// [수정] 환경 변수 또는 상대 경로 우선 사용 (CI/CD 및 다중 환경 호환성)
// 기존 하드코딩된 Windows 경로는 로컬 개발 환경용 fallback으로 유지하되, 존재하지 않으면 상대 경로 사용
const LOCAL_DRIVE_CACHE = 'H:\\My Drive\\04_빠른공유\\tzudong_tzuyang_data\\video_cache';
const LOCAL_DRIVE_FRAMES = 'H:\\My Drive\\04_빠른공유\\tzudong_tzuyang_data\\frames';

let VIDEO_CACHE_DIR = process.env.VIDEO_CACHE_DIR || (fs.existsSync(LOCAL_DRIVE_CACHE) ? LOCAL_DRIVE_CACHE : path.join(BASE_DATA_DIR, 'video_cache'));
let FRAMES_ROOT_DIR = process.env.FRAMES_ROOT_DIR || (fs.existsSync(LOCAL_DRIVE_FRAMES) ? LOCAL_DRIVE_FRAMES : path.join(BASE_DATA_DIR, 'frames'));

// 캐시/프레임 디렉토리 자동 생성
if (!fs.existsSync(VIDEO_CACHE_DIR)) fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });
if (!fs.existsSync(FRAMES_ROOT_DIR)) fs.mkdirSync(FRAMES_ROOT_DIR, { recursive: true });

log('info', `[Config] Video Cache: ${VIDEO_CACHE_DIR}`);
log('info', `[Config] Frames Dir: ${FRAMES_ROOT_DIR}`);

// --- 로깅 헬퍼 ---
function log(level, message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    // [Styling] 레벨에 따라 색상이나 포맷을 다르게 할 수 있지만, 일단 직관적인 텍스트로 통일
    console.log(`[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}`);
}

function toRelativePath(p) {
    if (!p) return '';
    try {
        return path.relative(process.cwd(), p);
    } catch (e) {
        return p;
    }
}

// --- RClone 및 Env 헬퍼 ---
async function setupRCloneConfig() {
    const configBase64 = process.env.RCLONE_CONFIG_BASE64;
    // Base64 인코딩된 Config가 있으면 디코딩해서 파일로 저장 (GitHub Actions 환경 등)
    if (configBase64) {
        try {
            const configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'rclone', 'rclone.conf');
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

            const configContent = Buffer.from(configBase64, 'base64').toString('utf-8');
            fs.writeFileSync(configPath, configContent, 'utf-8');
            log('info', `[RClone] Config 설정 완료: ${configPath}`);
            return true;
        } catch (e) {
            log('warn', `[RClone] Config 설정 실패: ${e.message}`);
        }
    }
    return false;
}

async function findVideoInGDrive(remotePath, videoId) {
    // rclone lsf로 해당 비디오 ID를 포함하는 파일 검색
    // 예: rclone lsf "remote:path" --files-only --include "*videoId*"
    const cmd = `rclone lsf "${remotePath}" --files-only --include "*${videoId}*" --format "p"`;
    try {
        const { stdout } = await execPromise(cmd);
        const files = stdout.trim().split('\n').filter(f => f);
        if (files.length > 0) {
            // 가장 유력한 파일 선택 (mp4, webm, mkv 우선)
            const bestFile = files.find(f => /\.(mp4|webm|mkv)$/i.test(f)) || files[0];
            return bestFile;
        }
    } catch (e) {
        log('warn', `[RClone] 파일 검색 실패: ${e.message}`);
    }
    return null;
}

async function fetchVideoFromGDrive(remotePath, fileName, outputDir) {
    const source = `${remotePath}/${fileName}`.replace('//', '/');
    const target = path.join(outputDir, fileName);

    log('info', `[RClone] GDrive 다운로드 시작: ${source} -> ${toRelativePath(target)}`);
    const cmd = `rclone copy "${source}" "${outputDir}" --progress`;

    try {
        await execPromise(cmd);
        if (fs.existsSync(target)) {
            log('info', `[RClone] 다운로드 완료: ${fileName}`);
            return target;
        }
    } catch (e) {
        log('error', `[RClone] 다운로드 실패: ${e.message}`);
    }
    return null;
}

// --- 인자 파싱 ---
function parseArgs() {
    const args = process.argv.slice(2);
    const params = {
        url: null,
        channel: 'tzuyang', // 기본 채널 변경: tzuyang
        fps: 1.0,
        buffer: 0.0,
        quality: ['360p'], // 배열로 변경
        ext: ['jpg'], // 배열로 변경
        force: false, // [추가] 기본값 false
        framesDir: null, // [추가] 프레임 저장 경로
        videoCacheDir: null // [추가] 비디오 캐시 경로
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url': params.url = args[++i]; break;
            case '--channel': params.channel = args[++i]; break;
            case '--fps': params.fps = parseFloat(args[++i]); break;
            case '--buffer': params.buffer = parseFloat(args[++i]); break;
            case '--quality': params.quality = args[++i].split(','); break; // 콤마로 구분하여 배열로 변환
            case '--ext': params.ext = args[++i].toLowerCase().split(','); break; // 콤마로 구분하여 배열로 변환
            case '--delete-cache': params.deleteCache = true; break;
            case '--force': params.force = true; break; // [추가] 강제 수집 플래그
            case '--frames-dir': params.framesDir = args[++i]; break; // [추가] 프레임 경로 설정
            case '--video-cache-dir': params.videoCacheDir = args[++i]; break; // [추가] 캐시 경로 설정
        }
    }
    return params;
}

// --- 경로 헬퍼 ---
function copyFolderRecursiveSync(source, target) {
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

    if (fs.lstatSync(source).isDirectory()) {
        const files = fs.readdirSync(source);
        for (const file of files) {
            const curSource = path.join(source, file);
            const curTarget = path.join(target, file);
            if (fs.lstatSync(curSource).isDirectory()) {
                copyFolderRecursiveSync(curSource, curTarget);
            } else {
                // [최적화] 하드 링크 시도 -> 실패 시 복사 (Cross-device 등 대비)
                try {
                    // 이미 타겟이 있으면 건너뜀 (덮어쓰기 방지)
                    if (!fs.existsSync(curTarget)) {
                        fs.linkSync(curSource, curTarget);
                    }
                } catch (e) {
                    // 하드 링크 실패 시 일반 복사 (폴백)
                    if (!fs.existsSync(curTarget)) {
                        fs.copyFileSync(curSource, curTarget);
                    }
                }
            }
        }
    }
}

function getChannelDir(channelName) {
    return path.join(BASE_DATA_DIR, channelName);
}

// 프레임 저장 경로: channel/frames/videoId/recollectId/
function getFramesOutputDir(channelName, videoId, recollectId) {
    const rId = recollectId !== undefined && recollectId !== null ? recollectId.toString() : '0';
    // [수정] FRAMES_ROOT_DIR 전역 변수 사용 (채널 구분 없이 루트 사용 혹은 채널 하위?)
    // 사용자 요청 경로에 'tzudong_tzuyang_data'가 있으므로, 이미 채널(tzuyang) 특화 경로일 수 있음.
    // 하지만 channelName이 바뀌면 꼬일 수 있으므로, 만약 기본값이 아니면 채널명을 붙일지 고민.
    // 일단 요청사항대로 고정 경로 하위에 videoId 생성
    // 만약 채널별 구분이 필요하다면 FRAMES_ROOT_DIR 하위에 channelName을 붙여야 함.
    // 여기서는 사용자가 지정한 'frames' 폴더 바로 아래에 videoId를 둠.
    return path.join(FRAMES_ROOT_DIR, videoId, rId);
}

function getHeatmapOutputPath(channelName, videoId) {
    const dir = path.join(getChannelDir(channelName), 'heatmap');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${videoId}.jsonl`);
}

function getMetaOutputPath(channelName, videoId) {
    return path.join(getChannelDir(channelName), 'meta', `${videoId}.jsonl`);
}

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
    return match ? match[1] : null;
}

// --- 메타 데이터 유틸리티 ---

// 메타 파일에서 recollect_id 값을 읽어옴 (없으면 0 반환)
function getMetaRecollectId(channelName, videoId) {
    let metaPath = getMetaOutputPath(channelName, videoId);

    // manual 채널인 경우 tzuyang 데이터 풀백 검색 (테스트 용의성)
    if (!fs.existsSync(metaPath) && channelName === 'manual') {
        const fallbackPath = path.join(BASE_DATA_DIR, 'tzuyang', 'meta', `${videoId}.jsonl`);
        if (fs.existsSync(fallbackPath)) {
            metaPath = fallbackPath;
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const data = JSON.parse(content);
                return typeof data.recollect_id === 'number' ? data.recollect_id : 0;
            }
        } catch (e) {
            // 무시 (기본값 0 사용)
        }
    }
    return 0;
}

// 메타 파일에서 변경 변수(recollect_vars) 확인
function getRecollectVars(channelName, videoId) {
    let metaPath = getMetaOutputPath(channelName, videoId);

    if (!fs.existsSync(metaPath) && channelName === 'manual') {
        const fallbackPath = path.join(BASE_DATA_DIR, 'tzuyang', 'meta', `${videoId}.jsonl`);
        if (fs.existsSync(fallbackPath)) {
            metaPath = fallbackPath;
            log('info', `[Meta] 메타 참조 변경: 'tzuyang' 채널 데이터 사용 -> ${path.basename(metaPath)}`);
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const data = JSON.parse(content);
                const vars = data.recollect_vars || [];
                log('info', `[Meta] 감지된 변경 변수: [${vars.join(', ')}]`);
                return vars;
            }
        } catch (e) {
            log('warn', `메타 파일 파싱 오류: ${e.message}`);
        }
    }
    return [];
}

function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}

function getMetaInfo(channelName, videoId) {
    const metaPath = getMetaOutputPath(channelName, videoId);
    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                return JSON.parse(content);
            }
        } catch (e) {
            log('warn', `메타 파일 읽기 실패: ${e.message}`);
        }
    }
    return null;
}

// [수정] params 객체를 통해 quality, fps 등 상세 조건 확인
function shouldCollect(channelName, videoId, params) {
    const { force: ignoreExisting, quality, fps, ext } = params;
    const metaInfo = getMetaInfo(channelName, videoId);
    let metaRecollectId = -1;
    let recollectVars = [];
    let publishedAt = null;

    if (metaInfo) {
        metaRecollectId = metaInfo.recollect_id !== undefined ? metaInfo.recollect_id : 0;
        recollectVars = metaInfo.recollect_vars || [];
        publishedAt = metaInfo.published_at;

        // [추가] 180초(3분) 미만 영상은 Shorts로 간주하여 자동 수집 제외
        const duration = metaInfo.duration || 0;
        if (duration < 180) {
            log('info', `[Skip] ${videoId}: 3분 미만 영상 (${duration}초)`);
            return false;
        }
    } else {
        // 메타 정보 없으면 수집 대상 (또는 정책에 따라 스킵 할 수도 있음)
        // 여기서는 일단 수집 시도 (히트맵 수집 과정에서 메타 없으면 어차피 실패할 수 있음)
        return true;
    }

    // 1. 필수 확인: 게시 후 5일 경과 여부
    if (!publishedAt) {
        return false;
    }

    const pubDate = new Date(publishedAt);
    const now = getKSTDate();
    // diffTime을 ms 단위로 계산
    const diffTime = Math.abs(now - pubDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // 올림 처리

    if (diffDays < 5) {
        // [중요] 5일 미만이라도 'new_video' 같은 즉시 수집 트리거가 있으면 수집해야 할 수도 있음.
        // 하지만 04 스크립트 로직에 따르면 5일 미만은 무조건 false 입니다.
        log('info', `[Skip] ${videoId}: 게시 후 5일 미만 (${diffDays}일)`);
        return false;
    }

    // [수정] 강제 수집 모드일 경우 기존 파일 확인 스킵
    if (ignoreExisting) {
        return true;
    }



    // 이미 프레임이 추출된 상태인지 확인 (recollect_id 비교)
    const framesDir = getFramesOutputDir(channelName, videoId, metaRecollectId);

    // frames 폴더 확인
    if (fs.existsSync(framesDir)) {
        // [수정] 단순히 폴더가 있는지가 아니라, 요청한 설정(Quality/FPS)의 데이터가 있는지 확인해야 함
        // 구조: frames/VID/RID/SEG/EXT/CONF
        // 예: 1/jpg/360p_1.0fps

        // 세그먼트 폴더들을 순회
        try {
            const segDirs = fs.readdirSync(framesDir).filter(f => !f.startsWith('.')); // 숨김파일 제외
            if (segDirs.length > 0) {
                // 하나라도 세그먼트 폴더가 있다면 체크 시작
                const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;

                // 요청된 화질/포맷 중 하나라도 없으면 수집 대상 (False 반환 -> True 반환해야 함)
                // 모든 요청 포맷이 존재해야 "이미 수집됨"으로 간주
                const qualities = Array.isArray(quality) ? quality : [quality];
                const extensions = Array.isArray(ext) ? ext : [ext];

                let isFullyCollected = true;

                for (const q of qualities) {
                    const configDirName = `${q}_${fpsStr}fps`;

                    for (const e of extensions) {
                        // 모든 세그먼트에 대해 해당 설정이 존재하는지 확인
                        // (세그먼트 개수가 몇 개인지는 히트맵 까봐야 알지만, 여기선 존재하는 세그먼트 폴더 기준)
                        // 적어도 존재하는 세그먼트 폴더들에는 다 있어야 함.
                        const missingInSegments = segDirs.some(sd => {
                            const targetPath = path.join(framesDir, sd, e, configDirName);
                            // 폴더가 없거나 비어있으면 누락된 것
                            return !fs.existsSync(targetPath) || fs.readdirSync(targetPath).length === 0;
                        });

                        if (missingInSegments) {
                            log('info', `[Check] ${videoId}: ${configDirName} (${e}) 데이터 누락 확인 -> 수집 필요`);
                            isFullyCollected = false;
                            break;
                        }
                    }
                    if (!isFullyCollected) break;
                }

                if (isFullyCollected) {
                    // 데이터는 다 있음. 이제 트리거 체크 (recollect_id 증가 여부 등)
                    // 하지만 recollect_id가 같은데 데이터가 다 있다면 -> 진짜 다 있는 것.
                    // 메타 recollect_id가 더 높은지 체크
                    const heatmapPath = getHeatmapOutputPath(channelName, videoId);
                    if (fs.existsSync(heatmapPath)) {
                        try {
                            const lines = fs.readFileSync(heatmapPath, 'utf-8').trim().split('\n');
                            if (lines.length > 0) {
                                const lastLine = lines[lines.length - 1];
                                const lastData = JSON.parse(lastLine);
                                const lastRecollectId = lastData.recollect_id !== undefined ? lastData.recollect_id : -1;

                                if (metaRecollectId > lastRecollectId) {
                                    // ... 트리거 로직 ...
                                    const TRIGGER_VARS = ['new_video', 'duration_changed', 'scheduled_weekly', 'scheduled_biweekly', 'scheduled_monthly'];
                                    const shouldTrigger = recollectVars.some(variable => TRIGGER_VARS.includes(variable));
                                    if (shouldTrigger) {
                                        log('info', `[Trigger] ${videoId}: 트리거 변수 발견 [${recollectVars.join(', ')}]`);
                                        return true;
                                    }
                                }
                            }
                        } catch (e) { }
                    }
                    // 데이터도 있고 트리거도 없으면 스킵
                    // log('info', `[스킵] ${videoId}: 이미 최신 데이터 보유 (${qualities.join(', ')})`);
                    return false;
                }

                // isFullyCollected가 false면 수집해야 함
                return true;
            }
        } catch (e) {
            log('warn', `프레임 폴더 체크 중 오류 ${videoId}: ${e.message}`);
        }
    }

    // [수정] D+5 강제 수집 로직 추가
    // 히트맵/프레임이 아예 없는 신규 영상이면, 스케줄 트리거가 없어도 D+5가 지났으면 수집해야 함
    // (get_schedule_frequency에서 D+5 미만은 None을 반환하므로, 메타 수집 단계에서 걸러졌을 수 있음.
    // 하지만 여기까지 왔다는 건 메타가 있다는 뜻일 수도 있고, shouldCollect가 호출된 시점에서 판단)

    // 데이터 부재 확인
    const heatmapPath = getHeatmapOutputPath(channelName, videoId);
    const hasHeatmap = fs.existsSync(heatmapPath);

    // D+5 경과 확인 (위에서 계산한 diffDays 사용)
    if (diffDays >= 5) {
        if (!hasHeatmap) {
            log('info', `[Force] ${videoId}: D+5 경과 & 히트맵 없음 -> 강제 수집 트리거 (Initial Collection)`);
            return true;
        }
    }

    // 폴더가 없거나 비어있으면 수집 필요
    // [중요] 단, recollect_vars에 'daily_collection'만 있다면 수집 스킵 (주간/월간 스케줄 아님)
    // new_video, scheduled_*, duration_changed, heatmap_changed 등이 있어야 함
    const TRIGGER_VARS = ['new_video', 'duration_changed', 'scheduled_weekly', 'scheduled_biweekly', 'scheduled_monthly', 'heatmap_changed'];
    const hasTrigger = recollectVars.some(variable => TRIGGER_VARS.includes(variable));

    // 강제 수집 모드가 아니고 트리거가 없다면 스킵 (daily_collection은 메타만 수집)
    if (!ignoreExisting && !hasTrigger && recollectVars.includes('daily_collection')) {
        // log('info', `[스킵] ${videoId}: Daily Collection (프레임 수집 대상 아님)`);
        return false;
    }

    // 스케줄링(scheduled_*)에 의해 왔더라도, 히트맵이 바뀌지 않았다면 굳이 수집할 필요 없음.
    // 이는 processSingleVideo 내부의 fetchAndSaveHeatmap 단계에서 "히트맵 비교"를 통해 최종 결정됨.
    // 여기서는 일단 "수집 시도 대상"으로는 분류함.

    return true;
}

// --- 데이터 수집 및 다운로드 로직 ---

async function loadCookies() {
    // 1. JSON 포맷 쿠키 시도
    const jsonPath = path.join(BASE_DATA_DIR, 'cookies.json');
    if (fs.existsSync(jsonPath)) {
        try {
            const content = fs.readFileSync(jsonPath, 'utf-8');
            const cookies = JSON.parse(content);
            log('info', `[Auth] cookies.json 로드 완료 (${cookies.length}개)`);
            return cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } catch (e) {
            log('warn', `cookies.json 로드 실패: ${e.message}`);
        }
    }

    // 2. Netscape 포맷 쿠키 (.txt) 시도
    const txtPath = path.join(BASE_DATA_DIR, 'cookies.txt');
    if (fs.existsSync(txtPath)) {
        try {
            const content = fs.readFileSync(txtPath, 'utf-8');
            const lines = content.split('\n');
            const cookies = [];
            for (const line of lines) {
                if (line.startsWith('#') || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 7) {
                    cookies.push(`${parts[5]}=${parts[6]}`);
                }
            }
            log('info', `[Auth] cookies.txt 로드 완료 (${cookies.length}개)`);
            return cookies.join('; ');
        } catch (e) {
            log('warn', `cookies.txt 로드 실패: ${e.message}`);
        }
    }
    return '';
}

async function fetchPage(url, cookieHeader) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
        'Cookie': cookieHeader || ''
    };

    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`상태 코드 오류: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function parseHeatmap(html) {
    // ytInitialData 객체 추출
    const match = html.match(/var\s+ytInitialData\s*=\s*({.*?});/s);
    if (!match) return null;

    try {
        const data = JSON.parse(match[1]);

        // 깊은 객체 탐색 헬퍼
        function findKey(obj, key) {
            if (!obj) return null;
            if (obj[key]) return obj[key];
            if (typeof obj === 'object') {
                for (const k in obj) {
                    const found = findKey(obj[k], key);
                    if (found) return found;
                }
            }
            return null;
        }

        // '가장 많이 다시 본 장면' 마커 추출
        const markersDecoration = findKey(data, 'markersDecoration');
        let mostReplayed = [];

        if (markersDecoration && markersDecoration.timedMarkerDecorations) {
            mostReplayed = markersDecoration.timedMarkerDecorations
                .filter(marker => {
                    const labelText = marker.label?.runs?.[0]?.text || '';
                    return labelText.includes('가장 많이 다시 본 장면') || labelText.toLowerCase().includes('most replayed');
                })
                .map(marker => ({
                    startMillis: marker.visibleTimeRangeStartMillis,
                    endMillis: marker.visibleTimeRangeEndMillis,
                    peakMillis: marker.decorationTimeMillis,
                    label: marker.label?.runs?.[0]?.text
                }));
        }

        // 일반 인터랙션 데이터 추출
        const markers = findKey(data, 'markers');
        let rawMarkers = null;

        if (markers && Array.isArray(markers) && markers.length > 0) {
            rawMarkers = markers;
        } else {
            const markerGraph = findKey(data, 'markerGraph');
            if (markerGraph && markerGraph.markers && Array.isArray(markerGraph.markers)) {
                rawMarkers = markerGraph.markers;
            }
        }

        return {
            mostReplayedMarkers: mostReplayed,
            interactionData: rawMarkers
        };

    } catch (e) {
        log('error', `HTML 파싱 실패: ${e.message}`);
        return null;
    }
}

// 히트맵 데이터 수집 및 저장
async function fetchAndSaveHeatmap(channel, videoId, url) {
    const outPath = getHeatmapOutputPath(channel, videoId);

    // [수정] 이미 데이터가 존재하면 다시 수집하지 않고 읽어서 반환 (중복 저장 방지)
    // 단, recollect_id가 증가했거나 트리거 변수가 있다면 무시하고 재수집
    if (fs.existsSync(outPath)) {
        try {
            const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n');
            if (lines.length > 0) {
                const lastLine = lines[lines.length - 1]; // 가장 최신 데이터 사용
                // 마지막 줄이 완전하지 않을 경우 대비 (간단 체크)
                if (lastLine.endsWith('}')) {
                    const existingData = JSON.parse(lastLine);
                    const currentMetaId = getMetaRecollectId(channel, videoId);

                    // 메타 ID가 더 크면 재수집 (업데이트)
                    if (currentMetaId > existingData.recollect_id) {
                        const vars = getRecollectVars(channel, videoId);
                        log('info', `[Check] 히트맵 ID 변경 감지 (ID: ${existingData.recollect_id} -> ${currentMetaId}), 사유: [${vars.join(', ')}]`);

                        // [최적화] 여기서 무조건 재수집하지 않고, "진짜 바뀌었는지" 확인하기 위해
                        // 아래로 흘려보내서 새 히트맵을 가져온 뒤 비교 로직 수행 (Intersection Check)
                    } else {
                        // ID도 같고 데이터도 있으면 재사용
                        log('info', `[Reuse] 기존 히트맵 데이터 사용: ${toRelativePath(outPath)}`);
                        return existingData.most_replayed_markers.map(m => ({
                            startSec: m.startMillis / 1000,
                            endSec: m.endMillis / 1000,
                            peakSec: m.peakMillis / 1000
                        }));
                    }
                }
            }
        } catch (e) {
            log('warn', `기존 파일 읽기 실패 (재수집 진행): ${e.message}`);
        }
    }

    const cookieHeader = await loadCookies();
    const html = await fetchPage(url, cookieHeader);
    const parsed = parseHeatmap(html);

    if (!parsed || (!parsed.mostReplayedMarkers.length && !parsed.interactionData)) {
        log('warn', `[Warn] ${videoId}: 히트맵 정보가 없습니다.`);
        return null;
    }

    // [추가] 히트맵 변경 감지 & 부분 업데이트(Hard Link) 지원을 위한 비교 로직
    // 기존 데이터 로드 (최신본)
    let existingMarkers = [];
    if (fs.existsSync(outPath)) {
        try {
            const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n');
            if (lines.length > 0) {
                const lastData = JSON.parse(lines[lines.length - 1]);
                existingMarkers = lastData.most_replayed_markers.map(m => ({
                    startSec: m.startMillis / 1000,
                    endSec: m.endMillis / 1000,
                    peakSec: m.peakMillis / 1000
                }));
            }
        } catch (e) { }
    }

    const newMarkers = parsed.mostReplayedMarkers.map(m => ({
        startSec: m.startMillis / 1000,
        endSec: m.endMillis / 1000,
        peakSec: m.peakMillis / 1000
    }));

    // 비교: 개수가 같고, 모든 마커가 오차 범위 내(±2초) 라면 '변경 없음'으로 간주
    // 단, duration_changed 트리거가 있다면 무조건 변경으로 간주 (신뢰도 하락)
    const vars = getRecollectVars(channel, videoId);
    const isDurationChanged = vars.includes('duration_changed');

    let isHeatmapChanged = false;

    if (isDurationChanged) {
        log('info', `[Change] 영상 길이 변경 감지 -> 히트맵 전면 재수집`);
        isHeatmapChanged = true;
    } else if (existingMarkers.length !== newMarkers.length) {
        log('info', `[Change] 히트맵 구간 개수 변경 (${existingMarkers.length} -> ${newMarkers.length})`);
        isHeatmapChanged = true;
    } else {
        // 개수 같음 -> 구간별 시간 비교
        const TOLERANCE_SEC = 2.0;
        const hasDiff = newMarkers.some((newM, i) => {
            const oldM = existingMarkers[i];
            const startDiff = Math.abs(newM.startSec - oldM.startSec);
            const endDiff = Math.abs(newM.endSec - oldM.endSec);
            return startDiff > TOLERANCE_SEC || endDiff > TOLERANCE_SEC;
        });

        if (hasDiff) {
            log('info', `[Change] 히트맵 구간 시간 변경 감지 (> ${TOLERANCE_SEC}s)`);
            isHeatmapChanged = true;
        } else {
            // 변경 없음
            log('info', `[Skip] 히트맵 변경 없음 (허용오차 ±${TOLERANCE_SEC}s 이내) -> 수집 중단`);
            return null; // Null을 리턴하여 다운로드/프레임 추출 단계로 가지 않게 함
        }
    }

    // 변경 없는 경우 처리 로직 (getRecollectVars가 scheduled_* 만 있을 때)
    // 만약 isHeatmapChanged가 false인데 여기까지 왔다면(위에서 return null 안됨), 뭔가 이상함.
    // 하지만 new_video인 경우는 existingMarkers가 없으므로 isHeatmapChanged = true가 됨. (0 != N)

    // [중요] 변경되지 않았다면 파일 저장도 하지 않음 (불필요한 로그 방지)
    // 하지만 여기까지 왔다는 건 변경되었다는 뜻임. 저장 진행.

    const formattedInteraction = (parsed.interactionData || []).map(item => {

        const seconds = Math.floor((item.startMillis || 0) / 1000);
        const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
        const ss = (seconds % 60).toString().padStart(2, '0');
        return {
            ...item,
            formatted_time: `${mm}:${ss}`
        };
    });

    const recollectId = getMetaRecollectId(channel, videoId);

    // [추가] 메타 정보에서 duration 가져오기
    const metaInfo = getMetaInfo(channel, videoId);
    const duration = metaInfo ? metaInfo.duration : 0;

    // [중요] recollect_vars에 heatmap_changed 추가 (명시적)
    let finalVars = getRecollectVars(channel, videoId);
    if (!finalVars.includes('heatmap_changed')) {
        finalVars.push('heatmap_changed');
    }

    const saveData = {
        youtube_link: url,
        video_id: videoId,
        duration: duration, // duration 필드 추가
        interaction_data: formattedInteraction,
        most_replayed_markers: parsed.mostReplayedMarkers,
        status: 'success',
        collected_at: new Date().toISOString(),
        recollect_id: recollectId,
        recollect_vars: finalVars
    };

    fs.appendFileSync(outPath, JSON.stringify(saveData) + '\n', 'utf8');
    log('info', `[Saved] 히트맵 데이터 저장됨: ${toRelativePath(outPath)} (포인트: ${formattedInteraction.length}개)`);

    // 반환값에 '재사용 가능 여부' 정보를 포함하면 좋겠지만, 
    // 기존 구조 유지를 위해 마커 리스트만 반환하고, 실제 부분 업데이트 로직은 extractFrames에서 수행
    // (extractFrames에서 다시 히트맵 파일 읽거나, 여기서 넘겨줄 수 있으면 좋음)

    // [Fix] extractFrames에서 '어떤 게 바뀌었는지' 알기 쉽게 하기 위해 확장된 객체 반환은 호출부 수정이 많이 필요함.
    // 대신, extractFrames가 '스마트 재사용' 로직을 내장하고 있으므로(폴더 비교), 
    // 여기서는 최신 마커 리스트만 잘 넘겨주면 됨.

    return parsed.mostReplayedMarkers.map(m => ({
        startSec: m.startMillis / 1000,
        endSec: m.endMillis / 1000,
        peakSec: m.peakMillis / 1000
    }));
}

// --- 비디오 다운로드 및 프레임 추출 ---

async function downloadVideo(videoId, outputDir, quality) {
    const match = quality.match(/\d+/);
    const height = match ? parseInt(match[0]) : 1080;

    const cookieTxt = path.join(BASE_DATA_DIR, 'cookies.txt');
    const cookieArg = fs.existsSync(cookieTxt) ? `--cookies "${cookieTxt}"` : '';

    // 포맷 유연성 확보: mp4 강제 제거 후 remux 사용 (n-challenge 해결 확률 높임)
    const format = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;

    // 1. Python 모듈 사용 (최신 버전 보장)
    // 2. Node.js 경로 명시 (n-challenge 해결 필수)
    // 3. Remote Solver 허용 (최신 yt-dlp 정책 대응)
    // 4. Output Template: 확장자 자동 결정 (%(ext)s) - Merge 에러 방지
    const nodePath = "C:\\Program Files\\nodejs\\node.exe";
    const outputFileTemplate = path.join(outputDir, `${videoId}.%(ext)s`);

    // [최적화] 캐시된 파일 확인
    const cacheFiles = fs.readdirSync(VIDEO_CACHE_DIR);
    const cachedFile = cacheFiles.find(f => f.startsWith(videoId) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')));
    if (cachedFile) {
        log('info', `[Cache] 캐시된 비디오 사용: ${cachedFile}`);
        return path.join(VIDEO_CACHE_DIR, cachedFile);
    }

    // [추가] GDrive 우선 검색 및 다운로드 로직
    const gdriveRemotePath = process.env.GDRIVE_REMOTE_PATH; // 예: "gdrive:tzuyang_archive"
    if (gdriveRemotePath) {
        // RClone Config 설정 시도 (없으면 로컬 설정 사용)
        await setupRCloneConfig();

        const gdriveFileName = await findVideoInGDrive(gdriveRemotePath, videoId);
        if (gdriveFileName) {
            log('info', `[GDrive] 영상 발견: ${gdriveFileName} -> 다운로드 시도`);
            const downloaded = await fetchVideoFromGDrive(gdriveRemotePath, gdriveFileName, outputDir);
            if (downloaded) {
                // 캐시 업데이트
                try {
                    const cachePath = path.join(VIDEO_CACHE_DIR, path.basename(downloaded));
                    if (!fs.existsSync(cachePath)) {
                        fs.copyFileSync(downloaded, cachePath);
                        log('info', `[Cache] GDrive 원본 캐시 저장 완료: ${toRelativePath(cachePath)}`);
                    }
                } catch (e) {
                    log('warn', `캐시 저장 실패: ${e.message}`);
                }
                return downloaded;
            }
        } else {
            log('info', `[GDrive] 영상 없음 (${videoId}) -> HTTP 다운로드(yt-dlp)로 전환`);
        }
    }


    // --merge-output-format 제거: 원본 컨테이너 그대로 저장
    // [수정] 시스템 python 대신 Anaconda python 명시적 사용 (yt-dlp 모듈 보유)
    // [수정] GitHub Actions 등 환경에 따라 python 경로 유연화
    let pythonPath = "C:\\Users\\twoimo\\anaconda3\\python.exe";
    if (!fs.existsSync(pythonPath)) {
        // 윈도우가 아니거나 해당 경로 없으면 시스템 python 시도
        pythonPath = "python3";
    }

    // Windows가 아닌 경우 nodePath 조정 필요할 수 있음
    // 일단 간단히 node만 호출
    const runtimesArg = process.platform === 'win32' ? `--js-runtimes "node:${nodePath}"` : '';

    const cmd = `"${pythonPath}" -m yt_dlp ${cookieArg} ${runtimesArg} --remote-components ejs:github --no-part -f "${format}" -o "${outputFileTemplate}" "https://www.youtube.com/watch?v=${videoId}"`;

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            log('info', `[Downloader] 영상 다운로드 시작(HTTP): ${videoId} (목표 화질: ${height}p) [시도 ${attempt}/${maxRetries}]`);
            // yt-dlp 명령어는 stderr로 진행상황을 출력하므로, 오류 감지가 까다로울 수 있음.
            // execPromise 사용 시 stderr도 에러로 간주되지 않음.
            await execPromise(cmd);

            // 다운로드된 파일 찾기
            const files = fs.readdirSync(outputDir);
            const videoFile = files.find(f => f.startsWith(videoId) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')));

            if (videoFile) {
                const downloadedPath = path.join(outputDir, videoFile);

                // [최적화] 다운로드 성공 시 캐시에 복사
                try {
                    const cachePath = path.join(VIDEO_CACHE_DIR, videoFile);
                    fs.copyFileSync(downloadedPath, cachePath);
                    log('info', `[Cache] 비디오 캐시 저장 완료: ${toRelativePath(cachePath)}`);
                } catch (e) {
                    log('warn', `캐시 저장 실패: ${e.message}`);
                }

                return downloadedPath;
            }

            log('warn', `[Warn] 다운로드 완료 보고되었으나 파일 없음 (재시도 대기...)`);

        } catch (e) {
            log('warn', `[Warn] 다운로드 실패 (시도 ${attempt}/${maxRetries}): ${e.message}`);
        }

        // 재시도 전 대기 (2초)
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    log('error', '[Error] 최대 재시도 횟수 초과. 다운로드 포기.');
    return null;
}

// [수정] quality 인자 추가, compress -> ext 변경
async function extractFrames(videoPath, segments, outputBaseDir, quality, fps, bufferSec, ext) {
    if (!fs.existsSync(videoPath)) return;

    let duration = 0;
    try {
        const { stdout } = await execPromise(`"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`);
        duration = parseFloat(stdout);
        log('info', `[Video] 영상 길이 확인: ${duration}초`);
    } catch (e) {
        log('warn', `길이 확인 실패 (진행): ${e.message}`);
    }

    log('info', `[Image] 이미지 포맷 설정: ${ext.toUpperCase()}`);

    // 확장자별 FFMPEG 인코딩 옵션 설정
    let encodingOpts = '';
    if (ext === 'webp') {
        encodingOpts = '-c:v libwebp -lossless 1 -q:v 100'; // WebP 무손실 + 최대 압축 (용량 최소화)
    } else if (ext === 'png') {
        encodingOpts = '-c:v png -compression_level 3'; // PNG (속도/압축 균형)
    } else if (ext === 'jpg' || ext === 'jpeg') {
        encodingOpts = '-q:v 2'; // JPG 고화질 (1-31, 낮을수록 좋음)
    } else if (ext === 'bmp') {
        encodingOpts = '-c:v bmp'; // BMP (기본)
    }

    // [최적화] Promise.all을 사용하여 모든 구간을 병렬로 처리 (CPU 활용 극대화)
    await Promise.all(segments.map(async (seg, i) => {
        // [수정] 피크 지점 기준이 아닌, 마커의 전체 범위(startSec ~ endSec)에 버퍼를 더한 구간 추출
        const startTime = Math.max(0, seg.startSec - bufferSec);
        const endTime = Math.min(duration || 99999, seg.endSec + bufferSec);

        const segDirName = `${i + 1}_${Math.floor(startTime)}_${Math.floor(endTime)}`;

        const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;
        const configDirName = `${quality}_${fpsStr}fps`;

        // 구조: frames/VIDEO_ID/RECOLLECT_ID/SEGMENT_DIR/EXT_DIR/QUALITY_FPS/frame_x.ext
        const segDirPath = path.join(outputBaseDir, segDirName, ext, configDirName);
        fs.mkdirSync(segDirPath, { recursive: true });

        // [최적화] 이미 프레임이 추출되어 있다면 스킵
        const existingFiles = fs.readdirSync(segDirPath).filter(f => f.endsWith(`.${ext}`));
        if (existingFiles.length > 0) {
            log('info', `   [Skip] 이미 프레임이 존재하여 건너뜀 [${i + 1}/${segments.length}]: ${toRelativePath(segDirPath)}`);
            return;
        }

        log('info', `   [Extract] 구간 추출 시작 [${i + 1}/${segments.length}]: ${startTime.toFixed(1)}초 ~ ${endTime.toFixed(1)}초 -> .../${configDirName}`);

        let segDuration = endTime - startTime;
        if (segDuration < (1.0 / fps)) {
            segDuration = 1.0 / fps; // 최소 1프레임 보장
        }

        // ffmpeg 명령 생성 (인코딩 옵션 추가)
        // [수정] 정적 ffmpeg 경로 사용
        const cmd = `"${ffmpegPath}" -y -ss ${startTime} -t ${segDuration} -i "${videoPath}" -vf "fps=${fps}" ${encodingOpts} -frame_pts 1 "${path.join(segDirPath, `frame_%d.${ext}`)}"`;

        try {
            await execPromise(cmd);

            // 파일명 정리: frame_1.ext -> 정확한 시간(초).ext 로 변경
            const files = fs.readdirSync(segDirPath).filter(f => f.startsWith('frame_'));
            let count = 0;
            for (const file of files) {
                const match = file.match(new RegExp(`frame_(\\d+)\\.${ext}`));
                if (match) {
                    const idx = parseInt(match[1]);
                    const timeOffset = (idx - 1) / fps;
                    const actualTime = startTime + timeOffset;
                    const newName = `${actualTime.toFixed(2)}.${ext}`;

                    fs.renameSync(path.join(segDirPath, file), path.join(segDirPath, newName));
                    count++;
                }
            }
            log('info', `      [Done] 추출 완료 [${i + 1}/${segments.length}]: ${count}장`);

        } catch (e) {
            log('error', `      [Error] FFmpeg 오류 [${i + 1}/${segments.length}]: ${e.message}`);
        }
    }));
}

async function processSingleVideo(videoId, params) {
    let downloadPerformed = false;
    const { channel, fps, buffer, quality, url, ext } = params; // quality는 이제 배열입니다

    // 1. 히트맵 데이터 수집 (Recollect ID 자동 감지)
    const segments = await fetchAndSaveHeatmap(channel, videoId, url);
    // [Mod] segments가 null이면 '변경 없음' 또는 '데이터 없음' -> 수집 중단
    if (!segments) {
        // log('info', `[Info] ${videoId}: 처리할 구간이 없거나 변경사항이 없습니다.`);
        return;
    }
    if (segments.length === 0) {
        log('info', `[Info] ${videoId}: 히트맵 데이터가 비어있습니다.`);
        return;
    }

    log('info', `[Heatmap] ${videoId}: ${segments.length}개의 주요 구간 발견`);

    // 모든 화질에 대해 반복 처리
    const qualities = Array.isArray(quality) ? quality : [quality];
    const extensions = Array.isArray(ext) ? ext : [ext];

    log('info', `[Target] 처리할 화질 목록: [${qualities.join(', ')}]`);
    log('info', `[Format] 처리할 포맷 목록: [${extensions.join(', ')}]`);

    for (const currentQuality of qualities) {
        log('info', `\n[Process] 화질 처리 시작: ${currentQuality}`);

        // 2. 영상 다운로드 (임시 폴더) - 파일 잠금 충돌 방지용 랜덤 접미사
        const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const tempDir = path.join(getChannelDir(channel), 'temp_video', uniqueSuffix);
        fs.mkdirSync(tempDir, { recursive: true });

        // 다운로드 및 처리 로직
        let videoPath = null;
        try {
            // [최적화] 스마트 재개 & 데이터 재사용 로직
            const metaInfo = getMetaInfo(channel, videoId);
            const duration = metaInfo ? metaInfo.duration : 0; // Duration 확보

            const recollectId = getMetaRecollectId(channel, videoId);
            const outputDir = getFramesOutputDir(channel, videoId, recollectId);
            const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;
            const configDirName = `${currentQuality}_${fpsStr}fps`;

            // [재사용] 하드링크 부분 업데이트 (Smart Partial Update)
            // fetchAndSaveHeatmap에서 '변경 없음'이면 아예 여기로 오지 않음 (processSingleVideo에서 return)
            // 하지만 '변경 있음' 상태로 왔다면, 바뀐 구간은 새로 따고 안 바뀐 구간은 링크를 걸어야 함.

            const framesVideoRoot = path.dirname(outputDir); // channel/frames/videoId
            if (fs.existsSync(framesVideoRoot)) {
                const existingIds = fs.readdirSync(framesVideoRoot)
                    .map(d => parseInt(d))
                    .filter(n => !isNaN(n) && n < recollectId)
                    .sort((a, b) => b - a); // 내림차순 정렬

                const previousId = existingIds.length > 0 ? existingIds[0] : -1;

                if (previousId >= 0) {
                    const prevDir = path.join(framesVideoRoot, previousId.toString());

                    // [Partial Update Logic]
                    // 모든 세그먼트에 대해 순회하며:
                    // 1. 이전 버전에 "비슷한 구간(±2초)" 폴더가 있는지 확인
                    // 2. 있으면 해당 폴더 내용을 현재 버전으로 하드링크 복사
                    // 3. 없으면(새로 생긴 구간) 다운로드 대상(needsDownload)에 추가

                    const TOLERANCE_SEC = 2.0;

                    // 이전 폴더의 세그먼트 목록 파싱
                    // 폴더명 포맷: {index}_{start}_{end} (예: 1_90_100)
                    // 정확한 매칭을 위해 폴더명을 파싱해서 시간 정보를 추출해야 함

                    let prevSegmentsMap = [];
                    try {
                        const prevSegDirs = fs.readdirSync(prevDir);
                        prevSegmentsMap = prevSegDirs.map(dirName => {
                            const parts = dirName.split('_');
                            if (parts.length >= 3) {
                                return {
                                    dirName,
                                    index: parseInt(parts[0]),
                                    start: parseInt(parts[1]),
                                    end: parseInt(parts[2])
                                };
                            }
                            return null;
                        }).filter(x => x);
                    } catch (e) { }

                    let reusedCount = 0;

                    // 현재 세그먼트와 비교
                    for (let i = 0; i < segments.length; i++) {
                        const seg = segments[i];
                        const segStart = Math.max(0, seg.startSec - buffer);
                        const segEnd = Math.min(duration || 99999, seg.endSec + buffer);

                        // 현재 생성될 폴더명 (정수형 변환됨)
                        const currentSegDirName = `${i + 1}_${Math.floor(segStart)}_${Math.floor(segEnd)}`;
                        const currentSegPath = path.join(outputDir, currentSegDirName);

                        // 매칭되는 이전 세그먼트 찾기 (Loop)
                        const matchedPrev = prevSegmentsMap.find(p => {
                            // 시간 차이가 허용오차 이내인지
                            const sDiff = Math.abs(p.start - Math.floor(segStart));
                            const eDiff = Math.abs(p.end - Math.floor(segEnd));

                            // 인덱스는 달라도 되지만, 시간이 비슷해야 함.
                            // 하지만 안전을 위해 내용물(파일 존재 여부) 체크는 필수
                            return sDiff <= TOLERANCE_SEC && eDiff <= TOLERANCE_SEC;
                        });

                        if (matchedPrev) {
                            // 하드링크 수행
                            const srcPath = path.join(prevDir, matchedPrev.dirName);
                            if (fs.existsSync(srcPath)) {
                                try {
                                    copyFolderRecursiveSync(srcPath, currentSegPath);
                                    // [중요] 타임스탬프가 조금 다를 수 있으므로, 내용물은 그대로 쓰되
                                    // 폴더명은 현재(currentSegDirName)로 맞춰짐.
                                    // (copyFolderRecursiveSync가 destPath로 복사/링크함)
                                    reusedCount++;
                                    // log('info', `   [Link] 구간 재사용: ${matchedPrev.dirName} -> ${currentSegDirName}`);
                                } catch (e) { }
                            }
                        }
                    }

                    if (reusedCount > 0) {
                        log('info', `[Partial] 총 ${segments.length}개 구간 중 ${reusedCount}개 재사용(Hard Link) 완료.`);
                    }

                    // 만약 모든 구간이 재사용되었다면 다운로드 불필요
                    if (reusedCount === segments.length) {
                        log('info', `[Skip] 모든 구간 재사용 완료. 비디오 다운로드 스킵.`);
                        continue; // 다음 화질 처리 Loop (processSingleVideo 내)
                    } else {
                        log('info', `[Partial] ${segments.length - reusedCount}개 신규 구간 추출 필요.`);
                    }
                }
            }


            let allSegmentsExist = true;
            for (const currentExt of extensions) {
                // 하나라도 구간이 없으면 다시 진행
                const segmentCheck = segments.every((seg, i) => {
                    const startTime = Math.max(0, seg.startSec - buffer);
                    // duration 몰라도 폴더명 매칭을 위해 대략적 추론 or 단순 존재 여부 체크
                    // 정확한 폴더명을 알기 어려우므로(duration 필요), 
                    // 해당 recollectId 폴더 내에 configDirName을 포함한 경로가 세그먼트 수만큼 있는지 체크는 복잡.
                    // 대신 extractFrames 내부 스킵 로직에 의존하되, 여기서는 '비디오 다운로드'를 막는게 핵심.
                    // 간단히: outputDir 내의 폴더들을 뒤져서 configDirName을 가진 폴더가 segments.length 만큼 되는지 확인?
                    return false; // 구현 복잡도로 인해 아래 로직으로 대체
                });

                // 더 확실한 방법: 이미 추출된 폴더 개수 확인
                // 구조: frames/VID/RID/SEG/EXT/CONF
                // SEG 폴더들을 순회하며 EXT/CONF가 있는지 확인
                if (!fs.existsSync(outputDir)) {
                    allSegmentsExist = false;
                    break;
                }

                const segDirs = fs.readdirSync(outputDir);
                // 세그먼트 폴더 개수가 히트맵 구간 수와 비슷하거나 같다고 가정
                let completedSegs = 0;
                for (const sd of segDirs) {
                    const targetPath = path.join(outputDir, sd, currentExt, configDirName);
                    if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) {
                        completedSegs++;
                    }
                }

                if (completedSegs < segments.length) {
                    allSegmentsExist = false;
                    break;
                }
            }

            if (allSegmentsExist) {
                log('info', `[Skip] ${videoId}: 이미 ${currentQuality} 프레임 수집 완료됨.`);
                continue;
            }

            videoPath = await downloadVideo(videoId, tempDir, currentQuality);

            // [추가] 캐시 경로가 아니면 다운로드 수행된 것
            if (videoPath && !videoPath.startsWith(VIDEO_CACHE_DIR)) {
                downloadPerformed = true;
            }

            if (!videoPath) {
                log('error', `[Fail] 비디오 파일 확보 실패 (${currentQuality}). 건너뜁니다.`);
                logFailedUrl(channel, url); // [추가] 실패 로깅
                continue; // 다음 화질 처리
            }

            // 3. 프레임 추출 (모든 확장자에 대해 반복)
            // [수정] 위에서 이미 선언했으므로 재사용
            // const recollectId = ... 
            // const outputDir = ... 


            for (const currentExt of extensions) {
                await extractFrames(videoPath, segments, outputDir, currentQuality, fps, buffer, currentExt);
            }

            // [옵션] 작업 완료 후 캐시 삭제 (디스크 공간 확보용)
            // 주의: 모든 확장자 처리가 끝난 후 삭제해야 함
            if (params.deleteCache && videoPath.startsWith(VIDEO_CACHE_DIR)) {
                try {
                    fs.unlinkSync(videoPath);
                    log('info', `[Clean] 비디오 캐시 파일 삭제 완료: ${toRelativePath(videoPath)}`);

                    // 폴더가 비었으면 폴더도 삭제
                    if (fs.readdirSync(VIDEO_CACHE_DIR).length === 0) {
                        fs.rmdirSync(VIDEO_CACHE_DIR);
                        log('info', `[Clean] 비디오 캐시 폴더 삭제 완료: ${toRelativePath(VIDEO_CACHE_DIR)}`);
                    }
                } catch (e) {
                    log('warn', `캐시 삭제 실패: ${e.message}`);
                }
            }

            // [추가] 성공 시 실패 목록에서 제거
            removeFailedUrl(channel, url);

        } catch (e) {
            log('error', `오류 발생 (${currentQuality}): ${e.message}`);
        } finally {
            // 4. 임시 파일 정리 (항상 수행)
            // tempDir은 매번 생성되는 고유 임시 폴더이므로 무조건 삭제해도 안전함 (캐시 폴더와 무관)
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }

                // 상위 temp_video 폴더가 비어있으면 삭제 시도
                const parentTempDir = path.dirname(tempDir);
                if (fs.existsSync(parentTempDir) && fs.readdirSync(parentTempDir).length === 0) {
                    fs.rmdirSync(parentTempDir);
                }
            } catch (e) {
                log('warn', `임시 폴더 청소 중 오류 (치명적이지 않음): ${e.message}`);
            }
        }
    }

    return downloadPerformed;
}

// [추가] 실패한 URL 로깅 함수
function logFailedUrl(channel, url) {
    const failedPath = path.join(getChannelDir(channel), 'failed_urls.txt');

    try {
        const content = fs.existsSync(failedPath) ? fs.readFileSync(failedPath, 'utf8') : '';
        const lines = content.split('\n').map(l => l.trim()).filter(l => l);
        const targetId = extractVideoId(url);

        // 이미 존재하는지 확인
        const exists = lines.some(line => extractVideoId(line) === targetId);
        if (!exists) {
            fs.appendFileSync(failedPath, url + '\n', 'utf8');
        }
    } catch (e) {
        log('warn', `실패 목록 업데이트 실패: ${e.message}`);
    }
}

// [추가] 성공한 URL을 실패 목록에서 제거
function removeFailedUrl(channel, url) {
    const failedPath = path.join(getChannelDir(channel), 'failed_urls.txt');
    if (!fs.existsSync(failedPath)) return;

    try {
        const content = fs.readFileSync(failedPath, 'utf8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l);
        const targetId = extractVideoId(url);

        const newLines = lines.filter(line => {
            const vid = extractVideoId(line);
            return vid !== targetId;
        });

        if (lines.length !== newLines.length) {
            fs.writeFileSync(failedPath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf8');
            log('info', `[Resolved] 실패 목록에서 제거됨: ${targetId}`);
        }
    } catch (e) {
        log('warn', `실패 목록 업데이트 실패: ${e.message}`);
    }
}

async function main() {
    const params = parseArgs();

    // [설정 적용] 파라미터로 경로가 들어왔으면 덮어쓰기
    if (params.framesDir) FRAMES_ROOT_DIR = params.framesDir;
    if (params.videoCacheDir) VIDEO_CACHE_DIR = params.videoCacheDir;

    // [초기화] 경로 생성
    if (!fs.existsSync(VIDEO_CACHE_DIR)) fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });
    if (!fs.existsSync(FRAMES_ROOT_DIR)) fs.mkdirSync(FRAMES_ROOT_DIR, { recursive: true });

    log('info', `[Config] Frame Output Dir: ${toRelativePath(FRAMES_ROOT_DIR)}`);
    log('info', `[Config] Video Cache Dir: ${toRelativePath(VIDEO_CACHE_DIR)}`);

    if (params.url) {
        const videoId = extractVideoId(params.url);
        if (!videoId) {
            log('error', '잘못된 YouTube URL입니다.');
            return;
        }

        // URL 정규화 (youtu.be 단축 링크 등 리다이렉트 방지)
        params.url = `https://www.youtube.com/watch?v=${videoId}`;

        log('info', `=== 비디오 Frame 추출 시작: ${videoId} ===`);
        log('info', `[Config] 설정: FPS=${params.fps}, Buffer=${params.buffer}초, 화질=${params.quality.join(', ')}, 포맷=${params.ext.join(', ').toUpperCase()}`);

        if (params.channel === 'manual') {
            fs.mkdirSync(path.join(BASE_DATA_DIR, 'manual'), { recursive: true });
        }

        await processSingleVideo(videoId, params);

    } else {
        // 자동 배치 수집 모드
        log('info', `\n=== 자동 배치 수집 모드 시작 [채널: ${params.channel}] ===`);
        await processBatch(params);
    }
}

async function processBatch(params) {
    const { channel } = params;
    const urlsPath = path.join(getChannelDir(channel), 'urls.txt');
    const deletedPath = path.join(getChannelDir(channel), 'deleted_urls.txt');

    if (!fs.existsSync(urlsPath)) {
        log('error', `urls.txt를 찾을 수 없습니다: ${toRelativePath(urlsPath)}`);
        return;
    }

    // 1. deleted_ids 로드
    const deletedIds = new Set();
    if (fs.existsSync(deletedPath)) {
        try {
            const lines = fs.readFileSync(deletedPath, 'utf8').split('\n');
            for (const line of lines) {
                const vid = extractVideoId(line);
                if (vid) deletedIds.add(vid);
            }
        } catch (e) { log('warn', `deleted_urls.txt 로드 실패: ${e.message}`); }
    }

    const urls = fs.readFileSync(urlsPath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    log('info', `총 ${urls.length}개 URL 발견`);

    let processedCount = 0;
    let skippedCount = 0;

    for (const url of urls) {
        const videoId = extractVideoId(url);
        if (!videoId) continue;

        if (deletedIds.has(videoId)) {
            // log('info', `[스킵] ${videoId} (삭제된 영상)`);
            skippedCount++;
            continue;
        }

        if (shouldCollect(channel, videoId, params)) { // [수정] params 객체 전달
            log('info', `\n--- [${processedCount + 1}] 처리 시작: ${videoId} ---`);
            params.url = url; // 현재 URL 설정
            const downloadPerformed = await processSingleVideo(videoId, params);
            processedCount++;

            // [변경] 다운로드가 실제로 수행되었을 때만 대기 (캐시 사용 시 즉시 진행)
            if (downloadPerformed) {
                // IP 차단 방지 딜레이 강화 (10 ~ 30초)
                const delay = 10000 + Math.random() * 20000;
                log('info', `[Wait] 대기: ${(delay / 1000).toFixed(1)}초...`);
                await new Promise(r => setTimeout(r, delay));

                // [추가] 10개마다 긴 휴식 (1분 ~ 3분)
                if (processedCount % 10 === 0) {
                    const longPause = 60000 + Math.random() * 120000;
                    log('info', `[Pause] 긴 휴식 (IP 차단 방지): ${(longPause / 1000).toFixed(1)}초...`);
                    await new Promise(r => setTimeout(r, longPause));
                }
            } else {
                log('info', `[Skip] 캐시된 비디오 사용 (또는 프레임 수집 완료) -> 대기 시간 스킵`);
            }
        } else {
            skippedCount++;
            // log('info', `[스킵] ${videoId} (수집 조건 미달)`);
        }
    }

    log('info', `=== 배치 작업 완료: 처리 ${processedCount}개, 스킵 ${skippedCount}개 ===`);
}

main().catch(e => console.error(e));
