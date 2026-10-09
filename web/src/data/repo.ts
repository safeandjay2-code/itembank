// ชั้นเข้าถึงข้อมูล (Repository) — หน้าจอทุกหน้าคุยกับ interface นี้เท่านั้น
// เปลี่ยนผู้ให้บริการฐานข้อมูลได้โดยเขียน implementation ใหม่ ไม่ต้องแก้หน้าจอ (SPEC §3.1, §3.10)
import type { CoverageCell, DifficultyLevel, Grade, Indicator, Profile, Settings } from '../core/types';

export interface AuthState {
  signedIn: boolean;
  email: string | null;
}

export interface Repo {
  readonly mode: 'supabase' | 'memory';
  getAuth(): Promise<AuthState>;
  onAuthChange(cb: (s: AuthState) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  getProfile(): Promise<Profile | null>;
  getGrades(): Promise<Grade[]>;
  getIndicators(subjectId: string): Promise<Indicator[]>;
  getDifficultyLevels(): Promise<DifficultyLevel[]>;
  getCoverage(subjectId: string): Promise<CoverageCell[]>;
  getSettings(): Promise<Settings>;
}
