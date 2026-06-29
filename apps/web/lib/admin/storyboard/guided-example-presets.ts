import type { StoryboardTone } from './types';

export type StoryboardGuidedExamplePreset = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  sourceLimit: number;
  segmentCount: number;
};

export const STORYBOARD_GUIDED_EXAMPLE_PROMPT =
  '매운 짜장라면 먹방을 좋은 흐름에 맞춰 10컷 안팎의 스토리보드로 만들어줘. 가게 앞 인트로와 주문 맥락으로 시작하고, 조리 기대감, 첫 입, ASMR 질감, 소스 조합, 클라이맥스 한상, 완식, 맛 평가, 다음 영상 기대감까지 이어지게 구성해줘.';

export const STORYBOARD_GUIDED_EXAMPLE_PRESETS: StoryboardGuidedExamplePreset[] = [
  {
    id: 'seafood-feast',
    label: '킹크랩 해산물 한상',
    description: '수산시장 도입부터 게살, 회, 매운탕까지 이어지는 고급 한상',
    prompt:
      '킹크랩과 회, 매운탕까지 이어지는 해산물 한상 먹방을 11컷 스토리보드로 만들어줘. 수산시장 기대감, 손질 장면, 첫 입, 게살 발라내는 디테일, 매운탕 클라이맥스, 맛 평가, 다음 영상 예고까지 자연스럽게 이어지게 구성해줘.',
    tone: 'documentary',
    targetLengthMinutes: 16,
    sourceLimit: 90,
    segmentCount: 11,
  },
  {
    id: 'night-market-spicy',
    label: '야시장 매운 분식',
    description: '떡볶이, 튀김, 순대, 어묵을 빠르게 몰아치는 야시장 흐름',
    prompt:
      '야시장 매운 분식 먹방을 10컷 스토리보드로 만들어줘. 붉은 떡볶이 소스, 튀김 바삭한 소리, 순대와 어묵 조합, 매운맛 리액션, 사람 많은 골목 분위기, 완식 후 다음 코스 기대감까지 보여줘.',
    tone: 'energetic',
    targetLengthMinutes: 13,
    sourceLimit: 80,
    segmentCount: 10,
  },
  {
    id: 'dessert-cafe-course',
    label: '디저트 카페 코스',
    description: '빙수, 케이크, 크림 단면을 부드러운 리액션으로 연결',
    prompt:
      '딸기빙수와 케이크를 중심으로 한 디저트 카페 먹방을 9컷 스토리보드로 만들어줘. 카페 입장, 쇼케이스 선택, 크림과 과일 클로즈업, 첫 숟가락, 케이크 단면, 달콤한 리액션, 마무리 평가까지 부드럽게 이어줘.',
    tone: 'comfort',
    targetLengthMinutes: 12,
    sourceLimit: 70,
    segmentCount: 9,
  },
  {
    id: 'pork-grill-table',
    label: '삼겹살 불판 한상',
    description: '불판 예열, 굽는 소리, 쌈 조합, 찌개까지 이어지는 고기 코스',
    prompt:
      '삼겹살과 갈비가 함께 나오는 고기 구이 먹방을 12컷 스토리보드로 만들어줘. 가게 앞 도입, 불판 예열, 고기 굽는 소리, 쌈 조합, 육즙 단면, 된장찌개 연결, 클라이맥스 한상, 완식 평가까지 구성해줘.',
    tone: 'warm',
    targetLengthMinutes: 18,
    sourceLimit: 95,
    segmentCount: 12,
  },
  {
    id: 'soup-noodle-comfort',
    label: '국밥과 칼국수 국물',
    description: '김 오른 국물, 면 들어 올림, 반찬 조합을 따뜻하게 구성',
    prompt:
      '뜨끈한 국밥과 칼국수를 중심으로 한 면·국물 먹방을 10컷 스토리보드로 만들어줘. 김이 오르는 첫 장면, 국물 한 숟가락, 면 들어 올리는 컷, 반찬 조합, 속이 풀리는 리액션, 완식 후 여운까지 담아줘.',
    tone: 'warm',
    targetLengthMinutes: 15,
    sourceLimit: 80,
    segmentCount: 10,
  },
  {
    id: 'convenience-ramen-mix',
    label: '편의점 라면 조합',
    description: '편의점 재료 조합, 첫 입, 소스 변주, 다음 메뉴 예고까지 압축',
    prompt: STORYBOARD_GUIDED_EXAMPLE_PROMPT,
    tone: 'energetic',
    targetLengthMinutes: 14,
    sourceLimit: 80,
    segmentCount: 10,
  },
  {
    id: 'market-fried-chicken',
    label: '시장 통닭 튀김',
    description: '튀김 소리, 골목 활기, 한입 리액션을 선명하게 보여주는 시장 먹방',
    prompt:
      '전통시장 통닭과 모둠 튀김 먹방을 10컷 스토리보드로 만들어줘. 시장 골목 도입, 튀김 기름 소리, 바삭한 단면, 소스 찍는 장면, 맥주 없이도 잘 맞는 조합, 사람 많은 분위기, 완식 평가까지 빠르게 이어줘.',
    tone: 'energetic',
    targetLengthMinutes: 13,
    sourceLimit: 80,
    segmentCount: 10,
  },
  {
    id: 'late-night-store-snack',
    label: '새벽 편의점 야식',
    description: '늦은 밤 매장 조명, 컵라면, 삼각김밥, 디저트 후식을 한 흐름으로',
    prompt:
      '새벽 편의점 야식 루틴을 9컷 스토리보드로 만들어줘. 늦은 밤 편의점 입장, 컵라면 조리, 삼각김밥 조합, 음료 선택, 첫 입 리액션, 조용한 새벽 분위기, 디저트 후식, 다음 야식 예고까지 구성해줘.',
    tone: 'comfort',
    targetLengthMinutes: 11,
    sourceLimit: 70,
    segmentCount: 9,
  },
  {
    id: 'cheese-budae-ramen',
    label: '치즈 부대찌개 라면',
    description: '햄, 라면사리, 치즈 늘어남, 얼큰한 국물 리액션 중심',
    prompt:
      '치즈 부대찌개 라면 먹방을 10컷 스토리보드로 만들어줘. 가게 앞 도입, 끓는 냄비, 햄과 소시지 클로즈업, 라면사리 들어 올림, 치즈 늘어나는 장면, 얼큰한 국물 리액션, 밥 말기, 완식 평가까지 구성해줘.',
    tone: 'energetic',
    targetLengthMinutes: 14,
    sourceLimit: 80,
    segmentCount: 10,
  },
  {
    id: 'sushi-omakase-closeup',
    label: '초밥 오마카세 클로즈업',
    description: '쥐는 손동작, 광택 있는 생선, 한입 집중감을 차분하게 구성',
    prompt:
      '초밥 오마카세 먹방을 10컷 스토리보드로 만들어줘. 카운터 도입, 셰프가 초밥을 쥐는 손동작, 생선 광택 클로즈업, 간장 찍는 장면, 첫 입 집중감, 코스별 리액션, 마지막 한 점과 평가까지 차분하게 이어줘.',
    tone: 'documentary',
    targetLengthMinutes: 15,
    sourceLimit: 85,
    segmentCount: 10,
  },
];

export const STORYBOARD_GUIDED_EXAMPLE_GRID_COUNT = 10;
export const STORYBOARD_GUIDED_EXAMPLE_GRID_PRESETS =
  STORYBOARD_GUIDED_EXAMPLE_PRESETS.slice(
    0,
    STORYBOARD_GUIDED_EXAMPLE_GRID_COUNT,
  );
export const STORYBOARD_GUIDED_EXAMPLE_STARTER_COUNT = 10;
export const STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS =
  STORYBOARD_GUIDED_EXAMPLE_GRID_PRESETS.slice(
    0,
    STORYBOARD_GUIDED_EXAMPLE_STARTER_COUNT,
  );
