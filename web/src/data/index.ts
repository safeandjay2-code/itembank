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

// โหมดสาธิต: เครื่องมือให้ชุดทดสอบหน้าเว็บจำลองเวลาผ่านไป และใส่ผลตรวจโดยไม่ต้องถ่ายภาพ (ไม่มีในเว็บจริง)
if (repo instanceof MemoryRepo && typeof window !== 'undefined') {
  const mem = repo;
  (window as any).__itembankDemo = {
    ageExam: (id: string, days: number) => mem.debugAgeExam(id, days),
    addStats: (itemCode: string, rounds: Array<{ n: number; nCorrect: number; r: number | null; gradeId?: string }>) => mem.debugAddStats(itemCode, rounds),
    getExam: (id: string) => mem.getExam(id),
    saveScan: (examId: string, seatNo: number, setNo: number, answers: Array<number | null | 'multi'>, ambiguous: number[] = []) =>
      mem.saveScan({ examId, seatNo, setNo, answers: answers as any, ambiguous, source: 'manual', replace: true }),
  };
}
