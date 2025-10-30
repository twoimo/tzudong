import fs from 'fs';

function analyzeCoordinates() {
  const lines = fs.readFileSync('tzuyang_restaurant_results.jsonl', 'utf8').split('\n').filter(line => line.trim());
  let nullCoordinates = [];
  let totalRecords = 0;

  lines.forEach((line, index) => {
    try {
      const data = JSON.parse(line);
      const restaurants = data.restaurants || [];

      restaurants.forEach((restaurant, restIndex) => {
        totalRecords++;
        if ((restaurant.lat === null || restaurant.lng === null) && restaurant.address) {
          nullCoordinates.push({
            line: index + 1,
            youtube_link: data.youtube_link,
            name: restaurant.name,
            address: restaurant.address
          });
        }
      });
    } catch (e) {
      console.error('Parse error at line', index + 1, e.message);
    }
  });

  console.log(`총 레코드 수: ${totalRecords}`);
  console.log(`좌표가 없는 레코드 수: ${nullCoordinates.length}`);
  console.log('\n좌표가 없는 레코드들:');

  nullCoordinates.forEach((item, index) => {
    console.log(`${index + 1}. Line ${item.line}: ${item.address}`);
    console.log(`   이름: ${item.name || '이름 없음'}`);
    console.log(`   유튜브: ${item.youtube_link}`);
    console.log('');
  });

  return nullCoordinates;
}

analyzeCoordinates();
