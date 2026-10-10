// ข้อมูลจำลองในหน่วยความจำ — ใช้สำหรับโหมดสาธิตและการทดสอบอัตโนมัติ (ไม่ต้องต่อเซิร์ฟเวอร์)
// ใช้ข้อมูลหลักสูตรชุดเดียวกับ seed ของฐานข้อมูลจริง และใช้กฎคลังชุดเดียวกับหน้าจอ (modules/bank/rules.ts)
// พฤติกรรมเลียนแบบ migration 0005 (ฐานข้อมูลจริงมีชุดทดสอบของตัวเองใน tests/db)
import curriculum from '../../../data/curriculum/math_2560_terminal_p4_p6.json';
import levels from '../../../data/levels.json';
import settingsList from '../../../data/settings.default.json';
import type { Repo, AuthState } from './repo';
import type {
  BankExport, CognitiveLevel, CoverageCell, DifficultyLevel, ExamCreateInput, ExamDetail, ExamStatus, ExamSummary, Grade,
  ImportReport, Indicator, ItemAnswer, ItemContent, ItemDetail, ItemEvent, ItemFilter, ItemPage, ItemStatus, ItemSummary,
  ItemVersion, PoolItem, Profile, QaReport, SaveItemInput, ScanAnswer, ScanFlag, ScanResponse, ScanSaveInput, ScanSaveResult, Settings, ClosedSummary, RoundStat,
} from '../core/types';
import { analysisConfigFromSettings, analyze } from '../modules/analysis/analyze';
import { answersEqual, detectWrongSet, scanConfigFromSettings, score } from '../modules/scan/grade';
import { ASSEMBLABLE, classifyEdit, statusAfterSave, statusChangeBlocked } from '../modules/bank/rules';
import { configFromSettings, makeOrdering, seatSet } from '../modules/assembly/assemble';
import { checkCreateInput } from '../modules/assembly/serverRules';
import {
  applyCalibration, calibrationConfigFromSettings, calibStats, decide, type BankHealth, type CalibrationRun, type FlagChange,
  type ItemCalibrationInfo, type LevelMove, type QualityFlag, type Shortfall, type StatRound,
} from '../modules/calibration/calibrate';

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

interface MemItem {
  id: string; itemCode: string; subjectId: string; indicatorId: string; itemType: string;
  cognitiveLevel: number; estDifficulty: number; currentDifficulty: number; status: ItemStatus;
  currentVersion: number; noShuffle: boolean; isSample: boolean; tags: string[]; subtopic: string | null;
  createdAt: string; updatedAt: string;
  versions: ItemVersion[]; events: ItemEvent[];
  stats: Array<StatRound & { optionCounts?: Record<string, number>; recordedAt?: string; fromExam?: boolean }>;
  qualityFlag: QualityFlag | null; qualityFlagAt: string | null;
  moves: Array<{ version: number; from: number; to: number; direction: 'easier' | 'harder'; p: number; n: number; r: number | null; movedAt: string; runId: number }>;
}

interface MemRun extends CalibrationRun { ranAt: string }

interface MemExam {
  id: string; title: string; subjectId: string; gradeId: string; setCount: number; studentCount: number; status: ExamStatus;
  createdAt: string; durationMin: number; rows: ExamCreateInput['rows']; build: ExamCreateInput['build'];
  items: Array<{ itemId: string; version: number; basePosition: number; isAnchor: boolean; indicatorId: string; difficulty: number }>;
  sets: ExamCreateInput['sets'];
  openedAt: string | null; expiresAt: string | null; closedAt: string | null;
  closedSummary: ClosedSummary | null; roundStats: RoundStat[];
}

const clone = <T,>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();

export class MemoryRepo implements Repo {
  readonly mode = 'memory' as const;
  private auth: AuthState = { signedIn: false, email: null };
  private listeners = new Set<(s: AuthState) => void>();
  private indicators = buildIndicators();
  private items: MemItem[] = [];
  private exams: MemExam[] = [];
  private seq = 0;
  private examSeq = 0;
  /** ผลตรวจ: exam id → เลขที่ → ผล */
  private scans = new Map<string, Map<number, ScanResponse>>();
  private runs: MemRun[] = [];

  /** samplePerCell = จำนวนข้อหุ่นต่อช่อง (ตัวชี้วัด × ระดับ) — เหมือน seed S900 */
  constructor(samplePerCell = 2) {
    for (const ind of this.indicators)
      for (const d of levels.difficulty)
        for (let k = 1; k <= samplePerCell; k++) {
          this.items.push(this.makeItem({
            indicatorId: ind.id, cognitiveLevel: 1 + (k % 4), est: d.id, status: 'reviewed', isSample: true,
            content: { stem: `ข้อทดสอบ ${ind.code} ระดับ${d.name_th} #${String(k).padStart(2, '0')}`,
              options: ['ตัวเลือก 1', 'ตัวเลือก 2', 'ตัวเลือก 3', 'ตัวเลือก 4'], figure: null,
              explanation: 'ข้อหุ่นสำหรับทดสอบระบบ', distractor_rationale: [null, null, null, null] },
            answer: { choice: 1 + ((ind.sort + d.id + k) % 4) }, qa: null,
          }));
        }
  }

  private makeItem(a: { indicatorId: string; cognitiveLevel: number; est: number; status: ItemStatus; isSample: boolean;
    content: ItemContent; answer: ItemAnswer; qa: QaReport | null; noShuffle?: boolean; tags?: string[]; subtopic?: string | null;
    note?: string | null; code?: string }): MemItem {
    const t = now();
    this.seq += 1;
    const itemCode = a.code ?? `M-${String(this.seq).padStart(6, '0')}`;
    return {
      id: `item-${itemCode}`, itemCode, subjectId: 'MATH', indicatorId: a.indicatorId, itemType: 'mcq4',
      cognitiveLevel: a.cognitiveLevel, estDifficulty: a.est, currentDifficulty: a.est, status: a.status,
      currentVersion: 1, noShuffle: a.noShuffle ?? false, isSample: a.isSample, tags: a.tags ?? [], subtopic: a.subtopic ?? null,
      createdAt: t, updatedAt: t,
      versions: [{ version: 1, content: clone(a.content), answer: clone(a.answer), qa: a.qa, changeNote: a.note ?? 'สร้างข้อ', createdAt: t }],
      events: [{ type: 'created', payload: { item_code: itemCode, difficulty: a.est, status: a.status }, at: t }],
      stats: [], qualityFlag: null, qualityFlagAt: null, moves: [],
    };
  }

