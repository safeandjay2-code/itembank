// สมุดคะแนนทั้งห้อง (One Stop เฟส 4) — ฟังก์ชันบริสุทธิ์
//   computeSheet = เลียนแบบ gb_sheet ใน migration 0011 ทุกขั้น (ใช้ในโหมดสาธิต · ฐานข้อมูลจริงคำนวณเองและมี test_phase8.sql)
//   ที่เหลือ = ตรรกะหน้าสมุดคะแนน (รายละเอียดรายคน, เกณฑ์ผ่าน, สถิติช่อง)
import type {
  GbAttempt, GbColumn, GbOverrideReason, GbRetakeChoice, GbSettings, GbSheet, GbSheetCell, GbSheetColumn, GbSheetExam, GbSheetRow,
} from '../../core/types';
import { splitIndicatorCode } from './plan';

/** ปัดครึ่งขึ้นแบบ PostgreSQL round(numeric, d) สำหรับค่าบวก (กันเศษทศนิยมของเลขฐานสอง) */
export function roundHalfUp(x: number, digits: number): number {
  const f = 10 ** digits;
  const scaled = Number((x * f).toFixed(6));
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / f;
}

export interface SheetInput {
  classroom: GbSheet['classroom'];
  columns: GbColumn[];
  /** รหัส/คำอธิบายตัวชี้วัด */
  indicator: (id: string) => { code: string; text: string } | undefined;
  /** ทุกชุดของห้อง · itemTargets = ตัวชี้วัดของแต่ละข้อในชุด */
  exams: Array<GbSheetExam & { itemIndicators: string[] }>;
  attempts: GbAttempt[];
  overrides: Array<{ columnId: number; seatNo: number; score: number; reason: GbOverrideReason }>;
  retakeChoices: GbRetakeChoice[];
}

const FINAL = '#FINAL';
const sum = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

