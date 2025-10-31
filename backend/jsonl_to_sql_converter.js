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
sql += 'INSERT INTO public.restaurants (name, address, phone, category, youtube_link, lat, lng, ai_rating, visit_count, jjyang_visit_count) VALUES\n';

restaurants.forEach((restaurant, index) => {
  const name = restaurant.name.replace(/'/g, "''");
  const address = restaurant.address.replace(/'/g, "''");
  const phone = restaurant.phone;
  const category = restaurant.category ? `ARRAY['${restaurant.category}']` : 'ARRAY[]';
  const youtube_link = restaurant.youtube_link;
  const lat = restaurant.lat;
  const lng = restaurant.lng;

  sql += `('${name}', '${address}', '${phone}', ${category}, '${youtube_link}', ${lat}, ${lng}, 10.0, 0, 1)`;
  sql += index < restaurants.length - 1 ? ',\n' : ';\n';
});

fs.writeFileSync('20251023_insert_restaurant_data_new.sql', sql);
console.log('SQL file generated successfully');
