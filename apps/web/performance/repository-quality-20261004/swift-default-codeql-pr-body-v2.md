이전 기본 Swift CodeQL 자동 빌드는 루트에서 Xcode 프로젝트나 Swift package를 찾지 못해 실패했고, 현재 기본 설정의 실제 스캔 대상 5개 언어에는 Swift가 빠져 있습니다. 루트에 의존성이 없는 실행 package를 추가하고 기존 `03-2-visual-ocr.swift`를 상대 링크 `main.swift`로 선택하여 실제 OCR 소스의 컴파일 진입점을 제공합니다. OCR 로직과 Python 호출 경로는 유지합니다.

검증: 최신 develop 기준 Swift 6.4/macOS SDK 27의 fresh package describe 및 실제 컴파일·링크 성공, 링크와 원본 바이트 동일, Git mode 120000 확인, diff check 통과. 설정 변경과 스캐너 활성화는 본 source patch와 별도로, main 승격 후 기존 5개 언어·query suite·standard runner를 유지하면서 Swift를 추가하고 실제 분석 결과를 읽어 검증합니다. 현재 source/CI만으로 hosted Swift 스캔 성공을 주장하지 않습니다.
