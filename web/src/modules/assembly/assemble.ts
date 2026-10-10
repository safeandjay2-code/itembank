// อัลกอริทึมประกอบชุดข้อสอบ (SPEC §6) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล ทดสอบได้ด้วยการจำลองจำนวนมาก
//   §6.2 เลือกเฉพาะข้อพร้อมใช้ · ข้อ n น้อยออกก่อน · ผสมข้อยึดค่า (n ≥ เกณฑ์) 20–30% · ทุกชุดใช้ข้อเดียวกัน
//   §6.3 เรียงตามตัวชี้วัด (ลำดับหลักสูตร) → ง่าย→ยาก · สลับข้อเฉพาะในกลุ่มตัวชี้วัด+ระดับ · สลับตัวเลือก (ยกเว้นห้ามสลับ)
//        · เฉลยแต่ละชุดกระจาย 1–4 ใกล้เคียงกัน
//   §6.4 กำหนดชุดตามเลขที่แบบวนรอบ
// ค่าเกณฑ์ทั้งหมดมาจากตารางตั้งค่า (SPEC §3.5)
import type { AssemblyRow, DifficultyLevel, Grade, Indicator, Notice, PoolItem, Settings } from '../../core/types';
import { makeRng, shuffle, type Rng } from './rng';

export const ALGORITHM = 'assembly.v1';
export const OPTION_COUNT = 4;

export interface AssemblyConfig {
  anchorMinN: number;
  anchorRatio: { min: number; max: number };
  preferLowN: boolean;
  maxSets: number;
  maxStudents: number;
  noShuffleWarnRatio: number;
  similarityWarnRatio: number;
  maxAnswerRun: number;
}

export const DEFAULT_CONFIG: AssemblyConfig = {
  anchorMinN: 50, anchorRatio: { min: 0.2, max: 0.3 }, preferLowN: true, maxSets: 10, maxStudents: 60,
  noShuffleWarnRatio: 0.3, similarityWarnRatio: 0.5, maxAnswerRun: 3,
};

export function configFromSettings(s: Settings): AssemblyConfig {
  const num = (k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : d);
  const ratio = s['assembly.anchor_ratio'] as { min?: number; max?: number } | undefined;
  return {
    anchorMinN: num('assembly.anchor_min_n', DEFAULT_CONFIG.anchorMinN),
    anchorRatio: { min: ratio?.min ?? DEFAULT_CONFIG.anchorRatio.min, max: ratio?.max ?? DEFAULT_CONFIG.anchorRatio.max },
    preferLowN: typeof s['assembly.prefer_low_n'] === 'boolean' ? (s['assembly.prefer_low_n'] as boolean) : true,
    maxSets: num('assembly.max_sets', DEFAULT_CONFIG.maxSets),
    maxStudents: num('assembly.max_students', DEFAULT_CONFIG.maxStudents),
    noShuffleWarnRatio: num('assembly.no_shuffle_warn_ratio', DEFAULT_CONFIG.noShuffleWarnRatio),
    similarityWarnRatio: num('assembly.similarity_warn_ratio', DEFAULT_CONFIG.similarityWarnRatio),
    maxAnswerRun: num('assembly.max_answer_run', DEFAULT_CONFIG.maxAnswerRun),
  };
}

/** ลำดับหลักสูตร: ตัวชี้วัด (ชั้น → ลำดับในหลักสูตร) และความยาก (ง่าย → ท้าทาย ตามเส้นแบ่ง p จากมาก → น้อย) */
export interface Ordering {
  indicatorRank: Map<string, number>;
  difficultyRank: Map<number, number>;
}

