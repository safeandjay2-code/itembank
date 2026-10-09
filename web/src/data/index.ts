import type { Repo } from './repo';
import { MemoryRepo } from './memoryRepo';
import { SupabaseRepo } from './supabaseRepo';

// เลือกแหล่งข้อมูลจากค่าตั้งใน .env  (VITE_DATA_MODE=memory สำหรับโหมดสาธิต/ทดสอบ)
function createRepo(): Repo {
  const env = import.meta.env;
  if (env.VITE_DATA_MODE === 'memory' || !env.VITE_SUPABASE_URL) return new MemoryRepo();
  return new SupabaseRepo(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY ?? '');
}

export const repo: Repo = createRepo();
