import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import http from 'http';
import sharp from 'sharp'; // 이미지 최적화

const execAsync = promisify(exec);

// --- 데몬 설정 (Daemon Configuration) ---
const DAEMON_PORT = 3456;
const PROJECT_ROOT = process.cwd();
const DAEMON_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'gemini-daemon.mjs');

async function checkDaemonHealth(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${DAEMON_PORT}/health`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

async function startDaemon() {
    console.log('[Gemini Daemon] 데몬 프로세스 시작 중...');
    const subprocess = spawn(process.execPath, [DAEMON_SCRIPT], {
        detached: true,
        stdio: 'ignore', // 로그는 파일로 기록됨
        cwd: PROJECT_ROOT
    });
    subprocess.unref(); // 부모 프로세스가 종료되어도 데몬 유지

    // 시작 대기 (최대 5초)
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await checkDaemonHealth()) {
            console.log('[Gemini Daemon] 데몬 준비 완료.');
            return true;
        }
    }
    console.warn('[Gemini Daemon] 데몬 시작 실패 (타임아웃).');
    return false;
}

async function analyzeWithDaemon(tempImagePath: string, promptText: string): Promise<any> {
    const fullPrompt = `${promptText}\n\nUser Input Image: @${tempImagePath}`;

    return new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${DAEMON_PORT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Daemon Error: ${res.statusCode} ${data}`));
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    if (json.error) reject(new Error(json.error));
                    else resolve(json);
                } catch (e) {
                    reject(new Error('Invalid JSON from Daemon'));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(JSON.stringify({ prompt: fullPrompt }));
        req.end();
    });
}


// --- 기존 CLI 스폰 방식 폴백 (느림) ---
async function analyzeWithSpawn(imageBuffer: Buffer, promptText: string): Promise<any> {
    console.log('[Gemini CLI] 프로세스 스폰 방식(느림)으로 실행...');
    const projectTempDir = path.join(process.cwd(), '.gemini', 'tmp');
    if (!fs.existsSync(projectTempDir)) {
        await fs.promises.mkdir(projectTempDir, { recursive: true });
    }
    const tempFilePath = path.join(projectTempDir, `receipt-${Date.now()}.jpg`);
    const promptFilePath = path.join(projectTempDir, `prompt-${Date.now()}.txt`);

    try {
        await fs.promises.writeFile(tempFilePath, imageBuffer);
        const model = 'gemini-3-flash-preview';
        const fullPrompt = `${promptText}\n\nUser Input Image: @${tempFilePath}`;
        await fs.promises.writeFile(promptFilePath, fullPrompt, 'utf-8');

        const command = `cat "${promptFilePath}" | gemini --model ${model}`;
        const { stdout, stderr } = await execAsync(command, { timeout: 60000 });

        if (stderr) console.warn('[Gemini CLI] Stderr:', stderr);

        const text = stdout.toString();
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

        if (!jsonMatch) throw new Error('JSON 파싱 실패');

        await fs.promises.unlink(tempFilePath).catch(() => { });
        await fs.promises.unlink(promptFilePath).catch(() => { });

        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } catch (e) {
        await fs.promises.unlink(tempFilePath).catch(() => { });
        await fs.promises.unlink(promptFilePath).catch(() => { });
        throw e;
    }
}

// --- 이미지 최적화 (Sharp) ---
async function optimizeImage(buffer: Buffer): Promise<Buffer> {
    try {
        const metadata = await sharp(buffer).metadata();
        // 이미지가 너무 크면 리사이징 (폭 1024px로 제한)
        if (metadata.width && metadata.width > 1024) {
            return await sharp(buffer)
                .resize({ width: 1024 })
                .jpeg({ quality: 80 })
                .toBuffer();
        }
        // 크기가 작더라도 포맷 통일 및 용량 감소를 위해 JPEG 80% 변환
        return await sharp(buffer)
            .jpeg({ quality: 80 })
            .toBuffer();
    } catch (e) {
        console.warn('[Gemini Lib] 이미지 최적화 실패 (원본 사용):', e);
        return buffer;
    }
}