export function makeOrdering(indicators: Indicator[], grades: Grade[], difficulties: DifficultyLevel[]): Ordering {
  const gs = new Map(grades.map((g) => [g.id, g.sort]));
  const inds = indicators.slice().sort((a, b) => (gs.get(a.gradeId) ?? 0) - (gs.get(b.gradeId) ?? 0) || a.sort - b.sort);
  const ds = difficulties.slice().sort((a, b) => b.pLower - a.pLower || a.id - b.id);
  return {
    indicatorRank: new Map(inds.map((i, k) => [i.id, k])),
    difficultyRank: new Map(ds.map((d, k) => [d.id, k])),
  };
}

export interface Names { indicator: (id: string) => string; difficulty: (id: number) => string }
const plainNames: Names = { indicator: (id) => id, difficulty: (id) => `ระดับ ${id}` };

export interface AssemblyRequest {
  gradeId: string;
  itemCount: number;
  setCount: number;
  studentCount: number;
  rows: AssemblyRow[];
}

export const cellKey = (indicatorId: string, difficulty: number) => `${indicatorId}|${difficulty}`;

export function isAnchor(item: PoolItem, cfg: AssemblyConfig): boolean {
  return item.n >= cfg.anchorMinN;
}

/** รวมแถวที่เลือกตัวชี้วัด+ระดับเดียวกัน */
export function mergeRows(rows: AssemblyRow[]): AssemblyRow[] {
  const m = new Map<string, AssemblyRow>();
  for (const r of rows) {
    if (!r.indicatorId || !r.difficulty || !(r.count > 0)) continue;
    const k = cellKey(r.indicatorId, r.difficulty);
    const cur = m.get(k);
    if (cur) cur.count += r.count; else m.set(k, { ...r });
  }
  return [...m.values()];
}

export interface CellInfo {
  key: string;
  indicatorId: string;
  difficulty: number;
  requested: number;
  available: number;
  anchors: number;
}

export interface RequestCheck {
  errors: Notice[];
  cells: CellInfo[];
  selected: number;
  ready: boolean;
}

/** สรุปจำนวนข้อพร้อมใช้ในคลังต่อช่อง (ตัวชี้วัด × ระดับ) */
export function poolByCell(pool: PoolItem[]): Map<string, PoolItem[]> {
  const m = new Map<string, PoolItem[]>();
  for (const p of pool) {
    const k = cellKey(p.indicatorId, p.difficulty);
    const arr = m.get(k);
    if (arr) arr.push(p); else m.set(k, [p]);
  }
  return m;
}

const isInt = (v: number) => Number.isInteger(v);

/** ตรวจคำขอก่อนสร้าง (ปุ่ม "สร้างข้อสอบ" กดได้เมื่อไม่มีข้อผิดพลาดเท่านั้น — SPEC §6.1 ข้อ 4) */
export function checkRequest(req: AssemblyRequest, pool: PoolItem[], cfg: AssemblyConfig, names: Names = plainNames): RequestCheck {
  const errors: Notice[] = [];
  if (!isInt(req.itemCount) || req.itemCount < 1) errors.push({ code: 'item_count', message: 'ระบุจำนวนข้ออย่างน้อย 1 ข้อ' });
  if (!isInt(req.setCount) || req.setCount < 1 || req.setCount > cfg.maxSets)
    errors.push({ code: 'set_count', message: `จำนวนชุดต้องอยู่ระหว่าง 1–${cfg.maxSets}` });
  if (!isInt(req.studentCount) || req.studentCount < 1 || req.studentCount > cfg.maxStudents)
    errors.push({ code: 'student_count', message: `จำนวนนักเรียนต้องอยู่ระหว่าง 1–${cfg.maxStudents}` });
  if (req.rows.some((r) => !r.indicatorId || !r.difficulty))
    errors.push({ code: 'row_incomplete', message: 'มีแถวที่ยังไม่ได้เลือกตัวชี้วัดหรือระดับ' });
  if (req.rows.some((r) => !isInt(r.count) || r.count < 1))
    errors.push({ code: 'row_count', message: 'จำนวนข้อในแต่ละแถวต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' });
  const byCell = poolByCell(pool);
  const cells: CellInfo[] = mergeRows(req.rows).map((r) => {
    const avail = byCell.get(cellKey(r.indicatorId, r.difficulty)) ?? [];
    return { key: cellKey(r.indicatorId, r.difficulty), indicatorId: r.indicatorId, difficulty: r.difficulty,
      requested: r.count, available: avail.length, anchors: avail.filter((p) => isAnchor(p, cfg)).length };
  });
  for (const c of cells)
    if (c.requested > c.available)
      errors.push({ code: 'shortage', message: `${names.indicator(c.indicatorId)} ${names.difficulty(c.difficulty)}: ขอ ${c.requested} ข้อ แต่มีในคลังเพียง ${c.available} ข้อ` });
  const selected = cells.reduce((a, c) => a + c.requested, 0);
  if (!cells.length) errors.push({ code: 'no_rows', message: 'ยังไม่ได้เลือกตัวชี้วัด' });
  else if (isInt(req.itemCount) && req.itemCount >= 1 && selected !== req.itemCount)
    errors.push({ code: 'count_mismatch', message: selected < req.itemCount
      ? `เลือกแล้ว ${selected} จาก ${req.itemCount} ข้อ — ต้องเลือกอีก ${req.itemCount - selected} ข้อ`
      : `เลือกแล้ว ${selected} ข้อ เกินจำนวนข้อที่ตั้งไว้ ${req.itemCount} ข้อ` });
  return { errors, cells, selected, ready: errors.length === 0 };
}