export function computeSheet(inp: SheetInput): GbSheet {
  const s = inp.classroom.settings;
  const digits = s.rounding === '1dp' ? 1 : 0;
  const counted = inp.exams.filter((e) => e.purpose === 'collect' || e.purpose === 'final');
  const exById = new Map(counted.map((e) => [e.id, { ...e, root: e.retakeOf ?? e.id }]));
  const targetOf = (purpose: string, ind: string) => (purpose === 'final' ? FINAL : ind);

  // คะแนนจริงต่อชุด × เลขที่ × เป้าหมาย (ปลายภาค = รวมทุกตัวชี้วัด)
  type Un = { examId: string; root: string; createdAt: string; seatNo: number; target: string; c: number; t: number };
  const unMap = new Map<string, Un>();
  for (const a of inp.attempts) {
    const ex = exById.get(a.examId);
    if (!ex) continue;
    const target = targetOf(ex.purpose, a.indicatorId);
    const key = `${a.examId}|${a.seatNo}|${target}`;
    const u = unMap.get(key) ?? { examId: a.examId, root: ex.root, createdAt: ex.createdAt, seatNo: a.seatNo, target, c: 0, t: 0 };
    u.c += a.correct; u.t += a.total;
    unMap.set(key, u);
  }
  const un = [...unMap.values()];
  const seatCount = Math.max(inp.classroom.studentCount, ...un.map((u) => u.seatNo), 0);

  // กลุ่มการสอบ (ชุดแรก + สอบซ่อม) ต่อเป้าหมาย — เฉพาะกลุ่มที่มีผลสอบแล้ว
  type Grp = { root: string; target: string; t: number; exams: string[] };
  const grps: Grp[] = [];
  for (const key of new Set(un.map((u) => `${u.root}|${u.target}`))) {
    const [root, target] = key.split('|');
    let t = 0;
    for (const e of exById.values()) {
      if (e.root !== root) continue;
      const n = e.itemIndicators.filter((ind) => targetOf(e.purpose, ind) === target).length;
      if (n > 0) t = Math.max(t, n);
    }
    const exams = [...new Set(un.filter((u) => u.root === root && u.target === target).map((u) => u.examId))].sort();
    grps.push({ root, target, t, exams });
  }

  // เลือกสัดส่วนถูกต่อเลขที่ ต่อกลุ่ม ตามวิธีนับสอบซ่อม (null = ขาดสอบ)
  const choice = new Map(inp.retakeChoices.map((r) => [`${r.rootExamId}|${r.seatNo}`, r.chosenExamId]));
  type Sel = { root: string; target: string; t: number; seatNo: number; ratio: number | null };
  const sel: Sel[] = [];
  for (const g of grps) {
    for (let seat = 1; seat <= seatCount; seat++) {
      const us = un.filter((u) => u.root === g.root && u.target === g.target && u.seatNo === seat);
      let ratio: number | null = null;
      if (us.length) {
        const rs = us.map((u) => u.c / u.t);
        const mx = Math.max(...rs);
        const latest = [...us].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.examId.localeCompare(a.examId))[0];
        const chosen = us.filter((u) => u.examId === choice.get(`${g.root}|${seat}`));
        ratio = s.retake_policy === 'max' ? mx
          : s.retake_policy === 'latest' ? latest.c / latest.t
          : s.retake_policy === 'mean' ? rs.reduce((a, b) => a + b, 0) / rs.length
          : chosen.length ? Math.max(...chosen.map((u) => u.c / u.t)) : mx;
      }
      sel.push({ root: g.root, target: g.target, t: g.t, seatNo: seat, ratio });
    }
  }

  const cols = [...inp.columns].sort((a, b) => Number(a.kind === 'final') - Number(b.kind === 'final') || a.sort - b.sort || a.id - b.id);
  const colTarget = (c: GbColumn) => (c.kind === 'final' ? FINAL : c.kind === 'indicator' ? c.indicatorId : null);
  const ov = new Map(inp.overrides.map((o) => [`${o.columnId}|${o.seatNo}`, o]));
  const skip = s.absent_policy === 'skip';

  const rows: GbSheetRow[] = [];
  for (let seat = 1; seat <= seatCount; seat++) {
    const cells: GbSheetCell[] = cols.map((col) => {
      const ss = sel.filter((x) => x.seatNo === seat && x.target === colTarget(col));
      const use = ss.filter((x) => !(x.ratio === null && skip));
      const rc = use.length ? use.reduce((a, x) => a + (x.ratio ?? 0) * x.t, 0) : null;
      const rt = use.length ? use.reduce((a, x) => a + x.t, 0) : null;
      const mr = use.length ? use.reduce((a, x) => a + (x.ratio ?? 0), 0) / use.length : null;
      let real: number | null = null;
      if (col.maxScore !== null && col.kind !== 'other') {
        if (s.aggregation === 'mean') real = mr === null ? null : roundHalfUp(mr * col.maxScore, 4);
        else real = rc === null || !rt ? null : roundHalfUp((rc / rt) * col.maxScore, 4);
      }
      const o = ov.get(`${col.id}|${seat}`);
      const adjusted = o ? o.score : null;
      const base = adjusted ?? real;
      return {
        columnId: col.id, rawCorrect: rc === null ? null : roundHalfUp(rc, 2), rawTotal: rt, real: real === null ? null : roundHalfUp(real, 2),
        adjusted, reason: o ? o.reason : null, value: base === null ? null : roundHalfUp(base, digits),
        missing: ss.filter((x) => x.ratio === null).map((x) => x.root).sort(),
      };
    });
    const isFinal = (k: number) => cols[k].kind === 'final';
    rows.push({
      seatNo: seat, cells,
      totalCollect: sum(cells.filter((_, k) => !isFinal(k)).map((c) => c.value)),
      totalFinal: sum(cells.filter((_, k) => isFinal(k)).map((c) => c.value)),
      total: sum(cells.map((c) => c.value)),
    });
  }

  const columns: GbSheetColumn[] = cols.map((col) => {
    const ind = col.indicatorId ? inp.indicator(col.indicatorId) : undefined;
    const split = ind ? splitIndicatorCode(ind.code) : null;
    const gs = grps.filter((g) => g.target === colTarget(col)).sort((a, b) => a.root.localeCompare(b.root));
    return {
      id: col.id, kind: col.kind, indicatorId: col.indicatorId, code: ind?.code ?? null, standardCode: split?.standard ?? null,
      indicatorCode: split?.indicator ?? null, text: ind?.text ?? null, label: col.label, maxScore: col.maxScore, sort: col.sort,
      collected: gs.length > 0, groups: gs.map((g) => ({ root: g.root, itemTotal: g.t, exams: g.exams })),
    };
  });
  const maxOf = (f: (c: GbColumn) => boolean) => sum(inp.columns.filter(f).map((c) => c.maxScore));
  const planned = new Set(inp.columns.filter((c) => c.kind === 'indicator').map((c) => c.indicatorId));

  return {
    classroom: inp.classroom,
    seatCount,
    columns,
    rows,
    totals: {
      collectMax: maxOf((c) => c.kind !== 'final'), finalMax: maxOf((c) => c.kind === 'final'), max: maxOf(() => true),
      unsetColumns: inp.columns.filter((c) => c.maxScore === null).length,
    },
    unplannedIndicators: [...new Set(grps.filter((g) => g.target !== FINAL && !planned.has(g.target)).map((g) => g.target))].sort(),
    exams: [...inp.exams].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ id, title, purpose, retakeOf, status, createdAt }) => ({ id, title, purpose, retakeOf, status, createdAt })),
    attempts: inp.attempts.filter((a) => inp.exams.some((e) => e.id === a.examId)),
    retakeChoices: inp.retakeChoices,
  };
}

