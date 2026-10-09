// ชนิดข้อมูลหลักของระบบ — ตรงกับตารางใน supabase/migrations
export type Role = 'owner' | 'admin' | 'teacher';

export interface Profile {
  id: string;
  displayName: string | null;
  role: Role;
}

export interface Grade {
  id: string;        // 'P4'
  nameTh: string;
  shortTh: string;   // 'ป.4'
  sort: number;
}

export interface Indicator {
  id: string;
  subjectId: string;
  gradeId: string;
  code: string;      // 'ค 1.1 ป.4/2'
  text: string;
  sort: number;
  assessmentNote: string | null;
}

export interface DifficultyLevel {
  id: number;
  key: string;       // 'easy' | 'medium' | 'hard' | 'challenge' (เป็นข้อมูล ไม่ fix ในโค้ด)
  nameTh: string;
  pLower: number;
  pUpper: number;
}

export interface CoverageCell {
  indicatorId: string;
  difficultyId: number;
  ready: number;
  draft: number;
  needsFix: number;
}

export interface Settings {
  [key: string]: unknown;
}
