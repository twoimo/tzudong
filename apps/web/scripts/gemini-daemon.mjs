
import http from 'http';
import path from 'path';
import fs from 'fs';

// --- 설정 (Configuration) ---
const PORT = 3456;
const GLOBAL_NODE_MODULES = '/home/ubuntu/.npm-global/lib/node_modules';
const CLI_DIST = path.join(GLOBAL_NODE_MODULES, '@google/gemini-cli/dist/src');
const CORE_DIST = path.join(GLOBAL_NODE_MODULES, '@google/gemini-cli/node_modules/@google/gemini-cli-core/dist');

// --- 로거 (Logger) ---
const LOG_FILE = path.join(process.cwd(), '.gemini', 'daemon.log');
function log(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, entry);
    // console.log 해제 시 터미널 출력 가능
}

log(`[Daemon] 프로세스 시작됨. PID: ${process.pid}`);

// --- 모듈 가져오기 (Imports) ---
let loadSettings, parseArguments, loadCliConfig, handleAtCommand, validateNonInteractiveAuth;
let GeminiEventType;

try {
    const configMod = await import(path.join(CLI_DIST, 'config/config.js'));
    const settingsMod = await import(path.join(CLI_DIST, 'config/settings.js'));
    const atCommandMod = await import(path.join(CLI_DIST, 'ui/hooks/atCommandProcessor.js'));
    const authMod = await import(path.join(CLI_DIST, 'validateNonInterActiveAuth.js')); // 주의: 파일명 대소문자 확인
    const coreMod = await import(path.join(CORE_DIST, 'index.js'));

    loadCliConfig = configMod.loadCliConfig;
    parseArguments = configMod.parseArguments;
    loadSettings = settingsMod.loadSettings;
    handleAtCommand = atCommandMod.handleAtCommand;
    validateNonInteractiveAuth = authMod.validateNonInteractiveAuth;
    GeminiEventType = coreMod.GeminiEventType;

    log('[Daemon] 필수 모듈 로드 완료.');
} catch (e) {
    log(`[ERROR] 모듈 로드 실패: ${e.message}`);
    log(e.stack);
    process.exit(1);
}

// --- 초기화 (Initialization) ---
let config = null;
let geminiClient = null;

async function init() {
    log('[Daemon] Gemini 설정 초기화 중...');
    const settings = loadSettings();

    // Argv 시뮬레이션:
    // gemini-3-flash-preview 모델 사용을 강제하기 위해 가짜 인자 전달
    // parseArguments 함수가 process.argv를 참조하므로 임시 교체
    const originalArgv = process.argv;
    process.argv = ['node', 'gemini', '--model', 'gemini-3-flash-preview'];

    const argv = await parseArguments(settings.merged);

    process.argv = originalArgv; // 원복

    const sessionId = 'daemon-' + Date.now();

    // 훅(Hooks) 로드 (필요시)
    const hooks = settings.workspace?.settings?.hooks;

    config = await loadCliConfig(settings.merged, sessionId, argv, { projectHooks: hooks });

    log('[Daemon] 설정 로드됨.');

    await config.initialize(); // 클라이언트 상태 초기화 (필수)
    log('[Daemon] 설정 초기화 완료.');

    // 인증 처리 (Auth)
    // 비대화형(Non-interactive) 환경에 맞는 인증 타입 검증 및 갱신
    const authType = await validateNonInteractiveAuth(
        settings.merged.security?.auth?.selectedType,
        settings.merged.security?.auth?.useExternal,
        config,
        settings
    );

    log(`[Daemon] 인증 타입: ${authType}`);
    await config.refreshAuth(authType);
    log('[Daemon] 인증 토큰 갱신 완료.');

    geminiClient = config.getGeminiClient();
    log('[Daemon] Gemini 클라이언트 준비 완료.');
}

// --- 서버 (Server) ---

const server = http.createServer(async (req, res) => {
    // 헬스 체크 엔드포인트
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
        return;
    }

    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            // Lazy Initialization: 첫 요청 시 초기화 수행
            if (!geminiClient) {
                await init();
            } else {
                // 이전 대화 기록이 쌓이면 느려지므로 매 요청마다 채팅 세션 초기화
                await geminiClient.resetChat();
            }

            const { prompt, imageBase64 } = JSON.parse(body);
            log(`[Request] 요청 수신 (길이: ${prompt.length}, 이미지: ${imageBase64 ? 'Yes' : 'No'})`);

            let tempImagePath = null;
            let finalPrompt = prompt;

            // 이미지 Base64 처리
            if (imageBase64) {
                // [Fix] CLI Workspace 보안 정책으로 인해, 이미지는 반드시 실행 경로(워크스페이스) 내부에 있어야 함.
                const tempDir = path.join(process.cwd(), 'temp_images');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                tempImagePath = path.join(tempDir, `oci-upload-${Date.now()}.jpg`);
                fs.writeFileSync(tempImagePath, Buffer.from(imageBase64, 'base64'));

                // CLI에 전달할 때는 상대 경로 권장 (혹은 절대 경로도 워크스페이스 내부는 허용됨)
                finalPrompt = `${prompt}\n\nUser Input Image: @${tempImagePath}`;
                log(`[Image] 임시 파일 생성: ${tempImagePath}`);
            }

            log(`[Preview] ${finalPrompt.substring(0, 50)}...`);

            const abortController = new AbortController();

            // @include (이미지 첨부) 처리 로직
            const { processedQuery, error } = await handleAtCommand({
                query: finalPrompt,
                config: config,
                addItem: () => { },
                onDebugMessage: (msg) => log(`[Debug] ${msg}`),
                messageId: Date.now(),
                signal: abortController.signal
            });

            if (error) {
                if (tempImagePath) fs.unlinkSync(tempImagePath);
                throw new Error(`명령어 처리 오류: ${error}`);
            }

            // Gemini 서비스로 전송
            const parts = processedQuery || [{ text: finalPrompt }];
            const promptId = Math.random().toString(16).slice(2);

            const responseStream = geminiClient.sendMessageStream(parts, abortController.signal, promptId);

            let fullText = '';

            for await (const event of responseStream) {
                if (event.type === GeminiEventType.Content) {
                    if (event.value) fullText += event.value;
                } else if (event.type === GeminiEventType.Error) {
                    throw event.value.error;
                }
            }

            log(`[Response] 생성 완료 (${fullText.length} 자).`);

            // 파일 정리
            if (tempImagePath) {
                try {
                    fs.unlinkSync(tempImagePath);
                    log(`[Image] 임시 파일 삭제 완료`);
                } catch (e) {
                    log(`[Warning] 파일 삭제 실패: ${e.message}`);
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text: fullText }));

        } catch (e) {
            log(`[ERROR] 요청 처리 실패: ${e.message}`);
            log(e.stack);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    });
});

// 외부 접속 허용 (0.0.0.0)
server.listen(PORT, '0.0.0.0', () => {
    log(`[Server] 포트 ${PORT}에서 대기 중... (외부 접속 허용)`);
});