// =====================================================================
// ตรรกะหน้าสมุดคะแนน
// =====================================================================

/** คะแนนขั้นต่ำที่ถือว่าผ่าน = คะแนนเต็ม × เกณฑ์ (report.indicator_pass_ratio) ปัดขึ้นตามความละเอียดของสมุด */
export function passScore(maxScore: number | null, passRatio: number, rounding: GbSettings['rounding']): number | null {
  if (maxScore === null) return null;
  const f = rounding === '1dp' ? 10 : 1;
  return Math.min(maxScore, Math.ceil(Number((maxScore * passRatio * f).toFixed(6))) / f);
}

/** ผลจริง (ไม่นับที่ปรับ) ต่ำกว่าเกณฑ์ = เด็กที่ต้องตามต่อ — ใช้คะแนนจริงก่อนปัด เทียบกับคะแนนเต็ม × เกณฑ์ */
export function belowPass(cell: GbSheetCell, maxScore: number | null, passRatio: number): boolean {
  if (cell.real === null || maxScore === null || maxScore === 0) return false;
  return cell.real < maxScore * passRatio - 1e-9;
}

export interface ColumnStat {
  /** จำนวนคนที่มีคะแนน (value ไม่ว่าง) */
  n: number;
  mean: number | null;
  /** คะแนนจริงต่ำกว่าเกณฑ์ (ยังไม่ได้ปรับ) */
  below: number;
  /** ปรับแล้ว */
  adjusted: number;
  /** มีขาดสอบอย่างน้อย 1 ครั้ง */
  absent: number;
}

export function columnStats(sheet: GbSheet, columnIndex: number, passRatio: number): ColumnStat {
  const col = sheet.columns[columnIndex];
  const cells = sheet.rows.map((r) => r.cells[columnIndex]);
  const vals = cells.map((c) => c.value).filter((v): v is number => v !== null);
  return {
    n: vals.length,
    mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    below: cells.filter((c) => c.adjusted === null && belowPass(c, col.maxScore, passRatio)).length,
    adjusted: cells.filter((c) => c.adjusted !== null).length,
    absent: cells.filter((c) => c.missing.length > 0).length,
  };
}

export interface SeatAttempt {
  examId: string;
  title: string;
  isRetake: boolean;
  createdAt: string;
  correct: number;
  total: number;
  /** ครั้งที่ระบบนับอยู่ตามวิธีนับสอบซ่อม (mean = ทุกครั้งนับ) */
  counted: boolean;
}

