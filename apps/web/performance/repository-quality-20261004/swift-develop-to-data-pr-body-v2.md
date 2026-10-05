기존 OCR을 위한 Swift package와 상대 링크 진입점을 develop에서 data로 정상 보호 규칙에 따라 승격합니다. 기존 5개 언어 스캔, OCR 로직과 Python 호출 경로, web 소스는 유지합니다.

검증: PR #3132의 전체 검사 통과, Swift 6.4/macOS SDK 27의 fresh compile/link 성공. main 승격 후 기존 설정을 유지하면서 Swift 스캔을 추가하고 실제 분석 결과를 확인합니다.