/** ช่วงจำนวนข้อยึดค่าที่ต้องการ: lo–hi จากสัดส่วน 20–30%, target = กลางช่วง */
export function anchorRange(itemCount: number, cfg: AssemblyConfig) {
  const lo = Math.ceil(cfg.anchorRatio.min * itemCount - 1e-9);
  const hi = Math.floor(cfg.anchorRatio.max * itemCount + 1e-9);
  let target = Math.round(((cfg.anchorRatio.min + cfg.anchorRatio.max) / 2) * itemCount);
  if (lo <= hi) target = Math.min(hi, Math.max(lo, target));
  return { lo, hi, target, rangeExists: lo <= hi };
}

/** จำนวนข้อยึดค่าต่อช่อง: บังคับขั้นต่ำเมื่อข้อ n น้อยไม่พอ แล้วกระจายส่วนที่เหลือตามสัดส่วนจำนวนข้อที่ขอ */
export function allocateAnchors(cells: Array<{ key: string; requested: number; anchors: number; lowN: number }>, target: number, rng: Rng) {
  const alloc = new Map<string, number>();
  const max = new Map<string, number>();
  let forced = 0, cap = 0;
  for (const c of cells) {
    const f = Math.max(0, c.requested - c.lowN);
    alloc.set(c.key, f);
    max.set(c.key, Math.min(c.requested, c.anchors));
    forced += f; cap += Math.min(c.requested, c.anchors);
  }
  const goal = Math.min(cap, Math.max(forced, target));
  const totalReq = cells.reduce((a, c) => a + c.requested, 0);
  let remaining = goal - forced;
  while (remaining > 0) {
    // ช่องที่ยังรับข้อยึดค่าเพิ่มได้ เรียงตาม "ขาดจากส่วนแบ่งตามสัดส่วน" มากสุดก่อน (สุ่มเมื่อเท่ากัน)
    const open = shuffle(cells.filter((c) => alloc.get(c.key)! < max.get(c.key)!), rng);
    const deficit = (c: { key: string; requested: number }) => (c.requested / totalReq) * goal - alloc.get(c.key)!;
    open.sort((a, b) => deficit(b) - deficit(a));
    alloc.set(open[0].key, alloc.get(open[0].key)! + 1);
    remaining -= 1;
  }
  return { alloc, goal, forced, cap };
}

