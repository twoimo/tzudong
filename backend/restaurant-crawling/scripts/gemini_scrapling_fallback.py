import sys
import time
import random
import argparse
import os
import json

from camoufox.sync_api import Camoufox

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] [WebFallback] {msg}")

def human_delay(min_sec=1.5, max_sec=3.5):
    """구글 봇 탐지 회피를 위한 인간적인 랜덤 대기"""
    time.sleep(random.uniform(min_sec, max_sec))

STALE_CONTEXT_MARKERS = [
    "architecture.png",
    "Whisper 모듈",
]


def compact_error(err, max_len=240):
    """예외 로그에서 과도한 DOM/프롬프트 노출을 줄이기 위한 축약기."""
    text = str(err or "").strip().replace("\n", " ")
    return text[:max_len]


def extract_json_payload(text):
    """Gemini 응답 텍스트에서 JSON object payload를 추출한다."""
    if text is None:
        return None
    raw = str(text).strip()
    if not raw:
        return None

    # ```json ... ``` 코드블럭 우선 해제
    if raw.startswith("```"):
        lines = raw.splitlines()
        if len(lines) >= 3:
            raw = "\n".join(lines[1:-1]).strip()

    # JSON object만 허용
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    candidate = raw[start:end + 1]
    try:
        return json.loads(candidate)
    except Exception:
        return None


def validate_response_payload(text):
    """Fallback 성공 조건: 유효 JSON object + restaurants(list) 필수."""
    payload = extract_json_payload(text)
    if payload is None:
        return False, "invalid_json"
    if not isinstance(payload, dict):
        return False, "payload_not_object"
    if "restaurants" not in payload:
        return False, "missing_restaurants"
    if not isinstance(payload.get("restaurants"), list):
        return False, "restaurants_not_list"
    return True, payload

# --- 설정 ---
COOKIE_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "gemini_cookies.json"))
BROWSER_PROFILE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "camoufox_profile"))
ALLOWED_IO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _create_camoufox(headless=False):
    """Camoufox 영구 프로필 컨텍스트 생성.

    Firefox 기반이므로 Google의 CDP(Chrome DevTools Protocol) 탐지 완전 회피.
    persistent_context로 LocalStorage, IndexedDB, 쿠키 등 모든 브라우저 상태 보존.
    """
    os.makedirs(BROWSER_PROFILE_DIR, exist_ok=True)
    return Camoufox(
        persistent_context=True,
        user_data_dir=BROWSER_PROFILE_DIR,
        headless=headless,
        humanize=True,
        block_webrtc=True,
        enable_cache=True,
        locale="ko-KR",
        i_know_what_im_doing=True,
    )


def check_for_soft_ban(page):
    """구글 Soft Ban 또는 Captcha 화면 감지"""
    try:
        html = page.content().lower()
        if "unusual traffic" in html or "비정상적인 트래픽" in html:
            log("🚨 [CRITICAL] 구글 비정상 트래픽(Soft Ban) 감지됨!")
            return True
        if page.locator('iframe[src*="recaptcha"]').count() > 0:
            log("🚨 [CRITICAL] reCAPTCHA 감지됨! 봇으로 인식되었습니다.")
            return True
        return False
    except:
        return False

def is_logged_in(page):
    """로그인 상태 확인 (URL 및 특정 요소 감지)"""
    try:
        if "accounts.google.com" in page.url:
            return False
        login_btn = page.locator('a[href*="accounts.google.com/ServiceLogin"]').first
        if login_btn.is_visible():
            return False
        textbox = page.locator('div.ql-editor[contenteditable="true"], div[role="textbox"]').first
        if textbox.is_visible():
            return True
        return False
    except:
        return False


def reset_chat_context(page):
    """실행마다 fresh-chat 컨텍스트로 정리해 stale conversation 오염을 줄인다."""
    try:
        page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        log(f"Fresh chat 초기 이동 지연 (계속 진행): {compact_error(e)}")

    human_delay(1, 2)

    try:
        new_chat = page.locator(
            'button[aria-label*="새 채팅"], button[aria-label*="New chat"], '
            'a[aria-label*="새 채팅"], a[aria-label*="New chat"], '
            'button:has-text("새 채팅"), button:has-text("New chat")'
        ).first

        if new_chat.is_visible():
            new_chat.click()
            human_delay(0.5, 1.5)
            log("Fresh chat reset: clicked")
            return
    except Exception as e:
        log(f"Fresh chat 버튼 클릭 실패 (URL reset으로 대체): {compact_error(e)}")

    try:
        page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        log(f"Fresh chat URL reset 지연 (계속 진행): {compact_error(e)}")
    human_delay(1, 2)
    log("Fresh chat reset: url-reset")


