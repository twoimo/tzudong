export const KR_KEYWORD_TRANSLATIONS: Record<string, string> = {
  ramen: '라면',
  udon: '우동',
  tofu: '두부',
  chicken: '치킨',
  fried: '후라이드',
  kimbap: '김밥',
  bibimbap: '비빔밥',
  tteokbokki: '떡볶이',
  bulgogi: '불고기',
  samgyeopsal: '삼겹살',
  pork: '돼지고기',
  beef: '쇠고기',
  sausage: '소시지',
  ramenbroth: '라멘 육수',
  soup: '국물',
  stew: '찌개',
  jjigae: '찌개',
  bibim: '비빔',
  pizza: '피자',
  pasta: '파스타',
  noodles: '국수',
  bread: '빵',
  salad: '샐러드',
  rice: '밥',
  dessert: '디저트',
  coffee: '커피',
  latte: '카페 라떼',
  cake: '케이크',
  brunch: '브런치',
  burger: '버거',
  sandwich: '샌드위치',
  steak: '스테이크',
  fish: '생선',
  seafood: '해산물',
  chickenfeet: '닭발',
  jajang: '짜장',
  jjajang: '짜장',
  friedrice: '볶음밥',
  tofu_soup: '순두부찌개',
  kimchi: '김치',
  galbi: '갈비',
  galbitang: '갈비탕',
  jjambbong: '짬뽕',
  naengmyeon: '냉면',
  doener: '도넛',
  drink: '음료',
  drinkkorea: '음료',
  noodlescold: '냉국수',
};

export function toKoreanKeywordLabel(keyword: string): string {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return keyword;

  const direct = KR_KEYWORD_TRANSLATIONS[normalized];
  if (direct) {
    if (normalized !== direct) {
      return `${direct} (${keyword})`;
    }
    return direct;
  }

  if (/[가-힣]/.test(keyword)) return keyword;

  const tokens = normalized.split(/\s+/);
  const localized = tokens.map((token) => {
    const normalizedToken = token.replace(/[^a-z0-9_]/g, '');
    return KR_KEYWORD_TRANSLATIONS[normalizedToken] ?? token;
  });

  const fallback = localized.join(' ').trim();
  if (fallback === normalized) return keyword;

  return `${fallback} (${keyword})`;
}

export function toKoreanKeywordList(keywords: readonly string[]): string[] {
  return keywords.map((keyword) => toKoreanKeywordLabel(keyword));
}