/** การกระจายเฉลยที่ดีที่สุดเท่าที่ทำได้ เมื่อมีข้อห้ามสลับ (fixed) และข้อสลับได้ m ข้อ → ค่าต่างสูงสุด−ต่ำสุด */
export function optimalSpread(fixed: number[], m: number): number {
  const c = fixed.slice();
  for (let k = 0; k < m; k++) c[c.indexOf(Math.min(...c))] += 1;
  return Math.max(...c) - Math.min(...c);
}

export function answerCounts(key: number[]): number[] {
  const c = Array(OPTION_COUNT).fill(0);
  key.forEach((k) => { c[k - 1] += 1; });
  return c;
}

export function longestRun(key: number[]): number {
  let best = 0, run = 0;
  key.forEach((k, i) => { run = i > 0 && key[i - 1] === k ? run + 1 : 1; best = Math.max(best, run); });
  return best;
}

export interface PlanItem { item: PoolItem; basePosition: number; isAnchor: boolean; group: string }
export interface PlanEntry { itemId: string; optionOrder: number[]; key: number }
export interface PlanSet { setNo: number; entries: PlanEntry[]; counts: number[] }

export interface ExamPlan {
  algorithm: string;
  seed: number;
  items: PlanItem[];
  sets: PlanSet[];
  seats: Array<{ seatNo: number; setNo: number }>;
  anchorCount: number;
  anchorTarget: number;
  anchorLo: number;
  anchorHi: number;
  similarity: number;
  warnings: Notice[];
  infos: Notice[];
}

/** สัดส่วนตำแหน่งที่ 2 ชุดแสดงข้อเดียวกันและเฉลยตำแหน่งเดียวกัน (ยิ่งน้อย ยิ่งกันลอกได้ดี) */
export function setSimilarity(a: PlanEntry[], b: PlanEntry[]): number {
  if (!a.length) return 0;
  let same = 0;
  a.forEach((e, i) => { if (e.itemId === b[i].itemId && e.key === b[i].key) same += 1; });
  return same / a.length;
}

/** ชุดของเลขที่: วนรอบ 1,2,…,S,1,2,… ให้คนนั่งติดกันได้คนละชุด */
export function seatSet(seatNo: number, setCount: number): number {
  return ((seatNo - 1) % setCount) + 1;
}

function randomPermWith(answer: number, target: number, rng: Rng): number[] {
  const others = shuffle([1, 2, 3, 4].filter((o) => o !== answer), rng);
  const perm: number[] = [];
  for (let pos = 1; pos <= OPTION_COUNT; pos++) perm.push(pos === target ? answer : others.shift()!);
  return perm;
}

const CANDIDATES_PER_SET = 16;
const RUN_RETRIES = 40;