def detect_stale_context(page):
    """DOM에 이전 작업 마커가 있으면 stale context 가능성을 반환."""
    try:
        html = page.content()
    except Exception:
        return None

    for marker in STALE_CONTEXT_MARKERS:
        if marker in html:
            return marker
    return None


def is_subpath(target_path, base_path):
    try:
        return os.path.commonpath([target_path, base_path]) == base_path
    except Exception:
        return False


def manual_login():
    """Camoufox(Firefox) 영구 프로필 기반 수동 로그인"""
    log("🔑 수동 로그인 모드 시작 (Camoufox Firefox 기반)")
    log(f"프로필 경로: {BROWSER_PROFILE_DIR}")
    log("Firefox 브라우저가 열리면 구글 계정으로 로그인해 주세요.")

    with _create_camoufox(headless=False) as context:
        page = context.new_page()
        try:
            page.goto(
                "https://accounts.google.com/ServiceLogin?continue=https://gemini.google.com/",
                wait_until="domcontentloaded",
                timeout=30000
            )
        except Exception as e:
            log(f"페이지 로딩 지연 (무시하고 계속 진행): {e}")

        log("로그인 완료 후 브라우저를 닫지 말고, 이 터미널에서 Enter를 눌러주세요.")
        input(">>> 로그인을 마쳤다면 Enter를 누르세요...")

        # 쿠키 백업 저장
        try:
            new_cookies = context.cookies()
            os.makedirs(os.path.dirname(COOKIE_FILE), mode=0o700, exist_ok=True)
            with open(COOKIE_FILE, "w", encoding="utf-8") as f:
                json.dump(new_cookies, f, ensure_ascii=False, indent=2)
            try:
                os.chmod(COOKIE_FILE, 0o600)
            except Exception as perm_err:
                log(f"쿠키 파일 권한 설정 경고: {compact_error(perm_err)}")
            log(f"✅ 쿠키 백업 저장 완료: {COOKIE_FILE}")
        except Exception as e:
            log(f"쿠키 백업 저장 실패: {e}")

        log("✅ 영구 프로필에 로그인 상태가 저장되었습니다.")
        log("다음번 실행 시 자동으로 로그인 상태가 유지됩니다.")

    sys.exit(0)


def run_fallback(prompt_path, video_path, output_path, target_model=None):
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        log(f"--- 시도 {attempt}/{max_retries} ---")
        try:
            exit_code = _run_fallback_once(prompt_path, video_path, output_path, target_model)
            if exit_code == "RETRY":
                log("일시적인 오류(거부) 발생으로 인해 브라우저 세션을 새로 시작하여 재시도합니다.")
                time.sleep(3)
                continue
            elif exit_code == 0:
                return 0
            else:
                return exit_code
        except SystemExit as e:
            return e.code
        except Exception as e:
            log(f"예기치 않은 예외 발생: {compact_error(e)}")
            return 1

    log("최대 재시도 횟수 초과. 빈 JSON 성공처리 없이 실패로 반환합니다.")
    return 45