  // ---------- ผู้ใช้ ----------
  async getAuth() { return this.auth; }
  onAuthChange(cb: (s: AuthState) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit() { this.listeners.forEach((l) => l(this.auth)); }

  async signIn(email: string, password: string) {
    if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    this.auth = { signedIn: true, email };
    this.emit();
  }
  async signInWithGoogle(): Promise<void> {
    throw new Error('โหมดสาธิตไม่รองรับการล็อกอินด้วย Google');
  }
  async signOut() { this.auth = { signedIn: false, email: null }; this.emit(); }

  async getProfile(): Promise<Profile | null> {
    return this.auth.signedIn ? { id: 'demo', displayName: 'ผู้ใช้สาธิต', role: 'owner' } : null;
  }

  // ---------- ข้อมูลอ้างอิง ----------
  async getGrades(): Promise<Grade[]> {
    return curriculum.grades.map((g: any) => ({ id: g.id, nameTh: g.name_th, shortTh: g.short_th, sort: g.sort }));
  }
  async getIndicators(subjectId: string) { return this.indicators.filter((i) => i.subjectId === subjectId); }
  async getDifficultyLevels(): Promise<DifficultyLevel[]> {
    return levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));
  }
  async getCognitiveLevels(): Promise<CognitiveLevel[]> {
    return levels.cognitive.map((c) => ({ id: c.id, key: c.key, nameTh: c.name_th }));
  }
  async getCoverage(subjectId: string): Promise<CoverageCell[]> {
    const cells: CoverageCell[] = [];
    for (const ind of await this.getIndicators(subjectId))
      for (const d of levels.difficulty) {
        const mine = this.items.filter((i) => i.indicatorId === ind.id && i.currentDifficulty === d.id);
        cells.push({ indicatorId: ind.id, difficultyId: d.id,
          ready: mine.filter((i) => i.status === 'reviewed' || i.status === 'active').length,
          draft: mine.filter((i) => i.status === 'draft').length,
          needsFix: mine.filter((i) => i.status === 'needs_fix').length });
      }
    return cells;
  }
  async getSettings(): Promise<Settings> {
    return Object.fromEntries(settingsList.map((s) => [s.key, s.value]));
  }

  // ---------- คลังข้อสอบ ----------
  private summary(i: MemItem): ItemSummary {
    const ind = this.indicators.find((x) => x.id === i.indicatorId)!;
    const v = i.versions.find((x) => x.version === i.currentVersion)!;
    const st = i.stats.filter((s) => s.version === i.currentVersion);
    const n = st.reduce((a, s) => a + s.n, 0);
    const nc = st.reduce((a, s) => a + s.nCorrect, 0);
    const rs = st.filter((s) => s.r !== null);
    const rn = rs.reduce((a, s) => a + s.n, 0);
    return {
      id: i.id, itemCode: i.itemCode, indicatorId: i.indicatorId, gradeId: ind.gradeId, itemType: i.itemType,
      cognitiveLevel: i.cognitiveLevel, estDifficulty: i.estDifficulty, currentDifficulty: i.currentDifficulty,
      status: i.status, currentVersion: i.currentVersion, noShuffle: i.noShuffle, isSample: i.isSample, tags: [...i.tags],
      subtopic: i.subtopic, stem: v.content.stem, hasFigure: !!v.content.figure, qaPassed: v.qa ? v.qa.passed : null,
      n, p: n ? Math.round((nc / n) * 1000) / 1000 : null,
      r: rn ? Math.round((rs.reduce((a, s) => a + (s.r ?? 0) * s.n, 0) / rn) * 1000) / 1000 : null,
      updatedAt: i.updatedAt,
      ...this.calibFields(i, ind.gradeId),
    };
  }

  private calibCfg() { return calibrationConfigFromSettings(this.settingsMap()); }
  private calibFields(i: MemItem, gradeId: string) {
    const cs = calibStats(i.stats, i.currentVersion, gradeId, this.calibCfg());
    return { qualityFlag: i.qualityFlag, calibN: cs.n, calibP: cs.p, calibR: cs.r };
  }

  async listItems(subjectId: string, f: ItemFilter): Promise<ItemPage> {
    const size = f.pageSize ?? 30, page = f.page ?? 0;
    const q = (f.q ?? '').trim().toLowerCase();
    const ind = new Map(this.indicators.map((i) => [i.id, i]));
    const all = this.items.map((i) => this.summary(i)).filter((s) =>
      this.items.find((i) => i.id === s.id)!.subjectId === subjectId
      && (!f.gradeId || s.gradeId === f.gradeId)
      && (!f.indicatorId || s.indicatorId === f.indicatorId)
      && (!f.difficulty || s.currentDifficulty === f.difficulty)
      && (!f.status || s.status === f.status)
      && (!f.cognitive || s.cognitiveLevel === f.cognitive)
      && (!f.flag || (f.flag === 'any' ? s.qualityFlag !== null : s.qualityFlag === f.flag))
      && (f.includeSample || !s.isSample)
      && (!q || s.stem.toLowerCase().includes(q) || s.itemCode.toLowerCase().includes(q) || (s.subtopic ?? '').toLowerCase().includes(q)));
    all.sort((a, b) => a.gradeId.localeCompare(b.gradeId) || ind.get(a.indicatorId)!.sort - ind.get(b.indicatorId)!.sort
      || a.currentDifficulty - b.currentDifficulty || a.itemCode.localeCompare(b.itemCode));
    return { items: all.slice(page * size, page * size + size), total: all.length };
  }

  async getItem(id: string): Promise<ItemDetail | null> {
    const i = this.items.find((x) => x.id === id);
    if (!i) return null;
    return { ...this.summary(i), versions: clone(i.versions), events: clone(i.events), usedInExams: this.exams.filter((e) => e.items.some((x) => x.itemId === id)).length };
  }

  private requireIndicator(id: string) {
    const ind = this.indicators.find((i) => i.id === id);
    if (!ind) throw new Error(`ไม่พบตัวชี้วัด ${id || '(ไม่ระบุ)'}`);
    return ind;
  }

  private validate(c: ItemContent, a: ItemAnswer) {
    if (!c.stem?.trim()) throw new Error('ยังไม่มีโจทย์');
    if (!Array.isArray(c.options) || c.options.length !== 4) throw new Error('ข้อประเภท ปรนัย 4 ตัวเลือก ต้องมีตัวเลือก 4 ตัว');
    if (!Number.isInteger(a?.choice)) throw new Error('ยังไม่ได้เลือกเฉลย');
    if (a.choice < 1 || a.choice > 4) throw new Error('เฉลยต้องเป็นตัวเลือก 1–4');
  }

  async saveItem(input: SaveItemInput): Promise<string> {
    const d = input.draft;
    this.requireIndicator(d.indicatorId);
    this.validate(d.content, d.answer);
    if (input.mode === 'new') {
      const it = this.makeItem({ indicatorId: d.indicatorId, cognitiveLevel: d.cognitiveLevel, est: d.estDifficulty,
        status: 'draft', isSample: false, content: d.content, answer: d.answer, qa: clone(input.qa),
        noShuffle: d.noShuffle, tags: d.tags, subtopic: d.subtopic, note: input.changeNote });
      this.items.push(it);
      return it.id;
    }
    const it = this.items.find((x) => x.id === input.id);
    if (!it) throw new Error('ไม่พบข้อสอบที่จะแก้ไข');
    const cur = it.versions.find((v) => v.version === it.currentVersion)!;
    const t = now();
    const prevStatus = it.status;
    if (input.mode === 'minor') {
      const cls = classifyEdit(cur.content, cur.answer, d.content, d.answer);
      if (!cls.minorAllowed) throw new Error(`การแก้ไขนี้ต้องขึ้นเวอร์ชันใหม่: ${cls.majorReasons.join(', ')}`);
      cur.content = clone(d.content);
      cur.qa = clone(input.qa);
      it.events.push({ type: 'version_edited', payload: { version: it.currentVersion, note: input.changeNote ?? null }, at: t });
    } else if (input.mode === 'major') {
      it.versions.push({ version: it.currentVersion + 1, content: clone(d.content), answer: clone(d.answer), qa: clone(input.qa),
        changeNote: input.changeNote ?? null, createdAt: t });
      it.events.push({ type: 'version_changed', payload: { from: it.currentVersion, to: it.currentVersion + 1 }, at: t });
      it.currentVersion += 1;
      if (it.qualityFlag) {
        it.events.push({ type: 'quality_flag_changed', payload: { from: it.qualityFlag, to: null, reason: 'new_version' }, at: t });
        it.qualityFlag = null; it.qualityFlagAt = null;
      }
    } else throw new Error(`โหมดบันทึกไม่ถูกต้อง: ${input.mode}`);
    const meta = { indicator_id: d.indicatorId, cognitive_level: d.cognitiveLevel, est_difficulty: d.estDifficulty,
      no_shuffle: d.noShuffle, subtopic: d.subtopic };
    const old = { indicator_id: it.indicatorId, cognitive_level: it.cognitiveLevel, est_difficulty: it.estDifficulty,
      no_shuffle: it.noShuffle, subtopic: it.subtopic };
    if (JSON.stringify(meta) !== JSON.stringify(old)) it.events.push({ type: 'meta_changed', payload: { from: old, to: meta }, at: t });
    Object.assign(it, { indicatorId: d.indicatorId, cognitiveLevel: d.cognitiveLevel, estDifficulty: d.estDifficulty,
      noShuffle: d.noShuffle, tags: [...d.tags], subtopic: d.subtopic, updatedAt: t });
    if (!it.stats.length) {
      if (it.currentDifficulty !== d.estDifficulty)
        it.events.push({ type: 'difficulty_changed', payload: { from: it.currentDifficulty, to: d.estDifficulty }, at: t });
      it.currentDifficulty = d.estDifficulty;
    }
    const next = statusAfterSave(prevStatus, input.mode, input.qa.passed);
    if (next !== prevStatus) {
      it.events.push({ type: 'status_changed', payload: { from: prevStatus, to: next }, at: t });
      it.status = next;
    }
    return it.id;
  }

  async setItemStatus(id: string, status: ItemStatus, note?: string) {
    const it = this.items.find((x) => x.id === id);
    if (!it) throw new Error('ไม่พบข้อสอบ');
    const v = it.versions.find((x) => x.version === it.currentVersion)!;
    const blocked = it.isSample ? null : statusChangeBlocked(status, v.qa ? v.qa.passed : null);
    if (blocked && status !== it.status) throw new Error(`ข้อ ${it.itemCode} ยังไม่ผ่านการตรวจอัตโนมัติ จึงตั้งเป็น "ตรวจแล้ว/ใช้งาน" ไม่ได้`);
    const t = now();
    if (status !== it.status) it.events.push({ type: 'status_changed', payload: { from: it.status, to: status }, at: t });
    if (note?.trim()) it.events.push({ type: 'note', payload: { text: note, status }, at: t });
    it.status = status;
    it.updatedAt = t;
  }

  async deleteItem(id: string) {
    const it = this.items.find((x) => x.id === id);
    if (!it) throw new Error('ไม่พบข้อสอบ');
    if (it.status !== 'draft') throw new Error('ลบได้เฉพาะข้อที่เป็นร่าง ข้ออื่นให้เปลี่ยนเป็น "เลิกใช้"');
    if (it.stats.length) throw new Error('ข้อนี้มีสถิติแล้ว ลบไม่ได้');
    this.items = this.items.filter((x) => x.id !== id);
  }

  async exportBank(subjectId: string, includeSamples: boolean): Promise<BankExport> {
    const ind = new Map(this.indicators.map((i) => [i.id, i]));
    const ck = new Map(levels.cognitive.map((c) => [c.id, c.key]));
    const dk = new Map(levels.difficulty.map((d) => [d.id, d.key]));
    const items = this.items.filter((i) => i.subjectId === subjectId && (includeSamples || !i.isSample))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
      .map((i) => ({
        item_code: i.itemCode, subject_id: i.subjectId, indicator_id: i.indicatorId, indicator_code: ind.get(i.indicatorId)!.code,
        item_type: i.itemType, cognitive_level: ck.get(i.cognitiveLevel), est_difficulty: dk.get(i.estDifficulty),
        current_difficulty: dk.get(i.currentDifficulty), status: i.status, current_version: i.currentVersion,
        no_shuffle: i.noShuffle, is_sample: i.isSample, tags: [...i.tags], subtopic: i.subtopic, created_at: i.createdAt,
        versions: i.versions.map((v) => ({ version: v.version, content: clone(v.content), answer: clone(v.answer), qa: clone(v.qa),
          change_note: v.changeNote, created_at: v.createdAt })),
        stat_rounds: i.stats.map((s) => ({ version: s.version, grade_id: s.gradeId, n: s.n, n_correct: s.nCorrect, r: s.r })),
        events: i.events.map((e) => ({ type: e.type, payload: clone(e.payload), at: e.at })),
      }));
    return { format: 'itembank.bank.v1', exported_at: now(), subject_id: subjectId, item_count: items.length, items };
  }

  private levelId(kind: 'cognitive' | 'difficulty', v: unknown): number {
    const list = kind === 'cognitive' ? levels.cognitive : levels.difficulty;
    const hit = list.find((l) => l.id === v || l.key === v || l.name_th === v);
    if (!hit) throw new Error(`ไม่รู้จัก${kind === 'cognitive' ? 'ระดับการคิด' : 'ระดับความยาก'}: ${String(v ?? '(ไม่ระบุ)')}`);
    return hit.id;
  }

  async importBank(data: unknown, dryRun: boolean): Promise<ImportReport> {
    const doc = data as any;
    if (doc?.format !== 'itembank.bank.v1') throw new Error('รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็นไฟล์สำรองคลัง itembank.bank.v1)');
    if (!Array.isArray(doc.items)) throw new Error('ไฟล์ไม่มีรายการข้อสอบ (items)');
    const report: ImportReport = { dryRun, inserted: 0, skipped: [], errors: [] };
    const backupItems = this.items.slice();
    const backupSeq = this.seq;
    doc.items.forEach((it: any, k: number) => {
      const index = k + 1;
      const code: string | null = it?.item_code?.trim() || null;
      try {
        if (code && this.items.some((x) => x.itemCode === code)) { report.skipped.push({ index, itemCode: code, reason: 'มีรหัสนี้ในคลังแล้ว' }); return; }
        const ind = this.indicators.find((i) => i.id === it.indicator_id)
          ?? (it.indicator_id ? undefined : this.indicators.find((i) => i.code === it.indicator_code));
        if (!ind) throw new Error(`ไม่พบตัวชี้วัด ${it.indicator_id ?? it.indicator_code ?? '(ไม่ระบุ)'}`);
        const cog = this.levelId('cognitive', it.cognitive_level), est = this.levelId('difficulty', it.est_difficulty);
        const versions: any[] = Array.isArray(it.versions) && it.versions.length ? it.versions
          : [{ version: 1, content: it.content, answer: it.answer, qa: it.qa ?? null }];
        if (code) {
          if (!/^M-\d{6}$/.test(code)) throw new Error(`รหัสข้อ ${code} ไม่ตรงรูปแบบ M-000000`);
          versions.forEach((v) => this.validate(v.content, v.answer));
          const item = this.makeItem({ indicatorId: ind.id, cognitiveLevel: cog, est, status: it.status ?? 'draft', isSample: !!it.is_sample,
            content: versions[0].content, answer: versions[0].answer, qa: versions[0].qa ?? null, noShuffle: !!it.no_shuffle,
            tags: it.tags ?? [], subtopic: it.subtopic ?? null, code });
          item.versions = versions.map((v) => ({ version: v.version, content: clone(v.content), answer: clone(v.answer), qa: v.qa ?? null,
            changeNote: v.change_note ?? null, createdAt: v.created_at ?? now() }));
          item.currentVersion = it.current_version ?? Math.max(...versions.map((v) => v.version));
          item.currentDifficulty = it.current_difficulty ? this.levelId('difficulty', it.current_difficulty) : est;
          item.stats = (it.stat_rounds ?? []).map((s: any) => ({ version: s.version, gradeId: s.grade_id ?? null, n: s.n, nCorrect: s.n_correct, r: s.r ?? null }));
          if (Array.isArray(it.events) && it.events.length) item.events = clone(it.events);
          item.events.push({ type: 'imported', payload: { mode: 'restore' }, at: now() });
          const num = Number(code.slice(2));
          if (num > this.seq) this.seq = num;
          this.items.push(item);
        } else {
          const last = versions.slice().sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
          this.validate(last.content, last.answer);
          const item = this.makeItem({ indicatorId: ind.id, cognitiveLevel: cog, est, status: 'draft', isSample: false,
            content: last.content, answer: last.answer, qa: last.qa ?? null, noShuffle: !!it.no_shuffle,
            tags: it.tags ?? [], subtopic: it.subtopic ?? null, note: 'นำเข้าจากไฟล์' });
          item.events.push({ type: 'imported', payload: { mode: 'new' }, at: now() });
          this.items.push(item);
        }
        report.inserted += 1;
      } catch (e) {
        report.errors.push({ index, itemCode: code, message: (e as Error).message });
      }
    });
    if (dryRun) { this.items = backupItems; this.seq = backupSeq; }
    return report;
  }

  // ---------- ประกอบชุดข้อสอบ (เลียนแบบ migration 0006) ----------
  private settingsMap() { return Object.fromEntries(settingsList.map((x) => [x.key, x.value])) as Settings; }

  async getAssemblyPool(subjectId: string): Promise<PoolItem[]> {
    return this.items.filter((i) => i.subjectId === subjectId && ASSEMBLABLE.includes(i.status) && i.itemType === 'mcq4')
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
      .map((i) => {
        const v = i.versions.find((x) => x.version === i.currentVersion)!;
        return { id: i.id, itemCode: i.itemCode, indicatorId: i.indicatorId, difficulty: i.currentDifficulty, version: i.currentVersion,
          n: this.summary(i).n, noShuffle: i.noShuffle, answer: v.answer.choice, isSample: i.isSample };
      });
  }

  async createExam(input: ExamCreateInput): Promise<string> {
    if (!this.auth.signedIn) throw new Error('ต้องเข้าสู่ระบบก่อนสร้างชุดข้อสอบ');
    const cfg = configFromSettings(this.settingsMap());
    const ordering = makeOrdering(this.indicators, await this.getGrades(), await this.getDifficultyLevels());
    const pool = await this.getAssemblyPool(input.subjectId);
    checkCreateInput(input, pool, cfg, ordering);
    const byId = new Map(pool.map((p) => [p.id, p]));
    this.examSeq += 1;
    const id = `exam-${this.examSeq}`;
    this.exams.unshift({
      id, title: input.title.trim(), subjectId: input.subjectId, gradeId: input.gradeId, setCount: input.setCount,
      studentCount: input.studentCount, status: 'draft', createdAt: now(),
      durationMin: Math.min(300, Math.max(1, Math.ceil(input.items.length * Number(this.settingsMap()['print.minutes_per_item'] ?? 2)))), rows: clone(input.rows), build: clone(input.build),
      items: input.items.map((x) => { const p = byId.get(x.itemId)!;
        return { itemId: x.itemId, version: x.version, basePosition: x.basePosition, isAnchor: p.n >= cfg.anchorMinN, indicatorId: p.indicatorId, difficulty: p.difficulty }; }),
      sets: clone(input.sets).sort((a, b) => a.setNo - b.setNo),
      openedAt: null, expiresAt: null, closedAt: null, closedSummary: null, roundStats: [],
    });
    for (const x of input.items) {
      const it = this.items.find((i) => i.id === x.itemId)!;
      if (it.status === 'reviewed') {
        it.events.push({ type: 'status_changed', payload: { from: 'reviewed', to: 'active' }, at: now() });
        it.status = 'active';
      }
    }
    return id;
  }

  private examSummary(e: MemExam): ExamSummary {
    return { id: e.id, title: e.title, gradeId: e.gradeId, itemCount: e.items.length, setCount: e.setCount,
      studentCount: e.studentCount, status: e.status, createdAt: e.createdAt, durationMin: e.durationMin,
      expiresAt: e.expiresAt, closedAt: e.closedAt };
  }

  async listExams(subjectId: string): Promise<ExamSummary[]> {
    await this.expireDue();
    return this.exams.filter((e) => e.subjectId === subjectId).map((e) => this.examSummary(e));
  }

  async getExam(id: string): Promise<ExamDetail | null> {
    const e = this.exams.find((x) => x.id === id);
    if (!e) return null;
    const items = e.items.slice().sort((a, b) => a.basePosition - b.basePosition).map((x) => {
      const it = this.items.find((i) => i.id === x.itemId)!;
      const v = it.versions.find((vv) => vv.version === x.version)!;
      return { itemId: x.itemId, itemCode: it.itemCode, version: x.version, basePosition: x.basePosition, indicatorId: x.indicatorId,
        difficulty: x.difficulty, isAnchor: x.isAnchor, noShuffle: it.noShuffle, n: this.summary(it).n, content: clone(v.content), answer: v.answer.choice };
    });
    const ans = new Map(items.map((i) => [i.itemId, i.answer]));
    return {
      ...this.examSummary(e), rows: clone(e.rows), build: clone(e.build), items,
      sets: e.sets.map((s) => ({ setNo: s.setNo, entries: s.entries.map((x, k) => ({ position: k + 1, itemId: x.itemId,
        optionOrder: [...x.optionOrder], key: x.optionOrder.indexOf(ans.get(x.itemId)!) + 1 })) })),
      seats: Array.from({ length: e.studentCount }, (_, k) => ({ seatNo: k + 1, setNo: seatSet(k + 1, e.setCount) })),
      hasResponses: (this.scans.get(e.id)?.size ?? 0) > 0,
      templateVersion: 1,
      openedAt: e.openedAt, closedSummary: clone(e.closedSummary), roundStats: clone(e.roundStats),
    };
  }

  async deleteExam(id: string): Promise<void> {
    const e = this.exams.find((x) => x.id === id);
    if (!e) throw new Error('ไม่พบชุดข้อสอบ');
    if (e.status === 'open' || (this.scans.get(id)?.size ?? 0) > 0) throw new Error('ลบได้เฉพาะชุดที่ยังไม่เริ่มสอบหรือปิดชุดแล้ว — ชุดนี้กำลังสอบ ให้ปิดชุดก่อน');
    this.exams = this.exams.filter((x) => x.id !== id);
  }

  async updateExamMeta(id: string, title: string, durationMin: number): Promise<void> {
    const e = this.exams.find((x) => x.id === id);
    if (!e) throw new Error('ไม่พบชุดข้อสอบ');
    if (!title.trim() || title.trim().length > 200) throw new Error('ชื่อแบบทดสอบต้องมี 1–200 ตัวอักษร');
    if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 300) throw new Error('เวลาสอบต้องอยู่ระหว่าง 1–300 นาที');
    e.title = title.trim();
    e.durationMin = durationMin;
  }

  // ---------- ตรวจด้วยกล้อง (เลียนแบบ migration 0008) ----------
  private async scanContext(examId: string) {
    const e = this.exams.find((x) => x.id === examId);
    const d = e ? await this.getExam(examId) : null;
    if (!e || !d) throw new Error('ไม่พบชุดข้อสอบ');
    const keys: Record<number, number[]> = {};
    d.sets.forEach((s) => { keys[s.setNo] = s.entries.map((x) => x.key); });
    if (!this.scans.has(examId)) this.scans.set(examId, new Map());
    return { e, d, keys, rows: this.scans.get(examId)! };
  }

  private checkAnswers(answers: ScanAnswer[], n: number, setNo: number, setCount: number) {
    if (!Array.isArray(answers) || answers.length !== n) throw new Error(`คำตอบต้องมี ${n} ข้อ ตามชุดข้อสอบ`);
    if (answers.some((a) => !(a === null || a === 'multi' || a === 1 || a === 2 || a === 3 || a === 4)))
      throw new Error('คำตอบแต่ละข้อต้องเป็น 1–4, ไม่ฝน (null) หรือ "multi"');
    if (setNo < 1 || setNo > setCount) throw new Error(`ชุดที่ ${setNo} ไม่มีในชุดข้อสอบนี้`);
  }

  async saveScan(input: ScanSaveInput): Promise<ScanSaveResult> {
    const { e, d, keys, rows } = await this.scanContext(input.examId);
    if (e.status === 'closed' || e.status === 'expired') throw new Error('ชุดข้อสอบนี้ปิดแล้ว บันทึกคำตอบเพิ่มไม่ได้');
    const seat = d.seats.find((x) => x.seatNo === input.seatNo);
    if (!seat) throw new Error(`ไม่มีเลขที่ ${input.seatNo} ในชุดข้อสอบนี้`);
    if (seat.setNo !== input.setNo) throw new Error(`กระดาษคำตอบระบุชุดที่ ${input.setNo} แต่เลขที่ ${input.seatNo} ได้ชุดที่ ${seat.setNo}`);
    this.checkAnswers(input.answers, d.itemCount, input.setNo, e.setCount);
    const amb = [...new Set(input.ambiguous)].sort((a, b) => a - b);
    if (amb.some((x) => x < 1 || x > d.itemCount)) throw new Error('ลำดับข้อที่กำกวมไม่ถูกต้อง');
    const flags: ScanFlag[] = [];
    if (amb.length) flags.push({ type: 'ambiguous', positions: amb, resolved: false });
    const ws = detectWrongSet(input.answers, keys, input.setNo, scanConfigFromSettings(this.settingsMap()));
    if (ws) flags.push({ type: 'wrong_set', suggested_set: ws.suggestedSet, score_alt: ws.scoreAlt, resolved: false });
    const old = rows.get(input.seatNo);
    if (old && !input.replace) {
      if (answersEqual(old.answers, input.answers) && old.setNo === input.setNo) return { status: 'unchanged', response: clone(old) };
      return { status: 'exists', response: clone(old), newScore: score(input.answers, keys[input.setNo]) };
    }
    const r: ScanResponse = { seatNo: input.seatNo, setNo: input.setNo, answers: [...input.answers], score: score(input.answers, keys[input.setNo]),
      flags, source: input.source, scannedAt: now() };
    rows.set(input.seatNo, r);
    if (e.status === 'draft') {
      e.status = 'open';
      e.openedAt = e.openedAt ?? now();
      const days = Number(this.settingsMap()['privacy.exam_expiry_days'] ?? 60);
      e.expiresAt = e.expiresAt ?? new Date(Date.parse(e.openedAt) + days * 86_400_000).toISOString();
    }
    return { status: old ? 'replaced' : 'saved', response: clone(r) };
  }

  async reviewScan(examId: string, seatNo: number, setNo: number, answers: ScanAnswer[]): Promise<ScanResponse> {
    const { e, d, keys, rows } = await this.scanContext(examId);
    const old = rows.get(seatNo);
    if (!old) throw new Error(`เลขที่ ${seatNo} ยังไม่ได้ตรวจ`);
    this.checkAnswers(answers, d.itemCount, setNo, e.setCount);
    const r: ScanResponse = { ...old, setNo, answers: [...answers], score: score(answers, keys[setNo]), flags: old.flags.map((f) => ({ ...f, resolved: true })) };
    rows.set(seatNo, r);
    return clone(r);
  }

  async deleteScan(examId: string, seatNo: number): Promise<void> {
    const { e, rows } = await this.scanContext(examId);
    if (e.status === 'closed' || e.status === 'expired') throw new Error('ชุดข้อสอบนี้ปิดแล้ว');
    rows.delete(seatNo);
  }

  async listScans(examId: string): Promise<ScanResponse[]> {
    const { rows } = await this.scanContext(examId);
    return [...rows.values()].sort((a, b) => a.seatNo - b.seatNo).map(clone);
  }

  // ---------- วิเคราะห์และปิดชุด (เลียนแบบ migration 0009) ----------
  private async finalize(e: MemExam, as: 'closed' | 'expired'): Promise<ClosedSummary> {
    if (e.status === 'closed' || e.status === 'expired') throw new Error('ชุดข้อสอบนี้ปิดแล้ว');
    const d = (await this.getExam(e.id))!;
    const rows = this.scans.get(e.id) ?? new Map<number, ScanResponse>();
    const settings = this.settingsMap();
    const a = analyze(d, [...rows.values()], analysisConfigFromSettings(settings));
    const stats: RoundStat[] = a.items.filter((i) => i.n > 0).map((i) => ({ itemId: i.itemId, version: i.version, n: i.n, nCorrect: i.nCorrect,
      r: i.r, optionCounts: { ...i.counts } }));
    const recordedAt = now();
    for (const st of stats) this.items.find((x) => x.id === st.itemId)?.stats.push({ version: st.version, gradeId: e.gradeId, n: st.n,
      nCorrect: st.nCorrect, r: st.r, optionCounts: st.optionCounts, recordedAt, fromExam: true });
    // สถิติรอบใหม่เข้าคลัง → ปรับความยากทันที (เลียนแบบทริกเกอร์ของ migration 0010)
    if (stats.length) this.calibrate(stats.map((x) => x.itemId), 'exam', e.id);
    const summary: ClosedSummary = {
      n: a.summary.n, studentCount: e.studentCount, itemCount: d.itemCount, mean: a.summary.mean, sd: a.summary.sd, median: a.summary.median,
      min: a.summary.min, max: a.summary.max, meanPercent: a.summary.meanPercent, histogram: a.summary.histogram, passRatio: a.config.passRatio,
      indicators: a.indicators.map((x) => ({ indicatorId: x.indicatorId, itemCount: x.itemCount, passCount: x.passCount, meanRatio: x.meanRatio })),
      itemsRecorded: stats.length, responsesDeleted: rows.size, finalizedAs: as, finalizedAt: now(),
    };
    this.scans.delete(e.id);
    e.status = as;
    e.closedAt = now();
    e.closedSummary = summary;
    e.roundStats = stats;
    return clone(summary);
  }

  async closeExam(id: string): Promise<ClosedSummary> {
    const e = this.exams.find((x) => x.id === id);
    if (!e) throw new Error('ไม่พบชุดข้อสอบ');
    if (e.status === 'draft') throw new Error('ชุดข้อสอบนี้ยังไม่ได้เริ่มตรวจ — ถ้าไม่ใช้แล้วให้ลบชุดแทน');
    return this.finalize(e, 'closed');
  }

  private async expireDue() {
    const t = Date.now();
    for (const e of this.exams)
      if ((e.status === 'draft' || e.status === 'open') && e.expiresAt && Date.parse(e.expiresAt) <= t) await this.finalize(e, 'expired');
  }

  // ---------- ปรับความยากและสุขภาพคลัง (เลียนแบบ migration 0010) ----------
  private calibrate(itemIds: string[] | null, source: 'exam' | 'manual', examId: string | null): MemRun {
    const levelsList = levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));
    const cfg = this.calibCfg();
    const runId = this.runs.length + 1;
    const t = now();
    const run: MemRun = { runId, source, examId, itemsChecked: 0, moved: [], flagged: [], unflagged: [], stopped: 0, shortfalls: [], ranAt: t };
    const targets = this.items.filter((i) => !itemIds || itemIds.includes(i.id)).sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    for (const it of targets) {
      const gradeId = this.indicators.find((x) => x.id === it.indicatorId)!.gradeId;
      const res = applyCalibration(levelsList, cfg, { currentDifficulty: it.currentDifficulty, status: it.status, qualityFlag: it.qualityFlag,
        currentVersion: it.currentVersion, gradeId }, it.stats);
      if (!res) continue;
      run.itemsChecked += 1;
      if (res.moved) {
        it.moves.push({ version: it.currentVersion, from: res.moved.from, to: res.moved.to, direction: res.moved.direction,
          p: res.stats.p ?? 0, n: res.stats.n, r: res.stats.r, movedAt: t, runId });
        it.events.push({ type: 'difficulty_changed', payload: { from: res.moved.from, to: res.moved.to }, at: t });
        run.moved.push({ itemId: it.id, itemCode: it.itemCode, indicatorId: it.indicatorId, from: res.moved.from, to: res.moved.to,
          direction: res.moved.direction, p: res.stats.p ?? 0, n: res.stats.n });
        it.currentDifficulty = res.moved.to;
      }
      if (res.flagChanged) {
        it.events.push({ type: 'quality_flag_changed', payload: { from: res.flagChanged.from, to: res.flagChanged.to, r: res.stats.r, n_r: res.stats.nR }, at: t });
        const fc: FlagChange = { itemId: it.id, itemCode: it.itemCode, indicatorId: it.indicatorId, flag: res.flagChanged.to, from: res.flagChanged.from,
          r: res.stats.r, nR: res.stats.nR };
        if (res.flagChanged.to) run.flagged.push(fc); else run.unflagged.push(fc);
        it.qualityFlag = res.flagChanged.to;
        it.qualityFlagAt = res.flagChanged.to ? t : null;
        if (res.stopped) {
          it.events.push({ type: 'status_changed', payload: { from: it.status, to: 'needs_fix' }, at: t });
          it.events.push({ type: 'note', payload: { text: 'ค่า r ติดลบ — หยุดสุ่มเข้าชุดจนกว่าจะแก้', status: 'needs_fix' }, at: t });
          it.status = 'needs_fix';
          run.stopped += 1;
        }
      }
    }
    const cells = this.coverageNow();
    run.shortfalls = cells.filter((c) => c.ready < cfg.target && run.moved.some((m) => m.indicatorId === c.indicatorId && m.from === c.difficultyId))
      .map((c) => ({ ...c, target: cfg.target }));
    this.runs.push(run);
    return run;
  }

  private coverageNow(): Array<Shortfall & { indicatorSort: number }> {
    const out: Array<Shortfall & { indicatorSort: number }> = [];
    for (const ind of this.indicators)
      for (const d of levels.difficulty) {
        const mine = this.items.filter((i) => i.indicatorId === ind.id && i.currentDifficulty === d.id);
        out.push({ indicatorId: ind.id, indicatorCode: ind.code, gradeId: ind.gradeId, indicatorSort: ind.sort, difficultyId: d.id,
          ready: mine.filter((i) => i.status === 'reviewed' || i.status === 'active').length, target: 0,
          draft: mine.filter((i) => i.status === 'draft').length, needsFix: mine.filter((i) => i.status === 'needs_fix').length });
      }
    return out.sort((a, b) => a.gradeId.localeCompare(b.gradeId) || a.indicatorSort - b.indicatorSort || a.difficultyId - b.difficultyId);
  }

  private publicRun(r: MemRun): CalibrationRun {
    const { ranAt: _ranAt, ...rest } = clone(r);
    return { ...rest, shortfalls: rest.shortfalls.map(({ indicatorSort: _s, ...x }: any) => x) };
  }

  async runCalibration(itemIds?: string[]): Promise<CalibrationRun> {
    return this.publicRun(this.calibrate(itemIds && itemIds.length ? itemIds : null, 'manual', null));
  }

  async getExamCalibration(examId: string): Promise<CalibrationRun | null> {
    const r = [...this.runs].reverse().find((x) => x.source === 'exam' && x.examId === examId);
    return r ? this.publicRun(r) : null;
  }

  async getItemCalibration(id: string): Promise<ItemCalibrationInfo | null> {
    const it = this.items.find((x) => x.id === id);
    if (!it) return null;
    const gradeId = this.indicators.find((x) => x.id === it.indicatorId)!.gradeId;
    const cfg = this.calibCfg();
    const st = calibStats(it.stats, it.currentVersion, gradeId, cfg);
    const levelsList = await this.getDifficultyLevels();
    return {
      stats: { ...st, gradeId, version: it.currentVersion },
      decision: decide(levelsList, cfg, it.currentDifficulty, st),
      rounds: it.stats.map((s) => ({ version: s.version, gradeId: s.gradeId, n: s.n, nCorrect: s.nCorrect, r: s.r,
        optionCounts: s.optionCounts ?? {}, recordedAt: s.recordedAt ?? it.createdAt })),
      moves: it.moves.map(({ runId: _r, ...m }) => ({ ...m })),
    };
  }

  async getBankHealth(subjectId: string): Promise<BankHealth> {
    const cfg = this.calibCfg();
    const s = this.settingsMap();
    const recentDays = typeof s['calibration.recent_days'] === 'number' ? (s['calibration.recent_days'] as number) : 30;
    const since = Date.now() - recentDays * 86_400_000;
    const items = this.items.filter((i) => i.subjectId === subjectId);
    const ind = new Map(this.indicators.map((x) => [x.id, x]));
    const live = items.filter((i) => ['reviewed', 'active', 'needs_fix'].includes(i.status));
    const statOf = (i: MemItem) => calibStats(i.stats, i.currentVersion, ind.get(i.indicatorId)!.gradeId, cfg);
    const cells = this.coverageNow();
    const moves = items.flatMap((i) => i.moves.map((m) => ({ ...m, item: i })));
    const recent = moves.filter((m) => Date.parse(m.movedAt) > since);
    const statusCounts: Record<string, number> = {};
    for (const i of items) statusCounts[i.status] = (statusCounts[i.status] ?? 0) + 1;
    return {
      generatedAt: now(),
      settings: { target: cfg.target, minNToMove: cfg.minNToMove, buffer: cfg.buffer, rFlagBelow: cfg.rFlagBelow, rMinN: cfg.rMinN,
        sameGradeOnly: cfg.sameGradeOnly, recentDays },
      statusCounts,
      sampleCount: items.filter((i) => i.isSample).length,
      nBuckets: {
        none: live.filter((i) => statOf(i).n === 0).length,
        collecting: live.filter((i) => { const n = statOf(i).n; return n > 0 && n < cfg.minNToMove; }).length,
        calibrated: live.filter((i) => statOf(i).n >= cfg.minNToMove).length,
      },
      coverage: { cells: cells.length, full: cells.filter((c) => c.ready >= cfg.target).length, empty: cells.filter((c) => c.ready === 0).length,
        readyTotal: cells.reduce((a, c) => a + c.ready, 0), targetTotal: cells.length * cfg.target },
      shortfalls: cells.filter((c) => c.ready < cfg.target).map(({ indicatorSort: _s, ...c }) => ({ ...c, target: cfg.target,
        movedOut: recent.filter((m) => m.item.indicatorId === c.indicatorId && m.from === c.difficultyId).length })),
      flagged: items.filter((i) => i.qualityFlag && i.status !== 'retired').map((i) => {
        const st = statOf(i);
        return { itemId: i.id, itemCode: i.itemCode, indicatorId: i.indicatorId, indicatorCode: ind.get(i.indicatorId)!.code,
          gradeId: ind.get(i.indicatorId)!.gradeId, difficulty: i.currentDifficulty, status: i.status, flag: i.qualityFlag!, flagAt: i.qualityFlagAt,
          r: st.r, nR: st.nR, p: st.p, n: st.n };
      }).sort((a, b) => (a.flag === 'negative_r' ? 0 : 1) - (b.flag === 'negative_r' ? 0 : 1) || (a.r ?? 9) - (b.r ?? 9) || a.itemCode.localeCompare(b.itemCode)),
      needsFixCount: items.filter((i) => i.status === 'needs_fix').length,
      recentMoves: recent.sort((a, b) => b.movedAt.localeCompare(a.movedAt)).slice(0, 200).map((m) => ({
        itemId: m.item.id, itemCode: m.item.itemCode, indicatorId: m.item.indicatorId, indicatorCode: ind.get(m.item.indicatorId)!.code,
        gradeId: ind.get(m.item.indicatorId)!.gradeId, from: m.from, to: m.to, direction: m.direction, p: m.p, n: m.n, movedAt: m.movedAt,
      } as LevelMove & { indicatorCode: string; gradeId: string })),
      moveTotals: { easier: moves.filter((m) => m.direction === 'easier').length, harder: moves.filter((m) => m.direction === 'harder').length, allTime: moves.length },
      levelMix: levels.difficulty.map((d) => ({ difficulty: d.id, est: live.filter((i) => i.estDifficulty === d.id).length,
        current: live.filter((i) => i.currentDifficulty === d.id).length })),
      runs: [...this.runs].reverse().slice(0, 10).map((r) => ({ id: r.runId, source: r.source, examId: r.examId, ranAt: r.ranAt, itemsChecked: r.itemsChecked,
        moved: r.moved.length, flagged: r.flagged.length, unflagged: r.unflagged.length, shortfalls: r.shortfalls.length })),
    };
  }

  /** โหมดสาธิต/ทดสอบเท่านั้น: ใส่สถิติรอบสอบให้ข้อ (เหมือนปิดชุดข้อสอบ) แล้วปรับความยาก */
  debugAddStats(itemCode: string, rounds: Array<{ n: number; nCorrect: number; r: number | null; gradeId?: string }>) {
    const it = this.items.find((x) => x.itemCode === itemCode);
    if (!it) throw new Error(`ไม่พบข้อ ${itemCode}`);
    const gradeId = this.indicators.find((x) => x.id === it.indicatorId)!.gradeId;
    for (const r of rounds) it.stats.push({ version: it.currentVersion, gradeId: r.gradeId ?? gradeId, n: r.n, nCorrect: r.nCorrect, r: r.r,
      recordedAt: now(), fromExam: true });
    return this.publicRun(this.calibrate([it.id], 'exam', `demo-${itemCode}`));
  }

  /** โหมดสาธิต/ทดสอบเท่านั้น: เลื่อนวันเริ่มตรวจ/วันหมดอายุของชุดย้อนหลัง (จำลองเวลาผ่านไป) */
  debugAgeExam(id: string, days: number) {
    const e = this.exams.find((x) => x.id === id);
    if (!e) throw new Error('ไม่พบชุดข้อสอบ');
    const shift = (v: string | null) => (v ? new Date(Date.parse(v) - days * 86_400_000).toISOString() : v);
    e.openedAt = shift(e.openedAt);
    e.expiresAt = shift(e.expiresAt);
  }
}
