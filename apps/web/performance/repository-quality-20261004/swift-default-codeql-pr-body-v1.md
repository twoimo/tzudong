GitHub 기본 Swift CodeQL 자동 빌드가 루트에서 Xcode 프로젝트나 Swift package를 찾지 못해 실제 OCR 소스를 분석하지 못했습니다. 루트에 의존성이 없는 실행 package를 추가하고, 기존 `03-2-visual-ocr.swift`를 상대 링크 `main.swift`로 선택하여 컴파일 진입점을 제공합니다. OCR 로직과 Python 호출 경로는 유지합니다.

검증: Swift 6.4/macOS SDK 27의 fresh package describe 및 실제 컴파일·링크 성공, 링크 대상과 원본 바이트 동일, Git mode 120000 확인, diff check 통과. 기본 CodeQL 설정과 다른 언어 스캔은 변경하지 않았으며, main 승격 후 새 Swift 분석 결과는 별도로 확인합니다.
