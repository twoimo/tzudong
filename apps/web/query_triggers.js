const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];
const supabase = createClient(url, key);

supabase.rpc('get_triggers').then(res => {
  if (res.error) console.error("RPC Error:", res.error.message);
  else console.log("Triggers:", res.data);
});
