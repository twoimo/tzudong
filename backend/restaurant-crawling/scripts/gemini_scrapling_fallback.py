import sys
import time
import random
import argparse
import os
import json
import re
from contextlib import contextmanager

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
PROFILE_LOCK_FILE = os.path.join(BROWSER_PROFILE_DIR, ".session.lock")
WEB_DUMP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "temp", "web_fallback_dumps"))


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


def _try_acquire_lock(lock_fp):
    try:
        lock_fp.seek(0, os.SEEK_END)
        if lock_fp.tell() == 0:
            lock_fp.write("0")
            lock_fp.flush()
        lock_fp.seek(0)

        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock_fp.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock_fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except Exception:
        return False


def _release_lock(lock_fp):
    if os.name == "nt":
        import msvcrt
        lock_fp.seek(0)
        msvcrt.locking(lock_fp.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock_fp.fileno(), fcntl.LOCK_UN)


@contextmanager
def profile_session_lock(timeout_sec=600, poll_sec=0.5):
    """동일 프로필 동시 실행을 막아 쿠키/세션 손상을 방지."""
    os.makedirs(BROWSER_PROFILE_DIR, exist_ok=True)
    lock_fp = open(PROFILE_LOCK_FILE, "a+", encoding="utf-8")
    start = time.time()
    acquired = False

    try:
        while True:
            if _try_acquire_lock(lock_fp):
                acquired = True
                break

            waited = time.time() - start
            if waited >= timeout_sec:
                raise TimeoutError(f"브라우저 프로필 락 대기 시간 초과 ({int(waited)}s)")
            time.sleep(poll_sec)

        lock_fp.seek(0)
        lock_fp.truncate()
        lock_fp.write(f"pid={os.getpid()} ts={int(time.time())}\n")
        lock_fp.flush()
        yield
    finally:
        if acquired:
            try:
                _release_lock(lock_fp)
            except Exception as e:
                log(f"프로필 락 해제 경고: {compact_error(e)}")
        try:
            lock_fp.close()
        except Exception:
            pass


def load_cookie_backup(context):
    """백업 쿠키를 컨텍스트에 로드 (가능할 때만)."""
    if not os.path.exists(COOKIE_FILE):
        return False

    try:
        with open(COOKIE_FILE, "r", encoding="utf-8") as f:
            cookies = json.load(f)
    except Exception as e:
        log(f"쿠키 백업 로드 실패: {compact_error(e)}")
        return False

    if not isinstance(cookies, list) or not cookies:
        log("쿠키 백업 로드 건너뜀: 유효한 쿠키가 없음")
        return False

    now = time.time()
    valid_cookies = []
    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue
        if not cookie.get("name") or "value" not in cookie:
            continue
        expires = cookie.get("expires")
        if isinstance(expires, (int, float)) and expires > 0 and expires < (now - 60):
            continue
        valid_cookies.append(cookie)

    if not valid_cookies:
        log("쿠키 백업 로드 건너뜀: 만료되지 않은 쿠키가 없음")
        return False

    try:
        context.add_cookies(valid_cookies)
        log(f"쿠키 백업 로드 완료: {len(valid_cookies)}개")
        return True
    except Exception as e:
        log(f"쿠키 백업 적용 실패: {compact_error(e)}")
        return False


def save_cookie_backup(context, reason="runtime"):
    """현재 세션 쿠키를 백업 파일로 저장."""
    try:
        cookies = context.cookies()
        if not isinstance(cookies, list) or not cookies:
            log(f"쿠키 백업 저장 건너뜀 ({reason}): 저장할 쿠키 없음")
            return False

        os.makedirs(os.path.dirname(COOKIE_FILE), mode=0o700, exist_ok=True)
        with open(COOKIE_FILE, "w", encoding="utf-8") as f:
            json.dump(cookies, f, ensure_ascii=False, indent=2)
        try:
            os.chmod(COOKIE_FILE, 0o600)
        except Exception as perm_err:
            log(f"쿠키 파일 권한 설정 경고: {compact_error(perm_err)}")

        log(f"✅ 쿠키 백업 저장 완료 ({reason}, {len(cookies)}개)")
        return True
    except Exception as e:
        log(f"쿠키 백업 저장 실패 ({reason}): {compact_error(e)}")
        return False


