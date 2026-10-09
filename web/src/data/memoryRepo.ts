// ข้อมูลจำลองในหน่วยความจำ — ใช้สำหรับโหมดสาธิตและการทดสอบอัตโนมัติ (ไม่ต้องต่อเซิร์ฟเวอร์)
// ใช้ข้อมูลหลักสูตรชุดเดียวกับ seed ของฐานข้อมูลจริง
import curriculum from '../../../data/curriculum/math_2560_terminal_p4_p6.json';
import levels from '../../../data/levels.json';
import settingsList from '../../../data/settings.default.json';
import type { Repo, AuthState } from './repo';
import type { CoverageCell, DifficultyLevel, Grade, Indicator, Profile, Settings } from '../core/types';

export const DEMO_EMAIL = 'demo@itembank.local';
export const DEMO_PASSWORD = 'demo1234';

export function buildIndicators(): Indicator[] {
  const perGrade: Record<string, number> = {};
  return curriculum.indicators.map((ind: any) => {
    perGrade[ind.grade] = (perGrade[ind.grade] ?? 0) + 1;
    const sort = perGrade[ind.grade];
    return {
      id: `${curriculum.subject.id}-${curriculum.curriculum_version}-${ind.grade}-${String(sort).padStart(2, '0')}`,
      subjectId: curriculum.subject.id, gradeId: ind.grade, code: ind.code, text: ind.text,
      sort, assessmentNote: ind.assessment_note ?? null,
    };
  });
}

export class MemoryRepo implements Repo {
  readonly mode = 'memory' as const;
  private auth: AuthState = { signedIn: false, email: null };
  private listeners = new Set<(s: AuthState) => void>();
  private indicators = buildIndicators();
  /** จำนวนข้อหุ่นต่อช่อง (ตัวชี้วัด × ระดับ) — เหมือน seed S900 */
  constructor(private samplePerCell = 2) {}

  async getAuth() { return this.auth; }
  onAuthChange(cb: (s: AuthState) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit() { this.listeners.forEach((l) => l(this.auth)); }

  async signIn(email: string, password: string) {
    if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    this.auth = { signedIn: true, email };
    this.emit();
  }
  async signOut() { this.auth = { signedIn: false, email: null }; this.emit(); }

  async getProfile(): Promise<Profile | null> {
    return this.auth.signedIn ? { id: 'demo', displayName: 'ผู้ใช้สาธิต', role: 'owner' } : null;
  }
  async getGrades(): Promise<Grade[]> {
    return curriculum.grades.map((g: any) => ({ id: g.id, nameTh: g.name_th, shortTh: g.short_th, sort: g.sort }));
  }
  async getIndicators(subjectId: string) { return this.indicators.filter((i) => i.subjectId === subjectId); }
  async getDifficultyLevels(): Promise<DifficultyLevel[]> {
    return levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));
  }
  async getCoverage(subjectId: string): Promise<CoverageCell[]> {
    const cells: CoverageCell[] = [];
    for (const ind of await this.getIndicators(subjectId))
      for (const d of levels.difficulty)
        cells.push({ indicatorId: ind.id, difficultyId: d.id, ready: this.samplePerCell, draft: 0, needsFix: 0 });
    return cells;
  }
  async getSettings(): Promise<Settings> {
    return Object.fromEntries(settingsList.map((s) => [s.key, s.value]));
  }
}
