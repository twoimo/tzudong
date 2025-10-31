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

console.log('Total valid restaurants:', restaurants.length);

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
