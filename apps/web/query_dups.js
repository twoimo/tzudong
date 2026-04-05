const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(url, key);

supabase.from('restaurants').select('id, approved_name, trace_id, status').then(res => {
  if (res.error) {
    console.error(res.error);
    return;
  }
  const data = res.data;
  const map = {};
  for (const r of data) {
    const k = r.approved_name + '|' + r.trace_id;
    if (!map[k]) map[k] = [];
    map[k].push(r);
  }
  for (const k in map) {
    if (map[k].length > 1) {
      console.log('DUPLICATE:', k);
      console.log(map[k]);
    }
  }
  console.log('Total rows:', data.length);
});
