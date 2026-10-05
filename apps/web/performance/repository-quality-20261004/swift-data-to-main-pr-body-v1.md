검증된 Swift OCR package와 상대 링크 진입점을 data에서 main으로 정상 보호 규칙에 따라 승격합니다. OCR 원본·Python 호출 경로와 apps/web 소스는 유지합니다.

PR #3132 및 #3133 전체 검사 통과, Swift 6.4/macOS SDK 27에서 fresh compile/link와 링크 원본 바이트 동일 확인. 현재 운영 rollback은 b90154e22e6b4ba089275c7ae6d53e7274feae98 / dpl_FNch76WAu4GmrQ1jx5V1WSEvdfFE이며, 최종 승격 직전 독립 alias를 다시 확인합니다. 승격 후 정확한 main SHA guard·READY·www readback 및 기존 스캔 대상을 보존한 새 Swift 분석을 별도로 확인합니다.
