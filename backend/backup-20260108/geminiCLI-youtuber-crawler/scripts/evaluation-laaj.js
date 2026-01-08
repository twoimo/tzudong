/**
 * LAAJ (AI) 기반 평가 스크립트
 * 
 * Gemini CLI를 사용하여 5가지 평가 항목을 수행:
 * 1. visit_authenticity - 방문 여부 정확성
 * 2. rb_inference_score - reasoning_basis 추론 합리성
 * 3. rb_grounding_TF - reasoning_basis 실제 근거 일치도
 * 4. review_faithfulness_score - 음식 리뷰 충실도
 * 5. category_TF - 카테고리 정합성
 * 
 * Input: meatcreator_restaurants.jsonl (with RULE evaluation)
 * Output: 동일 파일에 laaj_evaluation_results 필드 추가
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { spawn } from 'child_process';

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
    }
}

// Gemini 모델 설정
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash';
let currentModel = PRIMARY_MODEL;

// 타임아웃 설정 (2분)
const GEMINI_TIMEOUT = 120000;

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
const PROMPT_FILE = path.resolve(__dirname, '../prompts/evaluation_laaj.txt');

// 로그 함수
function log(level, msg) {
    const time = getKSTDate().toTimeString().slice(0, 8);
    const tags = {
        info: '[INFO]',
        success: '[OK]',
        warning: '[WARN]',
        error: '[ERR]',
        debug: '[DBG]',
        gemini: '[AI]',
        laaj: '[LAAJ]'
    };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

// 통계
const stats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    noTranscript: 0,
    geminiCalls: 0,
    geminiErrors: 0,
    totalGeminiTime: 0
};

/**
 * Gemini CLI 호출
 */
function callGeminiCLI(prompt, model = currentModel) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        stats.geminiCalls++;
        
        const gemini = spawn('gemini', [
            '-p', prompt,
            '--model', model,
            '--output-format', 'json',
            '--yolo'
        ], {
            timeout: GEMINI_TIMEOUT
        });
        
        let stdout = '';
        let stderr = '';
        
        gemini.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        gemini.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        const timeout = setTimeout(() => {
            gemini.kill();
            stats.geminiErrors++;
            reject(new Error('Gemini CLI timeout'));
        }, GEMINI_TIMEOUT);
        
        gemini.on('close', (code) => {
            clearTimeout(timeout);
            const duration = Date.now() - startTime;
            stats.totalGeminiTime += duration;
            
            if (code === 0 && stdout) {
                resolve({ response: stdout, duration });
            } else {
                stats.geminiErrors++;
                reject(new Error(`Gemini CLI failed: ${stderr || 'Unknown error'}`));
            }
        });
        
        gemini.on('error', (error) => {
            clearTimeout(timeout);
            stats.geminiErrors++;
            reject(error);
        });
    });
}

/**
 * JSON 응답 파싱
 */
function parseGeminiResponse(response) {
    try {
        // JSON 블록 추출
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[1]);
        }
        
        // 직접 JSON 파싱 시도
        const cleanResponse = response.trim();
        const jsonStart = cleanResponse.indexOf('{');
        const jsonEnd = cleanResponse.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
            return JSON.parse(cleanResponse.substring(jsonStart, jsonEnd + 1));
        }
        
        return null;
    } catch (error) {
        log('warning', `JSON 파싱 실패: ${error.message}`);
        return null;
    }
}

/**
 * 자막 로드 (transcripts.jsonl에서)
 */
function loadTranscript(videoId) {
    const transcriptFiles = [
        path.join(DATA_DIR, 'transcripts.jsonl'),
        path.join(TODAY_PATH, 'transcripts.jsonl')
    ];
    
    for (const file of transcriptFiles) {
        if (!fs.existsSync(file)) continue;
        
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                if (data.videoId === videoId && data.transcript) {
                    // 타임스탬프 포맷팅
                    const formatted = data.transcript.map(t => {
                        const mins = Math.floor(t.start / 60);
                        const secs = Math.floor(t.start % 60).toString().padStart(2, '0');
                        return `[${mins}:${secs}] ${t.text}`;
                    }).join('\n');
                    return formatted;
                }
            } catch (e) {
                continue;
            }
        }
    }
    
    return null;
}

/**
 * 단일 영상 LAAJ 평가
 */