// -----------------------------------------------------------
// 메인 함수
// -----------------------------------------------------------

export async function analyzeReceiptWithCliFallback(imageBuffer: Buffer, promptText: string): Promise<any> {
    const startTime = Date.now();
    console.log('[Gemini Lib] 분석 요청 시작...');

    // 이미지 최적화 (용량 절감 -> 속도 향상)
    const originalSize = imageBuffer.length;
    let optimizedBuffer = imageBuffer;
    try {
        optimizedBuffer = await optimizeImage(imageBuffer);
        const newSize = optimizedBuffer.length;
        console.log(`[Gemini Lib] 이미지 최적화: ${(originalSize / 1024).toFixed(0)}KB -> ${(newSize / 1024).toFixed(0)}KB (${((originalSize - newSize) / originalSize * 100).toFixed(0)}% 절감)`);
    } catch (e) {
        console.warn('[Gemini Lib] 최적화 건너뜀:', e);
    }

    // 임시 파일 생성 (데몬/CLI 공통 사용)
    const projectTempDir = path.join(process.cwd(), '.gemini', 'tmp');
    if (!fs.existsSync(projectTempDir)) {
        await fs.promises.mkdir(projectTempDir, { recursive: true });
    }
    const tempFilePath = path.join(projectTempDir, `receipt-d-${Date.now()}.jpg`);
    await fs.promises.writeFile(tempFilePath, optimizedBuffer);

    try {
        // 1. 데몬 방식 시도 (Fast, Free)
        let daemonHealthy = await checkDaemonHealth();
        if (!daemonHealthy) {
            daemonHealthy = await startDaemon();
        }

        if (daemonHealthy) {
            try {
                console.log('[Gemini Daemon] 데몬으로 요청 전송...');
                const result = await analyzeWithDaemon(tempFilePath, promptText);

                // 결과 파싱 (데몬은 { text: "..." } 반환)
                // 데몬이 반환한 텍스트 안에 JSON이 들어있음
                const text = result.text;
                const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

                if (jsonMatch) {
                    const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                    console.log(`[Gemini Daemon] 성공 (${Date.now() - startTime}ms)`);

                    // 파일 정리
                    await fs.promises.unlink(tempFilePath).catch(() => { });
                    return data;
                } else {
                    console.warn('[Gemini Daemon] JSON 파싱 실패, Raw Text 반환');
                    // 일부 경우 Text만 올 수 있음. 실패로 간주하지 않고 텍스트라도 반환?
                    // 아니, JSON을 기대하므로 실패 처리하고 CLI로?
                    throw new Error('JSON match failed');
                }
            } catch (e: any) {
                console.warn(`[Gemini Daemon] 실패 (${e.message}). CLI 스폰으로 폴백...`);
            }
        } else {
            console.warn('[Gemini Daemon] 데몬 연결 불가. CLI 스폰으로 폴백...');
        }

        // 2. 실패 시 레거시 스폰 방식 (Slow, Free)
        // tempFilePath는 이미 생성됨. analyzeWithSpawn은 buffer를 받아 다시 쓰지만,
        // 여기서는 spawn 함수를 그대로 두었으므로 buffer를 넘깁니다.
        // 효율을 위해 analyzeWithSpawn을 수정하여 path를 받게 할 수도 있지만, 안전하게 기존 로직 사용.

        await fs.promises.unlink(tempFilePath).catch(() => { }); // 데몬용 파일 삭제

        return await analyzeWithSpawn(imageBuffer, promptText);

    } catch (error) {
        console.error('[Gemini Lib] 모든 분석 방법 실패:', error);
        await fs.promises.unlink(tempFilePath).catch(() => { });
        throw error;
    }
}
