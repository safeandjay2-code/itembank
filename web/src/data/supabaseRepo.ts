import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Repo, AuthState } from './repo';
import type {
  BankExport, CognitiveLevel, CoverageCell, DifficultyLevel, Grade, ImportReport, Indicator, ItemDetail, ItemFilter,
  ItemPage, ItemStatus, ItemSummary, ItemVersion, Profile, SaveItemInput, Settings,
} from '../core/types';

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

  // ---------- คลังข้อสอบ ----------
  async getCognitiveLevels(): Promise<CognitiveLevel[]> {
    const rows = must(await this.sb.from('cognitive_levels').select('*').order('id')) as any[];
    return rows.map((c) => ({ id: c.id, key: c.key, nameTh: c.name_th }));
  }

  async listItems(subjectId: string, f: ItemFilter): Promise<ItemPage> {
    const size = f.pageSize ?? 30, page = f.page ?? 0;
    let q = this.sb.from('bank_item_list').select('*', { count: 'exact' }).eq('subject_id', subjectId);
    if (f.gradeId) q = q.eq('grade_id', f.gradeId);
    if (f.indicatorId) q = q.eq('indicator_id', f.indicatorId);
    if (f.difficulty) q = q.eq('current_difficulty', f.difficulty);
    if (f.status) q = q.eq('status', f.status);
    if (f.cognitive) q = q.eq('cognitive_level', f.cognitive);
    if (!f.includeSample) q = q.eq('is_sample', false);
    const text = (f.q ?? '').replace(/[,()*%\\]/g, ' ').trim();
    if (text) q = q.or(`stem.ilike.*${text}*,item_code.ilike.*${text}*,subtopic.ilike.*${text}*`);
    q = q.order('grade_id').order('indicator_sort').order('current_difficulty').order('item_code')
      .range(page * size, page * size + size - 1);
    const res = await q;
    if (res.error) throw new Error(res.error.message);
    return { items: (res.data as any[]).map(toSummary), total: res.count ?? 0 };
  }

  async getItem(id: string): Promise<ItemDetail | null> {
    const row = must(await this.sb.from('bank_item_list').select('*').eq('id', id).maybeSingle()) as any;
    if (!row) return null;
    const [vers, evs, used] = await Promise.all([
      this.sb.from('item_versions').select('*').eq('item_id', id).order('version'),
      this.sb.from('item_events').select('event_type,payload,at').eq('item_id', id).order('id'),
      this.sb.from('exam_items').select('exam_id', { count: 'exact', head: true }).eq('item_id', id),
    ]);
    const versions: ItemVersion[] = (must(vers) as any[]).map((v) => ({ version: v.version, content: v.content, answer: v.answer,
      qa: v.qa ?? null, changeNote: v.change_note, createdAt: v.created_at }));
    const events = (must(evs) as any[]).map((e) => ({ type: e.event_type, payload: e.payload ?? {}, at: e.at }));
    return { ...toSummary(row), versions, events, usedInExams: used.count ?? 0 };
  }

  async saveItem(input: SaveItemInput): Promise<string> {
    const d = input.draft;
    const p_item = {
      id: input.id ?? null, indicator_id: d.indicatorId, item_type: d.itemType, cognitive_level: d.cognitiveLevel,
      est_difficulty: d.estDifficulty, no_shuffle: d.noShuffle, tags: d.tags, subtopic: d.subtopic,
      content: d.content, answer: d.answer, qa: input.qa,
    };
    const { data, error } = await this.sb.rpc('bank_save_item', { p_item, p_mode: input.mode, p_change_note: input.changeNote ?? null });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async setItemStatus(id: string, status: ItemStatus, note?: string) {
    const { error } = await this.sb.rpc('bank_set_status', { p_id: id, p_status: status, p_note: note ?? null });
    if (error) throw new Error(error.message);
  }

  async deleteItem(id: string) {
    const { error } = await this.sb.rpc('bank_delete_item', { p_id: id });
    if (error) throw new Error(error.message);
  }

  async exportBank(subjectId: string, includeSamples: boolean): Promise<BankExport> {
    const { data, error } = await this.sb.rpc('bank_export', { p_subject_id: subjectId, p_include_samples: includeSamples });
    if (error) throw new Error(error.message);
    return data as BankExport;
  }

  async importBank(payload: unknown, dryRun: boolean): Promise<ImportReport> {
    const { data, error } = await this.sb.rpc('bank_import', { p_data: payload, p_dry_run: dryRun });
    if (error) throw new Error(error.message);
    const r = data as any;
    return {
      dryRun: r.dry_run, inserted: r.inserted,
      skipped: (r.skipped ?? []).map((x: any) => ({ index: x.index, itemCode: x.item_code, reason: x.reason })),
      errors: (r.errors ?? []).map((x: any) => ({ index: x.index, itemCode: x.item_code ?? null, message: x.message })),
    };
  }
}

function toSummary(r: any): ItemSummary {
  return {
    id: r.id, itemCode: r.item_code, indicatorId: r.indicator_id, gradeId: r.grade_id, itemType: r.item_type,
    cognitiveLevel: r.cognitive_level, estDifficulty: r.est_difficulty, currentDifficulty: r.current_difficulty,
    status: r.status, currentVersion: r.current_version, noShuffle: r.no_shuffle, isSample: r.is_sample,
    tags: r.tags ?? [], subtopic: r.subtopic, stem: r.stem ?? '', hasFigure: !!r.has_figure, qaPassed: r.qa_passed,
    n: r.n ?? 0, p: r.p === null || r.p === undefined ? null : Number(r.p), r: r.r === null || r.r === undefined ? null : Number(r.r),
    updatedAt: r.updated_at,
  };
}
