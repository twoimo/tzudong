import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

type DuplicateRow = {
  id: string;
  name: string | null;
  trace_id: string | null;
  created_at: string;
  status: string;
};

async function findDuplicates() {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name:approved_name, trace_id, created_at, status')
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (error) {
    console.error(error);
    return;
  }
  
  const rows = (data ?? []) as DuplicateRow[];
  const names: Record<string, DuplicateRow[]> = {};
  for (const r of rows) {
    const key = `${r.name ?? ''}${r.trace_id ?? ''}`;
    if (!names[key]) names[key] = [];
    names[key].push(r);
  }
  
  for (const k in names) {
    if (names[k].length > 1) {
      console.log('Duplicate found:', k);
      console.log(names[k]);
    }
  }
}

findDuplicates();