def _run_fallback_once(prompt_path, video_path, output_path, target_model=None):
    prompt_abs_path = os.path.abspath(prompt_path)
    video_abs_path = os.path.abspath(video_path)
    output_abs_path = os.path.abspath(output_path)

    if not is_subpath(prompt_abs_path, ALLOWED_IO_ROOT):
        log(f"Error: Prompt path outside allowed root: {prompt_abs_path}")
        sys.exit(1)
    if not is_subpath(video_abs_path, ALLOWED_IO_ROOT):
        log(f"Error: Video path outside allowed root: {video_abs_path}")
        sys.exit(1)
    if not is_subpath(output_abs_path, ALLOWED_IO_ROOT):
        log(f"Error: Output path outside allowed root: {output_abs_path}")
        sys.exit(1)

    with open(prompt_abs_path, "r", encoding="utf-8", errors="replace") as f:
        prompt_text = f.read()

    if not os.path.exists(video_abs_path):
        log(f"Error: Video file not found at {video_abs_path}")
        sys.exit(1)

    log(f"초기화 중... (Video: {os.path.basename(video_abs_path)}, Model: {target_model})")

    authenticated = False

    log("Camoufox(Firefox) 영구 프로필 세션 시작")

    with _create_camoufox(headless=True) as context:
        page = context.new_page()

        log("gemini.google.com 으로 이동 중...")
        try:
            page.goto("https://gemini.google.com/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception as e:
            log(f"페이지 로딩 지연 (계속 진행): {compact_error(e)}")
        human_delay(2, 4)

        if check_for_soft_ban(page):
            return 43

        if not is_logged_in(page):
            log("❌ [CRITICAL] 로그인이 되어 있지 않습니다!")
            log("해결 방법: 'python backend/restaurant-crawling/scripts/gemini_scrapling_fallback.py --login' 을 실행하여 로그인하세요.")
            return 44

        authenticated = True
        reset_chat_context(page)

        stale_marker = detect_stale_context(page)
        if stale_marker:
            log(f"stale context marker 감지: {stale_marker} (RETRY)")
            return "RETRY"

        if target_model:
            log(f"모델 변경 시도: {target_model}")
            try:
                import re
                mode_picker_btn = page.locator('button[aria-label="Open mode picker"], button.input-area-switch').first
                if mode_picker_btn.is_visible():
                    mode_picker_btn.click()
                    human_delay(1, 2)

                    menu_items = page.locator('mat-menu-item, [role="menuitem"], .mat-mdc-menu-item').all()
                    model_clicked = False
                    for item in menu_items:
                        text = item.inner_text()
                        if re.search(r'\b' + re.escape(target_model) + r'\b', text, re.IGNORECASE):
                            item.click()
                            log(f"모델 선택 완료: {text.strip().split(chr(10))[0]}")
                            model_clicked = True
                            human_delay(1, 2)
                            break

                    if not model_clicked:
                        page.mouse.click(0, 0)
            except Exception as e:
                log(f"모델 변경 오류 (무시): {compact_error(e)}")

        try:
            page.wait_for_selector('div.ql-editor[contenteditable="true"], div[role="textbox"]', timeout=30000)
            page.locator('div.ql-editor[contenteditable="true"], div[role="textbox"]').first.click()
            human_delay(0.5, 1.5)

            log("동영상 업로드 메뉴 시도...")
            upload_menu_btn = page.locator('button[aria-label="Open upload file menu"], button[aria-label*="Upload file"], button[aria-label*="첨부"]').first

            if upload_menu_btn.is_visible():
                with page.expect_file_chooser(timeout=20000) as fc_info:
                    upload_menu_btn.click()
                    human_delay(1, 2)

                    menu_items = page.locator('mat-menu-item, [role="menuitem"], .mat-mdc-menu-item').all()
                    if menu_items:
                        clicked = False
                        for item in menu_items:
                            text = item.inner_text().lower()
                            if 'upload' in text or 'computer' in text or '업로드' in text or '컴퓨터' in text or '파일' in text:
                                item.click()
                                clicked = True
                                break
                        if not clicked:
                            menu_items[0].click()

                file_chooser = fc_info.value
                file_chooser.set_files(video_abs_path)

                log("파일 업로드 대기 (진행 표시줄 확인)...")
                try:
                    remove_btn = page.locator('button[aria-label*="Remove file"], button[aria-label*="삭제"], button[aria-label*="Delete"], button[aria-label*="지우기"]').first
                    remove_btn.wait_for(state="visible", timeout=120000)
                    page.wait_for_selector('mat-progress-spinner, mat-spinner', state="hidden", timeout=120000)
                    log("업로드 완료!")
                except Exception as e:
                    log(f"업로드 완료 감지 지연 (계속 진행): {compact_error(e)}")
            else:
                log("업로드 메뉴 버튼을 찾을 수 없습니다.")
                return 1

            human_delay(1, 2)
            textarea = page.locator('div.ql-editor[contenteditable="true"], div[role="textbox"]').first
            textarea.fill(prompt_text)

            human_delay(1, 2)
            send_button = page.locator('button[aria-label*="Send"], button[aria-label*="보내기"], button.send-button').first

            log("전송 버튼 활성화 대기 및 클릭...")
            try:
                send_button.wait_for(state="visible", timeout=60000)
                send_button.click(timeout=60000)
            except Exception as e:
                log(f"전송 버튼 클릭 실패, 엔터키로 대체 시도: {compact_error(e)}")
                textarea.press('Enter')

            log("답변 생성 대기 중... (최대 600초)")
            max_wait_time = 600
            start_wait = time.time()
            success = False

            while time.time() - start_wait < max_wait_time:
                draft_btns = page.locator('button:has-text("답변 A"), button:has-text("초안 1"), button:has-text("Draft 1"), button[aria-label*="답변 A"], button[aria-label*="초안 1"]').all()
                if draft_btns:
                    human_delay(3, 5)
                    log("A/B 답변 선택(Draft) 화면 감지.")
                    messages = page.locator('.message-content, message-content, div[data-message-author-role="model"]').all()
                    selected_index = 0
                    for idx, msg in enumerate(messages):
                        try:
                            text = msg.inner_text()
                            if '"origin_name"' in text or '"restaurants"' in text:
                                selected_index = idx
                                break
                        except Exception: pass
                    all_draft_btns = page.locator('button:has-text("답변"), button:has-text("초안"), button:has-text("Draft"), button[aria-label*="답변"], button[aria-label*="초안"]').all()
                    try:
                        if selected_index < len(all_draft_btns): all_draft_btns[selected_index].click()
                        else: draft_btns[0].click()
                        human_delay(1, 2)
                        apply_btn = page.locator('button:has-text("적용"), button:has-text("Apply")').first
                        if apply_btn.is_visible(): apply_btn.click()
                    except: pass
                    human_delay(2, 4)
                    success = True
                    break

                if send_button.is_visible() and send_button.is_enabled():
                    human_delay(2, 4)
                    success = True
                    break

                try:
                    elements = page.locator('.message-content, message-content, div[data-message-author-role="model"]').all()
                    if elements:
                        current_text = elements[-1].inner_text().strip()
                        if ('"origin_name"' in current_text or '"restaurants"' in current_text) and (current_text.endswith('}') or current_text.endswith(']') or current_text.endswith('```')):
                            time.sleep(3)
                            if elements[-1].inner_text().strip() == current_text:
                                log("답변 JSON 텍스트 렌더링 완료 감지.")
                                success = True
                                break
                        elif '업로드하신 파일을 읽을 수 없습니다' in current_text or '언어 모델일 뿐' in current_text:
                            time.sleep(3)
                            success = True
                            break
                except: pass
                time.sleep(3)

            if not success:
                log("응답 생성 대기 시간 초과(Timeout).")
                return "RETRY"

            elements = page.locator('.message-content, message-content, div[data-message-author-role="model"]').all()
            if elements:
                last_elem = elements[-1]
                last_response = ""
                for _ in range(15):
                    last_response = last_elem.inner_text().strip()
                    if last_response: break
                    time.sleep(2)

                if not last_response:
                    log("경고: 텍스트 추출 실패.")
                    return "RETRY"

                error_keywords = ["업로드하신 파일을 읽을 수 없습니다", "파일에 문제가 없는지 확인해 주세요", "언어 모델일 뿐이라서", "I am just a language model", "단지 언어 모델일 뿐이고"]
                if any(keyword in last_response for keyword in error_keywords):
                    log("Gemini에서 비디오 파일 처리를 거부했습니다.")
                    return "RETRY"

                for marker in STALE_CONTEXT_MARKERS:
                    if marker in last_response:
                        log(f"응답 본문에서 stale marker 감지: {marker}")
                        return "RETRY"

                valid, payload_or_reason = validate_response_payload(last_response)
                if not valid:
                    log(f"응답 JSON 검증 실패: {payload_or_reason}")
                    return "RETRY"

                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_abs_path, "w", encoding="utf-8") as out_f:
                    json.dump(payload_or_reason, out_f, ensure_ascii=False)
                log(f"결과 저장 성공!")
                return 0
            else:
                log("답변 요소를 찾을 수 없습니다.")
                return "RETRY"

        except Exception as e:
            log(f"제어 중 오류: {compact_error(e)}")
            return "RETRY"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gemini Web Fallback via Camoufox (Firefox Stealth)")
    parser.add_argument("-p", "--prompt", help="Prompt file path")
    parser.add_argument("-v", "--video", help="Video segment file path")
    parser.add_argument("-o", "--output", help="Output file path")
    parser.add_argument("-m", "--model", default=None, help="Target Gemini model")
    parser.add_argument("--login", action="store_true", help="Manual login mode to save cookies")

    args = parser.parse_args()

    if args.login:
        manual_login()
        sys.exit(0)

    if not (args.prompt and args.video and args.output):
        parser.print_help()
        sys.exit(1)

    max_attempts = 3
    for attempt in range(max_attempts):
        if attempt > 0:
            log(f"--- ⚠️ 재시도 ({attempt+1}/{max_attempts}) 시작 ---")
            with open(args.prompt, "a", encoding="utf-8") as f:
                f.write("\n\n[SYSTEM OVERRIDE] 반드시 주어진 JSON 형식으로만 응답을 강제 출력하세요.")

        result = run_fallback(args.prompt, args.video, args.output, target_model=args.model)

        if result == 0:
            log("작업을 성공적으로 마쳤습니다.")
            sys.exit(0)
        elif result == "RETRY":
            log("처리 실패/거부 감지. 5초 대기 후 재시도합니다...")
            time.sleep(5)
            continue
        else:
            sys.exit(result)

    log("❌ 최대 재시도 횟수 초과.")
    sys.exit(1)
