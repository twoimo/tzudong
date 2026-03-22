import sys
import time
import os
import json
from patchright.sync_api import sync_playwright

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def main():
    cookie_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "gemini_cookies.json"))
    
    log("Gemini 웹 브라우저 자동 로그인 및 쿠키 추출기")
    log(f"쿠키 저장 경로: {cookie_file}")
    
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
                with open(cookie_file, "r", encoding="utf-8") as f:
                    cookies = json.load(f)
                    context.add_cookies(cookies)
            except Exception as e:
                log(f"기존 쿠키 로드 실패: {e}")

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
            
            # data 폴더가 없으면 생성
            os.makedirs(os.path.dirname(cookie_file), exist_ok=True)
            
            with open(cookie_file, "w", encoding="utf-8") as f:
                json.dump(new_cookies, f, indent=2)
                
            log(f"✅ 인증 쿠키 추출 및 저장 완료: {cookie_file}")
            log("브라우저를 닫습니다. 이제 폴백 스크립트가 이 쿠키를 사용하여 백그라운드에서도 동작할 수 있습니다.")
            time.sleep(3)
            
        except Exception as e:
            log(f"❌ 화면 인식 실패 또는 시간 초과: {str(e)}")
            log("로그인을 완료하지 못했거나, 화면 UI가 변경되었을 수 있습니다.")
            sys.exit(1)
            
        browser.close()

if __name__ == "__main__":
    main()
