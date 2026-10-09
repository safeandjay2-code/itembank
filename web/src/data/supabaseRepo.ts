import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Repo, AuthState } from './repo';
import type { CoverageCell, DifficultyLevel, Grade, Indicator, Profile, Settings } from '../core/types';

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export class SupabaseRepo implements Repo {
  readonly mode = 'supabase' as const;
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } });
  }

  async getAuth(): Promise<AuthState> {
    const { data } = await this.sb.auth.getSession();
    return { signedIn: !!data.session, email: data.session?.user.email ?? null };
  }

  onAuthChange(cb: (s: AuthState) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, session) =>
      cb({ signedIn: !!session, email: session?.user.email ?? null }));
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials'
      ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : error.message);
  }

  async signInWithGoogle() {
    // กลับมาที่หน้าเดิมของเว็บ (รองรับการโฮสต์ในโฟลเดอร์ย่อย เช่น GitHub Pages)
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw new Error(error.message);
  }

  async signOut() { await this.sb.auth.signOut(); }

  async getProfile(): Promise<Profile | null> {
    const { data: u } = await this.sb.auth.getUser();
    if (!u.user) return null;
    const row = must(await this.sb.from('profiles').select('id,display_name,role').eq('id', u.user.id).maybeSingle());
    if (!row) return null;
    const r = row as { id: string; display_name: string | null; role: Profile['role'] };
    return { id: r.id, displayName: r.display_name, role: r.role };
  }

  async getGrades(): Promise<Grade[]> {
    const rows = must(await this.sb.from('grades').select('*').order('sort')) as any[];
    return rows.map((g) => ({ id: g.id, nameTh: g.name_th, shortTh: g.short_th, sort: g.sort }));
  }

  async getIndicators(subjectId: string): Promise<Indicator[]> {
    const rows = must(await this.sb.from('indicators').select('*')
      .eq('subject_id', subjectId).eq('kind', 'terminal').eq('active', true)
      .order('grade_id').order('sort')) as any[];
    return rows.map((i) => ({ id: i.id, subjectId: i.subject_id, gradeId: i.grade_id, code: i.code,
      text: i.text, sort: i.sort, assessmentNote: i.assessment_note }));
  }

  async getDifficultyLevels(): Promise<DifficultyLevel[]> {
    const rows = must(await this.sb.from('difficulty_levels').select('*').order('id')) as any[];
    return rows.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: +d.p_lower, pUpper: +d.p_upper }));
  }

  async getCoverage(subjectId: string): Promise<CoverageCell[]> {
    const rows = must(await this.sb.from('bank_coverage').select('*').eq('subject_id', subjectId)) as any[];
    return rows.map((c) => ({ indicatorId: c.indicator_id, difficultyId: c.difficulty_id,
      ready: c.ready_count, draft: c.draft_count, needsFix: c.needs_fix_count }));
  }

  async getSettings(): Promise<Settings> {
    const rows = must(await this.sb.from('app_settings').select('key,value')) as any[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
