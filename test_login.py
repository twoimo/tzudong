import sys
import time
import logging

sys.path.insert(0, 'backend/restaurant-crawling/scripts')
import gemini_scrapling_fallback as g

def test():
    with g._create_camoufox(headless=True) as context:
        g.load_cookie_backup(context)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto('https://gemini.google.com/', wait_until="domcontentloaded", timeout=30000)
        time.sleep(5)
        print("Logged in:", g.is_logged_in(page, debug=True))

if __name__ == "__main__":
    test()