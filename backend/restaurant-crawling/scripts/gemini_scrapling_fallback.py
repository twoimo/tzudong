import sys
import time
import random
import argparse
import os
import json
from patchright.sync_api import sync_playwright

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] [WebFallback] {msg}")

def human_delay(min_sec=1.5, max_sec=3.5):
    """구글 봇 탐지 회피를 위한 인간적인 랜덤 대기"""
    time.sleep(random.uniform(min_sec, max_sec))

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

def run_fallback(prompt_path, video_path, output_path, target_model=None):
    with open(prompt_path, "r", encoding="utf-8", errors="replace") as f:
        prompt_text = f.read()

    video_abs_path = os.path.abspath(video_path)
    if not os.path.exists(video_abs_path):
        log(f"Error: Video file not found at {video_abs_path}")
        sys.exit(1)

    log(f"초기화 중... (Video: {os.path.basename(video_abs_path)}, Model: {target_model})")
    
    cookie_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "gemini_cookies.json"))
    
    log("Patchright 자동화 세션 시작 (Stealth Mode)")
    
    with sync_playwright() as p:
        # CI 환경(GitHub Actions) 최적화 및 봇 탐지 회피
        browser = p.chromium.launch(
            headless=True, # 테스트/CI 효율을 위해 Headless 전환. 쿠키가 완벽하면 화면이 필요없음.
            args=[
                "--disable-blink-features=AutomationControlled", # 핵심 봇 회피 옵션
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--window-size=1280,800"
            ]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1280, 'height': 800}
        )
        
        if os.path.exists(cookie_file):
            try:
                with open(cookie_file, "r", encoding="utf-8") as f:
                    cookies = json.load(f)
                    context.add_cookies(cookies)
                log("기존 쿠키 로드 완료.")
            except Exception as e:
                log(f"쿠키 로드 실패: {e}")

        page = context.new_page()
        
        # 봇 회피를 위한 기본 스크립트 주입
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        log("gemini.google.com 으로 이동 중...")
        page.goto("https://gemini.google.com/")
        human_delay(2, 4)
        
        if check_for_soft_ban(page):
            sys.exit(43) # 특수 종료 코드 (43: Soft Ban)
        
        if "accounts.google.com" in page.url or page.locator('text="Sign in"').count() > 0 or page.locator('text="로그인"').count() > 0:
            log("⚠️ 쿠키 만료/로그인 풀림 감지. CI 환경에서는 수동 로그인이 불가능하므로 종료합니다.")
            sys.exit(1)
        
        if target_model:
            log(f"모델 변경 시도: {target_model}")
            try:
                mode_picker_btn = page.locator('button[aria-label="Open mode picker"], button.input-area-switch').first
                if mode_picker_btn.is_visible():
                    mode_picker_btn.click()
                    human_delay(1, 2)
                    
                    # 메뉴 항목 중 target_model 단어가 단독으로 존재하는지 확인 (예: 'Pro'가 'problems'에 매칭되지 않게)
                    import re
                    menu_items = page.locator('mat-menu-item, [role="menuitem"], .mat-mdc-menu-item').all()
                    model_clicked = False
                    for item in menu_items:
                        text = item.inner_text()
                        if re.search(r'\b' + re.escape(target_model) + r'\b', text, re.IGNORECASE):
                            item.click()
                            log(f"모델 선택 완료: {text.strip().split(chr(10))[0]}") # 첫 줄만 출력
                            model_clicked = True
                            human_delay(1, 2)
                            break
                            
                    if not model_clicked:
                        page.mouse.click(0, 0)
            except Exception as e:
                log(f"모델 변경 오류 (무시): {e}")

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
                    remove_btn.wait_for(state="visible", timeout=120000) # 용량 고려 최대 120초
                    
                    page.wait_for_selector('mat-progress-spinner, mat-spinner', state="hidden", timeout=120000) # 용량 고려 120초
                    log("업로드 완료!")
                except Exception as e:
                    log(f"업로드 완료 감지 지연 (계속 진행): {e}")
            else:
                log("업로드 메뉴 버튼을 찾을 수 없습니다.")
                sys.exit(1)
            
            human_delay(1, 2)
            textarea = page.locator('div.ql-editor[contenteditable="true"], div[role="textbox"]').first
            textarea.fill(prompt_text)
            
            human_delay(1, 2)
            send_button = page.locator('button[aria-label*="Send"], button[aria-label*="보내기"], button.send-button').first
            
            prev_msg_count = page.locator('.message-content, message-content, div[data-message-author-role="model"]').count()
            
            log("전송 버튼 활성화 대기 및 클릭...")
            try:
                # 업로드가 완전히 끝나야 버튼이 활성화됨 (최대 60초 추가 대기)
                send_button.wait_for(state="visible", timeout=60000)
                # Playwright click()은 자동으로 element가 enabled 될 때까지 대기하지만, 명시적으로 확인
                send_button.click(timeout=60000)
            except Exception as e:
                log(f"전송 버튼 클릭 실패, 엔터키로 대체 시도: {e}")
                textarea.press('Enter')
            
            log("답변 생성 대기 중... (최대 150초)")
            # 깃허브 액션 시간 절약을 위해 최대 150초로 제한 (너무 길어지면 강제 종료)
            max_wait_time = 150
            start_wait = time.time()
            success = False
            
            while time.time() - start_wait < max_wait_time:
                current_count = page.locator('.message-content, message-content, div[data-message-author-role="model"]').count()
                
                if send_button.is_visible() and send_button.is_enabled():
                    if current_count > prev_msg_count:
                        human_delay(2, 4) # 스트리밍 완전 종료 대기
                        success = True
                        break
                
                time.sleep(3)
                
            if not success:
                log("응답 생성 대기 시간 초과(Timeout).")
                if check_for_soft_ban(page):
                    sys.exit(43)
                # 타임아웃 발생 시 에러로 간주하여 종료
                
            elements = page.locator('.message-content, message-content, div[data-message-author-role="model"]').all()
            if elements:
                last_elem = elements[-1]
                last_response = ""
                # 텍스트가 완전히 렌더링될 때까지 최대 30초 대기
                for _ in range(15):
                    last_response = last_elem.inner_text().strip()
                    if last_response:
                        break
                    time.sleep(2)
                    
                if not last_response:
                    log("경고: 텍스트 추출 최종 실패 (빈 문자열). DOM 덤프를 저장합니다.")
                    with open(output_path.replace('.json', '_dom.html'), 'w', encoding='utf-8') as f:
                        f.write(page.content())
                        
                log(f"추출된 텍스트 일부: {last_response[:100]}...")
                
                # Gemini에서 비디오 처리를 거부하는 에러 메시지 필터링
                error_keywords = ["업로드하신 파일을 읽을 수 없습니다", "파일에 문제가 없는지 확인해 주세요", "언어 모델일 뿐이라서", "I am just a language model", "단지 언어 모델일 뿐이고"]
                if any(keyword in last_response for keyword in error_keywords):
                    log("Gemini에서 비디오 파일 처리를 거부했습니다. (빈 JSON을 반환하여 해당 청크를 안전하게 스킵합니다)")
                    os.makedirs(os.path.dirname(output_path), exist_ok=True)
                    with open(output_path, "w", encoding="utf-8") as out_f:
                        out_f.write('{"restaurants": []}')
                    sys.exit(0)

                # 타임아웃 발생 시에도 응답 거부(에러 메시지)가 없다면 실패로 처리해야 함.
                if not success:
                    log("에러 패턴은 아니지만 타임아웃으로 인해 정상 처리를 신뢰할 수 없어 종료합니다.")
                    sys.exit(1)
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, "w", encoding="utf-8") as out_f:
                    out_f.write(last_response)
                log(f"결과 저장 성공!")
            else:
                log("답변 요소를 찾을 수 없습니다.")
                sys.exit(1)
                
        except Exception as e:
            log(f"제어 중 오류: {str(e)}")
            if check_for_soft_ban(page):
                sys.exit(43)
            sys.exit(1)
            
        browser.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gemini Web Fallback via Patchright")
    parser.add_argument("-p", "--prompt", required=True, help="Prompt file path")
    parser.add_argument("-v", "--video", required=True, help="Video segment file path")
    parser.add_argument("-o", "--output", required=True, help="Output file path (JSON format string)")
    parser.add_argument("-m", "--model", default=None, help="Target Gemini model (e.g., Pro, Thinking, Fast)")
    
    args = parser.parse_args()
    run_fallback(args.prompt, args.video, args.output, target_model=args.model)
