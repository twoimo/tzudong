import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase.rpc('get_triggers', {});
  console.log('RPC triggers:', error ? error.message : data);
  
  // Query pg_trigger directly using postgres REST if allowed, or just let's see if we can see rows
  const res = await supabase.from('restaurants').select('id').limit(1);
  console.log('Rest:', res.error ? res.error.message : 'OK');
}
check();