export function buildPlan(req: AssemblyRequest, pool: PoolItem[], cfg: AssemblyConfig, ordering: Ordering,
  seed: number, names: Names = plainNames): ExamPlan {
  const check = checkRequest(req, pool, cfg, names);
  if (!check.ready) throw new Error(check.errors.map((e) => e.message).join(' · '));
  const rng = makeRng(seed);
  const warnings: Notice[] = [], infos: Notice[] = [];
  const N = req.itemCount, S = req.setCount;
  const byCell = poolByCell(pool);

  // ---------- 1) เลือกข้อ (§6.2) ----------
  const cellPools = check.cells.map((c) => {
    const items = byCell.get(c.key)!;
    return { ...c, anchorItems: items.filter((p) => isAnchor(p, cfg)), lowItems: items.filter((p) => !isAnchor(p, cfg)) };
  });
  const range = anchorRange(N, cfg);
  const { alloc } = allocateAnchors(cellPools.map((c) => ({ key: c.key, requested: c.requested, anchors: c.anchorItems.length, lowN: c.lowItems.length })),
    range.target, rng);
  const chosen: PlanItem[] = [];
  for (const c of cellPools) {
    const a = alloc.get(c.key)!;
    const anchors = shuffle(c.anchorItems, rng).slice(0, a);
    // ข้อ n น้อยออกก่อน (เท่ากันให้สุ่ม) — ถ้าปิด prefer_low_n ใช้การสุ่มล้วน
    const low = shuffle(c.lowItems, rng);
    if (cfg.preferLowN) low.sort((x, y) => x.n - y.n);
    const lows = low.slice(0, c.requested - a);
    for (const it of [...anchors, ...lows]) chosen.push({ item: it, basePosition: 0, isAnchor: isAnchor(it, cfg), group: c.key });
  }
  const anchorCount = chosen.filter((c) => c.isAnchor).length;
  const anchorsInCells = cellPools.reduce((s, c) => s + c.anchorItems.length, 0);
  if (anchorsInCells === 0)
    infos.push({ code: 'no_anchor', message: `ยังไม่มีข้อยึดค่า (n ≥ ${cfg.anchorMinN}) ในตัวชี้วัด/ระดับที่เลือก จึงใช้ข้อ n น้อยทั้งหมด` });
  else if (range.rangeExists && anchorCount < range.lo)
    warnings.push({ code: 'anchor_short', message: `ข้อยึดค่ามีไม่พอ ได้ ${anchorCount} ข้อ (ควรมี ${range.lo}–${range.hi} ข้อ หรือ ${Math.round(cfg.anchorRatio.min * 100)}–${Math.round(cfg.anchorRatio.max * 100)}%)` });
  if (range.rangeExists && anchorCount > range.hi)
    warnings.push({ code: 'anchor_excess', message: `ข้อยึดค่าเกินสัดส่วน ${anchorCount} ข้อ (ควรไม่เกิน ${range.hi} ข้อ) เพราะข้อ n น้อยในบางตัวชี้วัด/ระดับมีไม่พอ` });

  // ---------- 2) ลำดับมาตรฐาน (§6.3 ข้อ 1–2) ----------
  const iRank = (id: string) => ordering.indicatorRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const dRank = (id: number) => ordering.difficultyRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  chosen.sort((a, b) => iRank(a.item.indicatorId) - iRank(b.item.indicatorId) || dRank(a.item.difficulty) - dRank(b.item.difficulty)
    || a.item.itemCode.localeCompare(b.item.itemCode));
  chosen.forEach((c, i) => { c.basePosition = i + 1; });
  const groups: PlanItem[][] = [];
  for (const c of chosen) {
    const last = groups[groups.length - 1];
    if (last && last[0].group === c.group) last.push(c); else groups.push([c]);
  }

  // ---------- 3) ชุดที่ 1..S: สลับข้อในกลุ่ม + สลับตัวเลือก + สมดุลเฉลย (§6.3 ข้อ 3–5) ----------
  const fixed = Array(OPTION_COUNT).fill(0);
  chosen.filter((c) => c.item.noShuffle).forEach((c) => { fixed[c.item.answer - 1] += 1; });
  const m = chosen.filter((c) => !c.item.noShuffle).length;
  const best = optimalSpread(fixed, m);

  function targetsMultiset(): number[] {
    const counts = fixed.slice();
    const out: number[] = [];
    for (let k = 0; k < m; k++) {
      const min = Math.min(...counts);
      const opts = counts.map((v, i) => (v === min ? i : -1)).filter((i) => i >= 0);
      const pick = opts[Math.floor(rng() * opts.length)];
      counts[pick] += 1;
      out.push(pick + 1);
    }
    return out;
  }

  function candidate(): PlanSet {
    const order = groups.flatMap((g) => (g.length >= 2 ? shuffle(g, rng) : g));
    let bestKey: { entries: PlanEntry[]; run: number } | null = null;
    for (let t = 0; t < RUN_RETRIES; t++) {
      const targets = shuffle(targetsMultiset(), rng);
      const entries = order.map((c) => {
        if (c.item.noShuffle) return { itemId: c.item.id, optionOrder: [1, 2, 3, 4], key: c.item.answer };
        const target = targets.pop()!;
        return { itemId: c.item.id, optionOrder: randomPermWith(c.item.answer, target, rng), key: target };
      });
      const run = longestRun(entries.map((e) => e.key));
      if (!bestKey || run < bestKey.run) bestKey = { entries, run };
      if (run <= cfg.maxAnswerRun) break;
    }
    const entries = bestKey!.entries;
    return { setNo: 0, entries, counts: answerCounts(entries.map((e) => e.key)) };
  }

  const sets: PlanSet[] = [];
  for (let s = 1; s <= S; s++) {
    let pick: PlanSet | null = null, pickScore = Infinity;
    const tries = s === 1 ? 1 : CANDIDATES_PER_SET;
    for (let t = 0; t < tries; t++) {
      const cand = candidate();
      const run = longestRun(cand.entries.map((e) => e.key));
      const sim = Math.max(0, ...sets.map((p) => setSimilarity(p.entries, cand.entries)));
      const score = (run > cfg.maxAnswerRun ? 1 : 0) * 10 + sim;
      if (score < pickScore) { pick = cand; pickScore = score; }
    }
    pick!.setNo = s;
    sets.push(pick!);
  }

  // ---------- 4) กำหนดชุดตามเลขที่ (§6.4) ----------
  const seats = Array.from({ length: req.studentCount }, (_, i) => ({ seatNo: i + 1, setNo: seatSet(i + 1, S) }));

  // ---------- 5) คำเตือน ----------
  let similarity = 0;
  for (let a = 0; a < sets.length; a++)
    for (let b = a + 1; b < sets.length; b++) similarity = Math.max(similarity, setSimilarity(sets[a].entries, sets[b].entries));
  const noShuffleCount = N - m;
  if (S > 1 && noShuffleCount / N > cfg.noShuffleWarnRatio)
    warnings.push({ code: 'many_no_shuffle', message: `มีข้อห้ามสลับตัวเลือก ${noShuffleCount} จาก ${N} ข้อ (${Math.round((noShuffleCount / N) * 100)}%) ชุดต่าง ๆ จึงกันลอกได้น้อยลง` });
  if (best > 1)
    warnings.push({ code: 'unbalanced', message: `เฉลยกระจาย 1–4 ได้ไม่สมดุล (ต่างกันสูงสุด ${best} ข้อ) เพราะข้อห้ามสลับตัวเลือกมีเฉลยซ้ำตำแหน่งกันมาก` });
  if (S > 1 && groups.every((g) => g.length === 1))
    infos.push({ code: 'fixed_order', message: 'ลำดับข้อเหมือนกันทุกชุด เพราะแต่ละกลุ่มตัวชี้วัด+ระดับมีเพียง 1 ข้อ — ชุดต่างกันที่ลำดับตัวเลือก' });
  if (S > 1 && similarity > cfg.similarityWarnRatio)
    warnings.push({ code: 'similar_sets', message: `บางชุดคล้ายกันมาก: ข้อและเฉลยตรงตำแหน่งกัน ${Math.round(similarity * 100)}% ของข้อ` });
  if (req.studentCount < S)
    warnings.push({ code: 'few_students', message: `นักเรียน ${req.studentCount} คน น้อยกว่าจำนวนชุด ${S} ชุด บางชุดจะไม่มีคนใช้` });
  const runs = sets.filter((s) => longestRun(s.entries.map((e) => e.key)) > cfg.maxAnswerRun);
  if (runs.length)
    infos.push({ code: 'long_run', message: `ชุดที่ ${runs.map((s) => s.setNo).join(', ')} มีเฉลยตัวเลือกเดียวกันติดกันเกิน ${cfg.maxAnswerRun} ข้อ (หลีกเลี่ยงไม่ได้จากข้อห้ามสลับ)` });

  return { algorithm: ALGORITHM, seed, items: chosen, sets, seats, anchorCount, anchorTarget: range.target,
    anchorLo: range.lo, anchorHi: range.hi, similarity, warnings, infos };
}
