import fs from 'fs';

const data = fs.readFileSync('tzuyang_restaurant_results.jsonl', 'utf8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => JSON.parse(line));

let restaurants = [];
data.forEach(item => {
  item.restaurants.forEach(restaurant => {
    if (restaurant.name && restaurant.phone && restaurant.address && restaurant.lat && restaurant.lng) {
      restaurants.push(restaurant);
    }
  });
});

console.log('Total valid restaurants before deduplication:', restaurants.length);

// 주소 정규화 함수
function normalizeAddress(address) {
  return address
    .replace(/전북\s+/g, '전북특별자치도 ')  // 전북 -> 전북특별자치도
    .replace(/강원\s+/g, '강원특별자치도 ')  // 강원 -> 강원특별자치도
    .replace(/충북\s+/g, '충청북도 ')       // 충북 -> 충청북도
    .replace(/충남\s+/g, '충청남도 ')       // 충남 -> 충청남도
    .replace(/전남\s+/g, '전라남도 ')       // 전남 -> 전라남도
    .replace(/경북\s+/g, '경상북도 ')       // 경북 -> 경상북도
    .replace(/경남\s+/g, '경상남도 ')       // 경남 -> 경상남도
    .replace(/제주\s+/g, '제주특별자치도 ') // 제주 -> 제주특별자치도
    .trim();
}

// 더 엄격한 중복 제거 (이름 + 정규화된 주소 + 전화번호 + 좌표)
const seen = new Set();
const uniqueRestaurants = restaurants.filter(restaurant => {
  const normalizedAddress = normalizeAddress(restaurant.address);
  // 이름, 주소, 전화번호, 좌표로 종합 판단
  const key = `${restaurant.name}|${normalizedAddress}|${restaurant.phone}|${restaurant.lat}|${restaurant.lng}`;

  if (seen.has(key)) {
    return false;
  }
  seen.add(key);
  return true;
});

console.log('Total unique restaurants after deduplication:', uniqueRestaurants.length);
console.log('Removed duplicates:', restaurants.length - uniqueRestaurants.length);

// 중복 제거된 데이터를 사용
restaurants = uniqueRestaurants;

// Generate SQL
let sql = '-- Insert restaurant data from 쯔양 YouTube analysis\n';
sql += '-- This migration should run after category column has been converted to TEXT[]\n';
sql += 'INSERT INTO public.restaurants (name, address, phone, category, youtube_link, lat, lng, region, tzuyang_review) VALUES\n';

restaurants.forEach((restaurant, index) => {
  const name = restaurant.name.replace(/'/g, "''");
  const address = restaurant.address.replace(/'/g, "''");
  const phone = restaurant.phone;
  const category = restaurant.category ? `ARRAY['${restaurant.category}']` : 'ARRAY[]';
  const youtube_link = restaurant.youtube_link;
  const lat = restaurant.lat;
  const lng = restaurant.lng;
  const tzuyang_review = restaurant.tzuyang_review ? restaurant.tzuyang_review.replace(/'/g, "''") : '';

  // 주소 기반으로 region 설정 (한국 지역 우선 처리)
  let region = null;

  // 울릉도 (먼저 처리해야 함)
  if (address.includes('울릉군')) {
    region = '울릉도';
  }
  // 욕지도 (먼저 처리해야 함)
  else if (address.includes('욕지')) {
    region = '욕지도';
  }
  // 서울특별시
  else if (address.startsWith('서울특별시') || address.includes('서울 ')) {
    region = '서울특별시';
  }
  // 부산광역시
  else if (address.startsWith('부산광역시') || address.includes('부산 ')) {
    region = '부산광역시';
  }
  // 대구광역시
  else if (address.startsWith('대구광역시') || address.includes('대구 ')) {
    region = '대구광역시';
  }
  // 인천광역시
  else if (address.startsWith('인천광역시') || address.includes('인천 ')) {
    region = '인천광역시';
  }
  // 광주광역시
  else if (address.startsWith('광주광역시')) {
    region = '광주광역시';
  }
  // 대전광역시
  else if (address.startsWith('대전광역시') || address.includes('대전 ')) {
    region = '대전광역시';
  }
  // 울산광역시
  else if (address.startsWith('울산광역시')) {
    region = '울산광역시';
  }
  // 세종특별자치시
  else if (address.startsWith('세종특별자치시')) {
    region = '세종특별자치시';
  }
  // 경기도
  else if (address.startsWith('경기도') || address.includes('경기 ')) {
    region = '경기도';
  }
  // 충청북도
  else if (address.startsWith('충청북도') || address.includes('충북 ')) {
    region = '충청북도';
  }
  // 충청남도
  else if (address.startsWith('충청남도') || address.includes('충남 ')) {
    region = '충청남도';
  }
  // 전라북도
  else if (address.startsWith('전라북도') || address.includes('전북 ')) {
    region = '전라북도';
  }
  // 전북특별자치도
  else if (address.startsWith('전북특별자치도')) {
    region = '전북특별자치도';
  }
  // 전라남도
  else if (address.startsWith('전라남도') || address.includes('전남 ')) {
    region = '전라남도';
  }
  // 경상북도
  else if (address.startsWith('경상북도') || address.includes('경북 ')) {
    region = '경상북도';
  }
  // 경상남도
  else if (address.startsWith('경상남도') || address.includes('경남 ')) {
    region = '경상남도';
  }
  // 강원특별자치도
  else if (address.startsWith('강원특별자치도') || address.includes('강원 ')) {
    region = '강원특별자치도';
  }
  // 제주특별자치도
  else if (address.startsWith('제주특별자치도')) {
    region = '제주특별자치도';
  }
  // 해외 주소
  else if (address.includes('Turkey') || address.includes('Türkiye') || address.includes('Istanbul')) {
    region = '튀르키예';
  } else if (address.includes('Japan') || address.includes('Tokyo') || address.includes('Osaka')) {
    region = '일본';
  } else if (address.includes('Thailand') || address.includes('Bangkok')) {
    region = '태국';
  } else if (address.includes('Indonesia') || address.includes('Jakarta')) {
    region = '인도네시아';
  } else if (address.includes('Hungary') || address.includes('Budapest')) {
    region = '헝가리';
  } else if (address.includes('Australia') || address.includes('Sydney')) {
    region = '오스트레일리아';
  } else if (address.includes('USA') || address.includes('United States') || address.includes('America')) {
    region = '미국';
  }

  const regionValue = region ? `'${region}'` : 'NULL';

  sql += `('${name}', '${address}', '${phone}', ${category}, '${youtube_link}', ${lat}, ${lng}, ${regionValue}, '${tzuyang_review}')`;
  sql += index < restaurants.length - 1 ? ',\n' : ';\n';
});

fs.writeFileSync('20251023_insert_restaurant_data_new.sql', sql);
console.log('SQL file generated successfully');