export interface SeatGroup {
  root: string;
  rootTitle: string;
  itemTotal: number;
  attempts: SeatAttempt[];
  /** ขาดสอบทั้งกลุ่ม */
  absent: boolean;
  /** ครูเลือกครั้งที่นับไว้ (retake_policy = manual) */
  chosenExamId: string | null;
}

/** รายละเอียดของเลขที่ 1 คน ใน 1 ช่อง: แต่ละกลุ่มการสอบ สอบกี่ครั้ง ได้เท่าไร ครั้งไหนถูกนับ */
export function seatDetail(sheet: GbSheet, columnId: number, seatNo: number): SeatGroup[] {
  const col = sheet.columns.find((c) => c.id === columnId);
  if (!col) return [];
  const ex = new Map(sheet.exams.map((e) => [e.id, e]));
  const policy = sheet.classroom.settings.retake_policy;
  return col.groups.map((g) => {
    const byExam = new Map<string, { c: number; t: number }>();
    for (const a of sheet.attempts) {
      if (a.seatNo !== seatNo || !g.exams.includes(a.examId)) continue;
      const e = ex.get(a.examId);
      if (!e) continue;
      if (col.kind === 'indicator' && a.indicatorId !== col.indicatorId) continue;
      const cur = byExam.get(a.examId) ?? { c: 0, t: 0 };
      cur.c += a.correct; cur.t += a.total;
      byExam.set(a.examId, cur);
    }
    const chosen = sheet.retakeChoices.find((r) => r.rootExamId === g.root && r.seatNo === seatNo)?.chosenExamId ?? null;
    const list = [...byExam.entries()].map(([id, v]) => ({ id, ...v, e: ex.get(id)! }))
      .sort((a, b) => a.e.createdAt.localeCompare(b.e.createdAt) || a.id.localeCompare(b.id));
    let countedId: string | null = null;
    if (list.length && policy !== 'mean') {
      const best = list.reduce((m, x) => (x.c / x.t > m.c / m.t ? x : m), list[0]);
      const latest = [...list].sort((a, b) => b.e.createdAt.localeCompare(a.e.createdAt) || b.id.localeCompare(a.id))[0];
      countedId = policy === 'latest' ? latest.id : policy === 'manual' && chosen && byExam.has(chosen) ? chosen : best.id;
    }
    return {
      root: g.root, rootTitle: ex.get(g.root)?.title ?? 'ชุดที่ลบแล้ว', itemTotal: g.itemTotal, absent: list.length === 0, chosenExamId: chosen,
      attempts: list.map((x) => ({ examId: x.id, title: x.e.title, isRetake: x.e.retakeOf !== null, createdAt: x.e.createdAt,
        correct: x.c, total: x.t, counted: policy === 'mean' || x.id === countedId })),
    };
  });
}

/** ช่องตัวชี้วัด/ปลายภาคที่ตั้งคะแนนแล้วแต่ยังไม่มีผลสอบเลย (เตือนก่อนปิดเทอม) */
export function uncollectedColumns(sheet: GbSheet): GbSheetColumn[] {
  return sheet.columns.filter((c) => c.kind !== 'other' && !c.collected);
}

/** หัวคอลัมน์สั้นสำหรับตาราง */
export function columnHead(c: GbSheetColumn): { top: string; bottom: string } {
  if (c.kind === 'final') return { top: 'สอบ', bottom: 'ปลายภาค' };
  if (c.kind === 'other') return { top: c.label ?? 'ช่องอื่น', bottom: '' };
  return { top: c.standardCode ?? c.code ?? '', bottom: c.indicatorCode ?? '' };
}

/** ตรวจคะแนนที่ครูพิมพ์ปรับ: ว่าง = ยกเลิกการปรับ · 0..คะแนนเต็ม ทศนิยมไม่เกิน 2 ตำแหน่ง */
export function parseAdjust(text: string, maxScore: number | null): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: 'คะแนนต้องเป็นตัวเลข 0 ขึ้นไป (ทศนิยมไม่เกิน 2 ตำแหน่ง)' };
  const v = Number(t);
  if (maxScore !== null && v > maxScore) return { ok: false, error: `คะแนนต้องไม่เกินคะแนนเต็ม ${maxScore}` };
  return { ok: true, value: v };
}
