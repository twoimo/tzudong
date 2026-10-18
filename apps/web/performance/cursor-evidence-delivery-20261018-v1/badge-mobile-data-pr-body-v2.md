옵트인 3D 배지가 저사양 및 성능 정보가 불확실한 모바일에서 무거운 모듈·WebGL·RAF를 시작하던 경로를 수정합니다. 모바일/터치 기기는 유효한 메모리 정보가 기존 HIGH 하드웨어 티어를 만족할 때만 3D를 열고, 그 외에는 같은 닫기·Escape·포커스 복귀가 있는 가벼운 정적 대화상자를 사용합니다. lowPower 인자는 타입상 필수입니다.

최종 develop 3967549ed9c6c00902e72159e4a2014f178b0def의 tree77fa0dabf8d22ba490bf1998dc7913a4720e6089는 소스 PR #3318 후보3ecf69e63365e3df5aa9d434b990e35cff1cf263와 동일합니다. 해당 소스의 Ubuntu npm/Bun, Windows npm/Bun, JS/TS CodeQL, production build 및 필수 검사가 통과했습니다. 변경되지 않은 Swift 분석은 별도로 계속 추적합니다. 기존 data 이력이 조상에 포함됩니다.

검증: 관련 unit15/68assertions, lint, TS parity0, production build/CSS, offline production Chromium3/3. 실제 구성요소의 합성 navigator10종·각3종속 반복에서 문제 프로필6종의 컨텍스트3→0, 추가 엔진 요청1→0을 확인했고 정상/모션 감소/접근성/해제를 유지했습니다. 물리기기·전체 앱 메모리·field 성과는 아닙니다. 강력한 기기라도 모바일/터치에서 메모리 API가 없으면 정적 실험 미리보기가 나오는 보수적 trade-off가 있습니다. 전역 지도 티어·프리셋은 그대로입니다.

공개 schema2는 unpublished/빈 entries이고 실험3D는 기본 꺼짐입니다. 임의 등급·비공개 shadow·DB/Storage/DNS 변경은 포함하지 않습니다. #3311 승격과 정확한 main SHA 운영 배포·실제 URL 검증은 별도 확인합니다.
