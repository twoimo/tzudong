import sys
import time
import os
import json
from patchright.sync_api import sync_playwright
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
BACKEND_ROOT = SCRIPT_DIR.parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.utils.privacy_log import safe_error_name

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def load_cookies_securely(cookie_file):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(cookie_file, flags)
    with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_cookies_securely(cookie_file, cookies):
    directory = os.path.dirname(cookie_file)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if os.name != "nt":
        os.chmod(directory, 0o700)

    temporary = f"{cookie_file}.tmp-{os.getpid()}"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(cookies, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, cookie_file)
        if os.name != "nt":
            os.chmod(cookie_file, 0o600)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise

def main():
    cookie_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "gemini_cookies.local.json"))
    
    log("Gemini 웹 브라우저 자동 로그인 및 쿠키 추출기")
    log("쿠키 저장소 준비 완료")
    
    with sync_playwright() as p:
        # patchright 런칭 (구글/클라우드플레어 우회에 특화됨)
        browser = p.chromium.launch(headless=False, args=["--start-maximized"])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1280, 'height': 800}
        )
        
        # 기존 쿠키 로드 시도
        if os.path.exists(cookie_file):
            log("기존 쿠키 로드 중...")
            try:
                cookies = load_cookies_securely(cookie_file)
                context.add_cookies(cookies)
            except Exception as error:
                log(f"기존 쿠키 로드 실패: {safe_error_name(error)}")

        page = context.new_page()
        log("gemini.google.com 이동 중...")
        page.goto("https://gemini.google.com/")
        
        log("==========================================================")
        log("브라우저 창이 열렸습니다.")
        log("만약 로그인 화면이 보인다면, 직접 구글 계정으로 로그인해주세요.")
        log("로그인이 완료되고, 프롬프트 입력창이 나타나면 자동으로 쿠키를 저장합니다.")
        log("==========================================================")
        
        # 구글 계정 아바타(로그인 성공 증표) 또는 채팅창이 보일 때까지 대기
        try:
            log("진행 중... 로그인이 완료되면 프로필 아이콘을 감지합니다.")
            # aria-label에 "Google 계정" 또는 이메일 정보가 들어간 요소를 기다림
            page.wait_for_selector('a[aria-label*="Google"], img[referrerpolicy="no-referrer"]', timeout=300000)
            log("로그인 성공 및 Gemini 화면 진입 확인!")
            
            # 페이지 안정화를 위해 약간 대기
            time.sleep(5)
            
            # 쿠키 추출 및 저장
            new_cookies = context.cookies()
            
            save_cookies_securely(cookie_file, new_cookies)

            log("✅ 인증 쿠키 추출 및 저장 완료")
            log("브라우저를 닫습니다. 이제 폴백 스크립트가 이 쿠키를 사용하여 백그라운드에서도 동작할 수 있습니다.")
            time.sleep(3)
            
        except Exception as error:
            log(f"❌ 화면 인식 실패 또는 시간 초과: {safe_error_name(error)}")
            log("로그인을 완료하지 못했거나, 화면 UI가 변경되었을 수 있습니다.")
            sys.exit(1)
            
        browser.close()

if __name__ == "__main__":
    main()