async function evaluateLAAJ(entry, promptTemplate) {
    const videoId = entry.videoId;
    const restaurants = entry.analysis || entry.restaurants || [];
    
    if (restaurants.length === 0) {
        return { skipped: true, reason: '음식점 없음' };
    }
    
    // 자막 로드
    const transcript = loadTranscript(videoId);
    if (!transcript) {
        stats.noTranscript++;
        return { skipped: true, reason: '자막 없음' };
    }
    
    // 평가 데이터 구성
    const evaluationData = {
        youtube_link: entry.youtube_link || `https://www.youtube.com/watch?v=${videoId}`,
        restaurants: restaurants.map(r => ({
            name: r.name,
            category: r.category || (r.categories && r.categories[0]) || null,
            reasoning_basis: r.reasoning_basis || null,
            youtuber_review: r.youtuber_review || null,
            address: r.address || null
        }))
    };
    
    // 프롬프트 생성
    let prompt = promptTemplate.replace('{restaurant_data}', JSON.stringify(evaluationData, null, 2));
    
    // 자막 추가
    prompt += `\n\n<참고: YouTube 자막>\n${transcript}\n</참고: YouTube 자막>`;
    
    // Gemini CLI 호출
    try {
        const { response, duration } = await callGeminiCLI(prompt);
        log('gemini', `응답 완료 (${Math.round(duration / 1000)}s)`);
        
        // 응답 파싱
        const parsed = parseGeminiResponse(response);
        if (!parsed) {
            return { failed: true, reason: '응답 파싱 실패' };
        }
        
        return { success: true, evaluation: parsed };
    } catch (error) {
        // Fallback 모델 시도
        if (currentModel !== FALLBACK_MODEL) {
            log('warning', `${currentModel} 실패, ${FALLBACK_MODEL}로 재시도`);
            currentModel = FALLBACK_MODEL;
            
            try {
                const { response, duration } = await callGeminiCLI(prompt, FALLBACK_MODEL);
                log('gemini', `Fallback 응답 완료 (${Math.round(duration / 1000)}s)`);
                
                const parsed = parseGeminiResponse(response);
                if (!parsed) {
                    return { failed: true, reason: '응답 파싱 실패' };
                }
                
                return { success: true, evaluation: parsed };
            } catch (fallbackError) {
                return { failed: true, reason: fallbackError.message };
            }
        }
        
        return { failed: true, reason: error.message };
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '='.repeat(60));
    log('info', ' LAAJ (AI) 기반 평가 시작');
    log('info', '='.repeat(60));
    
    const startTime = Date.now();
    
    // Gemini CLI 확인
    try {
        const { execSync } = await import('child_process');
        execSync('which gemini', { stdio: 'ignore' });
        log('success', 'Gemini CLI 확인 완료');
    } catch {
        log('error', 'Gemini CLI가 설치되지 않았습니다.');
        log('info', '설치: npm install -g @google/gemini-cli');
        process.exit(1);
    }
    
    // 프롬프트 파일 확인
    if (!fs.existsSync(PROMPT_FILE)) {
        log('error', `프롬프트 파일 없음: ${PROMPT_FILE}`);
        process.exit(1);
    }
    
    const promptTemplate = fs.readFileSync(PROMPT_FILE, 'utf-8');
    log('debug', `프롬프트 템플릿 로드 (${promptTemplate.length}자)`);
    
    // 입력 파일 찾기
    let inputFile = path.join(TODAY_PATH, 'meatcreator_restaurants.jsonl');
    
    if (!fs.existsSync(inputFile)) {
        const folders = fs.readdirSync(DATA_DIR)
            .filter(f => /^\d{2}-\d{2}-\d{2}$/.test(f))
            .sort()
            .reverse();
        
        for (const folder of folders) {
            const filePath = path.join(DATA_DIR, folder, 'meatcreator_restaurants.jsonl');
            if (fs.existsSync(filePath)) {
                inputFile = filePath;
                log('info', ` 최근 데이터 파일 사용: ${folder}`);
                break;
            }
        }
    }
    
    if (!fs.existsSync(inputFile)) {
        log('error', '맛집 데이터 파일이 없습니다.');
        process.exit(1);
    }
    
    log('info', ` 입력 파일: ${inputFile}`);
    log('info', ` Gemini 모델: ${currentModel}`);
    
    // 데이터 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries = lines.map(line => JSON.parse(line));
    
    stats.total = entries.length;
    log('info', ` ${entries.length}개 영상 데이터 로드`);
    log('info', '');
    
    // 평가 루프
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        
        // 이미 LAAJ 평가가 있으면 스킵
        if (entry.laaj_evaluation_results && Object.keys(entry.laaj_evaluation_results).length > 0) {
            stats.skipped++;
            continue;
        }
        
        log('laaj', `[${i + 1}/${entries.length}] 평가 중: ${entry.videoId || 'unknown'}`);
        
        const result = await evaluateLAAJ(entry, promptTemplate);
        
        if (result.skipped) {
            stats.skipped++;
            log('warning', `  스킵: ${result.reason}`);
        } else if (result.failed) {
            stats.failed++;
            log('error', `  실패: ${result.reason}`);
        } else if (result.success) {
            stats.success++;
            entry.laaj_evaluation_results = result.evaluation;
            log('success', `  완료`);
        }
        
        // 진행 상황
        if ((i + 1) % 5 === 0) {
            log('info', `진행: ${i + 1}/${entries.length} (성공: ${stats.success}, 실패: ${stats.failed})`);
        }
        
        // Rate limit (5 RPM = 12초 대기)
        if (result.success || result.failed) {
            await sleep(12000);
        }
    }
    
    // 결과 저장
    const outputContent = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(inputFile, outputContent, 'utf-8');
    
    // 통계 출력
    const duration = Date.now() - startTime;
    
    log('info', '');
    log('info', '='.repeat(60));
    log('success', ' LAAJ 평가 완료');
    log('info', '='.repeat(60));
    log('info', '');
    log('info', '[평가 결과]');
    log('info', `  총 영상: ${stats.total}개`);
    log('success', `  성공: ${stats.success}개`);
    log('warning', `  스킵: ${stats.skipped}개`);
    log('error', `  실패: ${stats.failed}개`);
    log('warning', `  자막 없음: ${stats.noTranscript}개`);
    log('info', '');
    log('info', '[Gemini 통계]');
    log('info', `  총 호출: ${stats.geminiCalls}회`);
    log('info', `  에러: ${stats.geminiErrors}회`);
    log('info', `  총 시간: ${Math.round(stats.totalGeminiTime / 1000)}초`);
    if (stats.geminiCalls > 0) {
        log('info', `  평균 시간: ${Math.round(stats.totalGeminiTime / stats.geminiCalls / 1000)}초`);
    }
    log('info', '');
    log('info', `소요 시간: ${Math.round(duration / 1000)}초`);
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `오류: ${error.message}`);
    console.error(error);
    process.exit(1);
});