def save_web_dump(page, stage, extra=None):
    """웹 폴백 실패 진단용 HTML/스크린샷 덤프를 저장한다."""
    try:
        os.makedirs(WEB_DUMP_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        safe_stage = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(stage or "unknown")).strip("_") or "unknown"
        dump_dir = os.path.join(WEB_DUMP_DIR, f"{ts}_{safe_stage}_{os.getpid()}")
        os.makedirs(dump_dir, exist_ok=True)

        current_url = None
        if page is not None:
            try:
                current_url = page.url
            except Exception:
                current_url = None

            try:
                html = page.content()
                with open(os.path.join(dump_dir, "page.html"), "w", encoding="utf-8", errors="replace") as f:
                    f.write(html)
            except Exception as html_err:
                log(f"웹 덤프 HTML 저장 실패: {compact_error(html_err)}")

            try:
                page.screenshot(path=os.path.join(dump_dir, "page.png"), full_page=True)
            except Exception as shot_err:
                log(f"웹 덤프 스크린샷 저장 실패: {compact_error(shot_err)}")

        meta = {
            "timestamp": int(time.time()),
            "stage": stage,
            "pid": os.getpid(),
            "url": current_url,
        }
        if extra:
            meta["extra"] = extra
        with open(os.path.join(dump_dir, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        log(f"🧾 웹 덤프 저장 완료: {dump_dir}")
        return dump_dir
    except Exception as dump_err:
        log(f"웹 덤프 저장 실패: {compact_error(dump_err)}")
        return None


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

        # Gemini 입력창이 보이면 로그인 완료 (가장 강한 신호)
        textbox_locator = page.locator('div.ql-editor[contenteditable="true"], div[role="textbox"]')
        if textbox_locator.count() > 0:
            try:
                if textbox_locator.first.is_visible():
                    return True
            except Exception:
                pass
            # headless 환경에서 visibility 계산이 불안정할 수 있어 count 기반으로도 인정
            return True

        # 입력창이 아직 없어도 계정 아바타/계정 버튼이 보이면 로그인 완료로 간주
        account_badge_locator = page.locator(
            'button[aria-label*="Google"], a[aria-label*="Google"], '
            'img[referrerpolicy="no-referrer"], button[aria-label*="@"]'
        )
        if account_badge_locator.count() > 0:
            try:
                if account_badge_locator.first.is_visible():
                    return True
            except Exception:
                pass
            return True

        # 명시적인 로그인 CTA(텍스트 포함)가 보이면 미로그인으로 간주
        explicit_login_cta = page.locator(
            'a[href*="accounts.google.com/ServiceLogin"]:has-text("Sign in"), '
            'a[href*="accounts.google.com/ServiceLogin"]:has-text("로그인"), '
            'button:has-text("Sign in"), button:has-text("로그인")'
        ).first
        if explicit_login_cta.is_visible():
            return False

        return False
    except:
        return False


def wait_for_login_detection(page, timeout_sec=600, poll_sec=3):
    """수동 로그인 완료를 자동 감지한다."""
    log(f"로그인 상태 자동 감지 대기 중... (최대 {timeout_sec}초)")
    start = time.time()
    while time.time() - start < timeout_sec:
        if is_logged_in(page):
            log("✅ 로그인 상태 자동 감지 성공")
            return True
        time.sleep(poll_sec)
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


def accept_upload_disclaimer_if_present(page):
    """업로드 동의 모달이 뜨면 자동으로 Agree 처리."""
    log("업로드 동의 팝업 확인/Agree 처리 시도")
    agree_btn_selectors = [
        '[data-test-id="upload-image-agree-button"]',
        'button:has-text("Agree")',
        'button:has-text("동의")',
    ]

    for selector in agree_btn_selectors:
        btn = page.locator(selector).first
        try:
            if btn.count() == 0:
                continue
            btn.click(timeout=5000, force=True)
            human_delay(0.5, 1.5)
            try:
                page.wait_for_selector("upload-image-disclaimer-dialog", state="hidden", timeout=5000)
            except Exception:
                pass
            log("업로드 동의 팝업 Agree 처리 완료")
            return True
        except Exception as e:
            log(f"업로드 동의 팝업 버튼 클릭 실패({selector}): {compact_error(e)}")

    return False


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


def try_direct_file_input_upload(page, file_path):
    """DOM의 file input을 직접 순회하며 업로드를 시도한다."""
    input_selectors = [
        'input[type="file"][accept*="video"]',
        'input[type="file"][accept*="mp4"]',
        'input[type="file"][accept*="*/*"]',
        'input[type="file"]',
    ]

    last_error = None

    for selector in input_selectors:
        locator = page.locator(selector)
        try:
            count = locator.count()
        except Exception as e:
            last_error = e
            continue

        if count == 0:
            continue

        for idx in range(min(count, 6)):
            candidate = locator.nth(idx)
            try:
                if candidate.get_attribute("disabled") is not None:
                    continue
            except Exception:
                pass

            try:
                candidate.set_input_files(file_path)
                return True, selector, idx, None
            except Exception as e:
                last_error = e

    return False, None, None, last_error


def manual_login():
    """Camoufox(Firefox) 영구 프로필 기반 수동 로그인"""
    log("🔑 수동 로그인 모드 시작 (Camoufox Firefox 기반)")
    log(f"프로필 경로: {BROWSER_PROFILE_DIR}")
    log("Firefox 브라우저가 열리면 구글 계정으로 로그인해 주세요.")

    with profile_session_lock():
        with _create_camoufox(headless=False) as context:
            load_cookie_backup(context)
            page = context.new_page()
            try:
                page.goto(
                    "https://accounts.google.com/ServiceLogin?continue=https://gemini.google.com/",
                    wait_until="domcontentloaded",
                    timeout=30000
                )
            except Exception as e:
                log(f"페이지 로딩 지연 (무시하고 계속 진행): {compact_error(e)}")

            log("로그인 후 자동 감지를 기다려 주세요. (필요 시 Enter 수동 확인도 지원)")
            detected = wait_for_login_detection(page, timeout_sec=900, poll_sec=3)

            if not detected:
                if sys.stdin and sys.stdin.isatty():
                    log("자동 감지 시간 초과. 수동 확인(Enter)로 계속할 수 있습니다.")
                    input(">>> 로그인을 마쳤다면 Enter를 누르세요...")
                else:
                    log("❌ 비대화형 모드에서 로그인 자동 감지에 실패했습니다.")
                    sys.exit(1)

            save_cookie_backup(context, reason="manual-login")

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

    with profile_session_lock():
        with _create_camoufox(headless=True) as context:
            restored_cookies = load_cookie_backup(context)
            page = context.new_page()

            log("gemini.google.com 으로 이동 중...")
            try:
                page.goto("https://gemini.google.com/", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception as e:
                log(f"페이지 로딩 지연 (계속 진행): {compact_error(e)}")
            human_delay(2, 4)

            if check_for_soft_ban(page):
                save_web_dump(page, "soft_ban_detected")
                return 43

            if not is_logged_in(page) and restored_cookies:
                log("쿠키 백업 적용 후 로그인 상태 재확인...")
                try:
                    page.goto("https://gemini.google.com/", wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_load_state("networkidle", timeout=15000)
                except Exception as e:
                    log(f"재확인 페이지 로딩 지연 (계속 진행): {compact_error(e)}")
                human_delay(1, 2)

            if not is_logged_in(page):
                log("❌ [CRITICAL] 로그인이 되어 있지 않습니다!")
                log("해결 방법: 'python backend/restaurant-crawling/scripts/gemini_scrapling_fallback.py --login' 을 실행하여 로그인하세요.")
                save_web_dump(page, "login_required")
                return 44

            authenticated = True
            save_cookie_backup(context, reason="auth-verified")
            reset_chat_context(page)

            stale_marker = detect_stale_context(page)
            if stale_marker:
                log(f"stale context marker 감지: {stale_marker} (RETRY)")
                save_web_dump(page, "stale_context_marker", {"marker": stale_marker})
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
                accept_upload_disclaimer_if_present(page)

                log("동영상 업로드 메뉴 시도...")
                uploaded = False
                upload_button_selectors = [
                    'button[aria-label="Open upload file menu"]',
                    'button[aria-label*="Upload file"]',
                    'button[aria-label*="upload file menu"]',
                    'button[aria-label*="파일 업로드 메뉴"]',
                    'button[aria-label*="파일 업로드"]',
                    'button[aria-label*="업로드 메뉴"]',
                    'button[aria-label*="첨부"]',
                    'button:has-text("Upload")',
                    'button:has-text("업로드")',
                    'button:has-text("첨부")',
                ]

                for selector in upload_button_selectors:
                    if uploaded:
                        break

                    btn_locator = page.locator(selector)
                    try:
                        btn_count = btn_locator.count()
                    except Exception:
                        continue

                    for btn_idx in range(min(btn_count, 4)):
                        if uploaded:
                            break

                        btn = btn_locator.nth(btn_idx)
                        try:
                            if not btn.is_visible():
                                continue
                        except Exception:
                            continue

                        for click_try in range(2):
                            try:
                                with page.expect_file_chooser(timeout=20000) as fc_info:
                                    btn.click()
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
                                uploaded = True
                                log(f"업로드 버튼 경로 성공: {selector} (idx={btn_idx})")
                                break
                            except Exception as e:
                                if click_try == 0 and accept_upload_disclaimer_if_present(page):
                                    log("동의 팝업 처리 후 업로드 버튼 재시도")
                                    continue
                                log(f"업로드 버튼 경로 실패({selector}, idx={btn_idx}): {compact_error(e)}")
                                break

                if not uploaded:
                    # 버튼 경로 실패 시 DOM의 file input을 직접 순회
                    direct_ok, direct_selector, direct_idx, direct_err = try_direct_file_input_upload(page, video_abs_path)
                    if direct_ok:
                        uploaded = True
                        log(f"직접 file input 경로 성공: {direct_selector} (idx={direct_idx})")
                    elif direct_err is not None:
                        log(f"직접 file input 업로드 실패: {compact_error(direct_err)}")

                if not uploaded:
                    # Gemini 내부 hidden 업로드 트리거 버튼 경로(버튼 비가시 상태 포함)
                    hidden_trigger_selectors = [
                        'button[data-test-id="hidden-local-file-upload-button"]',
                        'button[data-test-id="hidden-local-image-upload-button"]',
                        'button[xapfileselectortrigger]',
                    ]
                    for trigger_sel in hidden_trigger_selectors:
                        trigger = page.locator(trigger_sel).first
                        try:
                            if trigger.count() == 0:
                                continue
                            with page.expect_file_chooser(timeout=12000) as fc_info:
                                try:
                                    trigger.click(force=True, timeout=4000)
                                except Exception:
                                    trigger.dispatch_event("click")
                            fc_info.value.set_files(video_abs_path)
                            uploaded = True
                            log(f"hidden trigger 업로드 성공: {trigger_sel}")
                            break
                        except Exception as e:
                            if accept_upload_disclaimer_if_present(page):
                                log("동의 팝업 처리 후 hidden trigger 재시도")
                                try:
                                    with page.expect_file_chooser(timeout=12000) as fc_info:
                                        try:
                                            trigger.click(force=True, timeout=4000)
                                        except Exception:
                                            trigger.dispatch_event("click")
                                    fc_info.value.set_files(video_abs_path)
                                    uploaded = True
                                    log(f"hidden trigger 업로드 성공(재시도): {trigger_sel}")
                                    break
                                except Exception as retry_err:
                                    log(f"hidden trigger 업로드 재시도 실패({trigger_sel}): {compact_error(retry_err)}")
                            else:
                                log(f"hidden trigger 업로드 실패({trigger_sel}): {compact_error(e)}")

                if uploaded:
                    log("파일 업로드 대기 (진행 표시줄 확인)...")
                    try:
                        remove_btn = page.locator('button[aria-label*="Remove file"], button[aria-label*="삭제"], button[aria-label*="Delete"], button[aria-label*="지우기"]').first
                        remove_btn.wait_for(state="visible", timeout=120000)
                        page.wait_for_selector('mat-progress-spinner, mat-spinner', state="hidden", timeout=120000)
                        log("업로드 완료!")
                    except Exception as e:
                        log(f"업로드 완료 감지 지연 (계속 진행): {compact_error(e)}")
                else:
                    log("업로드 메뉴/입력 요소를 찾지 못했습니다. 새 세션으로 재시도합니다.")
                    save_web_dump(page, "upload_menu_missing", {"selectors": upload_button_selectors})
                    return "RETRY"

                human_delay(1, 2)
                textarea = page.locator('div.ql-editor[contenteditable="true"], div[role="textbox"]').first
                textarea.fill(prompt_text)

                human_delay(1, 2)
                send_button = page.locator('button[aria-label*="Send"], button[aria-label*="보내기"], button.send-button').first
                response_selector = (
                    '.message-content, message-content, div[data-message-author-role="model"], '
                    'model-response, response-container .response-container-content, '
                    '.response-container-content .markdown'
                )

                log("전송 버튼 활성화 대기 및 클릭...")
                try:
                    send_button.wait_for(state="visible", timeout=60000)
                    send_button.click(timeout=60000)
                except Exception as e:
                    log(f"전송 버튼 클릭 실패, 엔터키로 대체 시도: {compact_error(e)}")
                    textarea.press('Enter')

                def get_model_text_blocks():
                    blocks = []
                    try:
                        for elem in page.locator(response_selector).all():
                            try:
                                txt = elem.inner_text().strip()
                            except Exception:
                                continue
                            if txt:
                                blocks.append(txt)
                    except Exception:
                        pass
                    return blocks

                def is_generation_in_progress():
                    try:
                        if not send_button.is_visible():
                            return False
                        aria = (send_button.get_attribute("aria-label") or "").lower()
                        cls = (send_button.get_attribute("class") or "").lower()
                        return "stop" in aria or " stop" in f" {cls} "
                    except Exception:
                        return False

                def is_send_ready():
                    try:
                        return send_button.is_visible() and send_button.is_enabled() and not is_generation_in_progress()
                    except Exception:
                        return False

                log("답변 생성 대기 중... (최대 600초)")
                max_wait_time = 900
                start_wait = time.time()
                success = False

                while time.time() - start_wait < max_wait_time:
                    draft_btns = page.locator('button:has-text("답변 A"), button:has-text("초안 1"), button:has-text("Draft 1"), button[aria-label*="답변 A"], button[aria-label*="초안 1"]').all()
                    if draft_btns:
                        human_delay(3, 5)
                        log("A/B 답변 선택(Draft) 화면 감지.")
                        messages = page.locator(response_selector).all()
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

                    if is_send_ready():
                        human_delay(2, 4)
                        success = True
                        break

                    try:
                        text_blocks = get_model_text_blocks()
                        if text_blocks:
                            current_text = text_blocks[-1]
                            if ('"origin_name"' in current_text or '"restaurants"' in current_text) and (current_text.endswith('}') or current_text.endswith(']') or current_text.endswith('```')):
                                time.sleep(3)
                                if get_model_text_blocks() and get_model_text_blocks()[-1].strip() == current_text:
                                    log("답변 JSON 텍스트 렌더링 완료 감지.")
                                    success = True
                                    break
                            elif '업로드하신 파일을 읽을 수 없습니다' in current_text or '언어 모델일 뿐' in current_text:
                                time.sleep(3)
                                success = True
                                break
                    except Exception:
                        pass
                    time.sleep(3)

                if not success:
                    log("응답 생성 대기 시간 초과(Timeout).")
                    save_web_dump(page, "response_wait_timeout")
                    return "RETRY"

                text_blocks = get_model_text_blocks()
                if text_blocks:
                    last_response = ""
                    for _ in range(20):
                        text_blocks = get_model_text_blocks()
                        if text_blocks:
                            last_response = text_blocks[-1].strip()
                        if last_response:
                            break
                        time.sleep(2)

                    if not last_response:
                        log("경고: 텍스트 추출 실패.")
                        save_web_dump(page, "response_text_empty_after_ready")
                        return "RETRY"

                    error_keywords = ["업로드하신 파일을 읽을 수 없습니다", "파일에 문제가 없는지 확인해 주세요", "언어 모델일 뿐이라서", "I am just a language model", "단지 언어 모델일 뿐이고"]
                    if any(keyword in last_response for keyword in error_keywords):
                        log("Gemini에서 비디오 파일 처리를 거부했습니다.")
                        save_web_dump(page, "gemini_rejected_video", {"response_excerpt": last_response[:280]})
                        return "RETRY"

                    for marker in STALE_CONTEXT_MARKERS:
                        if marker in last_response:
                            log(f"응답 본문에서 stale marker 감지: {marker}")
                            save_web_dump(page, "stale_marker_in_response", {"marker": marker})
                            return "RETRY"

                    valid, payload_or_reason = validate_response_payload(last_response)
                    if not valid:
                        log(f"응답 JSON 검증 실패: {payload_or_reason}")
                        save_web_dump(page, "invalid_json_response", {"reason": payload_or_reason, "response_excerpt": last_response[:280]})
                        return "RETRY"

                    os.makedirs(os.path.dirname(output_path), exist_ok=True)
                    with open(output_abs_path, "w", encoding="utf-8") as out_f:
                        json.dump(payload_or_reason, out_f, ensure_ascii=False)
                    if authenticated:
                        save_cookie_backup(context, reason="response-success")
                    log(f"결과 저장 성공!")
                    return 0
                else:
                    log("답변 요소를 찾을 수 없습니다.")
                    save_web_dump(page, "model_response_not_found")
                    return "RETRY"

            except Exception as e:
                log(f"제어 중 오류: {compact_error(e)}")
                save_web_dump(page, "control_exception", {"error": compact_error(e)})
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
