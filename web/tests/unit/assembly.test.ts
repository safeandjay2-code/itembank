// เฟส 3: จำลองสร้างชุดข้อสอบ 1,000 ครั้งด้วยคำขอและคลังแบบสุ่ม แล้วตรวจทุกกฎใน SPEC §6 ด้วยตัวตรวจอิสระ
import { describe, expect, it } from 'vitest';
import curriculum from '../../../data/curriculum/math_2560_terminal_p4_p6.json';
import levels from '../../../data/levels.json';
import { buildIndicators } from '../../src/data/memoryRepo';
import type { AssemblyRow, PoolItem } from '../../src/core/types';
import {
  DEFAULT_CONFIG, anchorRange, buildPlan, checkRequest, configFromSettings, longestRun, makeOrdering, optimalSpread,
  seatSet, setSimilarity, type AssemblyConfig, type AssemblyRequest,
} from '../../src/modules/assembly/assemble';
import { bestSpread, validatePlan } from '../../src/modules/assembly/validate';
import { makeRng, shuffle, type Rng } from '../../src/modules/assembly/rng';

const indicators = buildIndicators();
const grades = curriculum.grades.map((g: any) => ({ id: g.id, nameTh: g.name_th, shortTh: g.short_th, sort: g.sort }));
const diffs = levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));
const ordering = makeOrdering(indicators, grades, diffs);
const cfg = DEFAULT_CONFIG;

/** คลังจำลอง: ทุกช่องมี 0–12 ข้อ ค่า n สุ่ม (บางข้อถึงเกณฑ์ยึดค่า) บางข้อห้ามสลับ */
function makePool(rng: Rng, opts: { anchorRate?: number; noShuffleRate?: number; perCell?: [number, number] } = {}): PoolItem[] {
  const { anchorRate = 0.3, noShuffleRate = 0.1, perCell = [0, 12] } = opts;
  const pool: PoolItem[] = [];
  let seq = 0;
  for (const ind of indicators)
    for (const d of diffs) {
      const k = perCell[0] + Math.floor(rng() * (perCell[1] - perCell[0] + 1));
      for (let j = 0; j < k; j++) {
        seq += 1;
        const anchor = rng() < anchorRate;
        pool.push({
          id: `id-${seq}`, itemCode: `M-${String(seq).padStart(6, '0')}`, indicatorId: ind.id, difficulty: d.id, version: 1,
          n: anchor ? 50 + Math.floor(rng() * 300) : Math.floor(rng() * 50), noShuffle: rng() < noShuffleRate,
          answer: 1 + Math.floor(rng() * 4), isSample: false,
        });
      }
    }
  return pool;
}

/** คำขอสุ่มที่ทำได้จริงจากคลัง */
function makeRequest(rng: Rng, pool: PoolItem[]): AssemblyRequest {
  const grade = grades[Math.floor(rng() * grades.length)];
  const cells = new Map<string, PoolItem[]>();
  pool.filter((p) => indicators.find((i) => i.id === p.indicatorId)!.gradeId === grade.id || rng() < 0.03)
    .forEach((p) => { const k = `${p.indicatorId}|${p.difficulty}`; cells.set(k, [...(cells.get(k) ?? []), p]); });
  const keys = shuffle([...cells.keys()], rng).slice(0, 1 + Math.floor(rng() * 16));
  const rows: AssemblyRow[] = keys.map((k) => {
    const [indicatorId, d] = k.split('|');
    const avail = cells.get(k)!.length;
    return { indicatorId, difficulty: Number(d), count: 1 + Math.floor(rng() * avail) };
  });
  // บางครั้งแยกแถวเดียวกันเป็น 2 แถว (ผู้ใช้เลือกซ้ำ) — ต้องรวมกันได้
  if (rows.length && rows[0].count >= 2 && rng() < 0.2) { rows[0].count -= 1; rows.push({ ...rows[0], count: 1 }); }
  const itemCount = rows.reduce((a, r) => a + r.count, 0);
  return { gradeId: grade.id, itemCount, setCount: 1 + Math.floor(rng() * cfg.maxSets), studentCount: 1 + Math.floor(rng() * cfg.maxStudents), rows };
}

describe('จำลองสร้าง 1,000 ชุด — ทุกกฎ §6 ต้องผ่าน', () => {
  it('1,000 ครั้ง คลังและคำขอสุ่ม', () => {
    const rng = makeRng(20261010);
    const stats = { builds: 0, items: 0, sets: 0, anchorsUsed: 0, keyPos: [0, 0, 0, 0], differentOrder: 0 };
    for (let t = 0; t < 1000; t++) {
      const variant = t % 5;
      const pool = makePool(rng, variant === 0 ? { anchorRate: 0 } : variant === 1 ? { anchorRate: 0.9 }
        : variant === 2 ? { noShuffleRate: 0.6 } : variant === 3 ? { perCell: [1, 3] } : {});
      const req = makeRequest(rng, pool);
      if (!req.rows.length) continue;
      const plan = buildPlan(req, pool, cfg, ordering, Math.floor(rng() * 2 ** 31));
      const violations = validatePlan(plan, req, pool, cfg, ordering);
      expect(violations, `build ${t} seed ${plan.seed}`).toEqual([]);
      stats.builds += 1; stats.items += plan.items.length; stats.sets += plan.sets.length; stats.anchorsUsed += plan.anchorCount;
      // สถิติการสลับ: กลุ่มที่มี ≥2 ข้อ ลำดับต่างจากลำดับมาตรฐานบ่อยแค่ไหน
      const base = plan.items.map((x) => x.item.id);
      for (const s of plan.sets) {
        s.entries.forEach((e) => { if (!pool.find((p) => p.id === e.itemId)!.noShuffle) stats.keyPos[e.key - 1] += 1; });
        if (s.entries.some((e, i) => e.itemId !== base[i])) stats.differentOrder += 1;
      }
    }
    expect(stats.builds).toBeGreaterThan(950);
    expect(stats.anchorsUsed).toBeGreaterThan(0);
    expect(stats.differentOrder / stats.sets).toBeGreaterThan(0.5);
    // ตำแหน่งเฉลยของข้อที่สลับได้กระจายทั้ง 4 ตำแหน่งใกล้เคียงกัน (±5%)
    const total = stats.keyPos.reduce((a, b) => a + b, 0);
    stats.keyPos.forEach((c) => expect(Math.abs(c / total - 0.25)).toBeLessThan(0.05));
    console.log('สรุปการจำลอง', JSON.stringify(stats));
  });

  it('สร้างซ้ำด้วยเมล็ดเดิมได้ผลเดิม', () => {
    const pool = makePool(makeRng(1));
    const req = makeRequest(makeRng(2), pool);
    const a = buildPlan(req, pool, cfg, ordering, 777), b = buildPlan(req, pool, cfg, ordering, 777);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = buildPlan(req, pool, cfg, ordering, 778);
    expect(JSON.stringify(c.sets)).not.toBe(JSON.stringify(a.sets));
  });
});

// คลังเล็กที่ควบคุมได้: ตัวชี้วัด 2 ตัวแรกของ ป.4, ทุกระดับ
const ind1 = indicators.filter((i) => i.gradeId === 'P4')[0], ind2 = indicators.filter((i) => i.gradeId === 'P4')[1];
function item(id: string, ind: string, d: number, n: number, answer = 1, noShuffle = false): PoolItem {
  return { id, itemCode: `M-${id.padStart(6, '0')}`, indicatorId: ind, difficulty: d, version: 1, n, noShuffle, answer, isSample: false };
}
const req = (rows: AssemblyRow[], extra: Partial<AssemblyRequest> = {}): AssemblyRequest =>
  ({ gradeId: 'P4', itemCount: rows.reduce((a, r) => a + r.count, 0), setCount: 3, studentCount: 30, rows, ...extra });

describe('ตรวจคำขอ (§6.1)', () => {
  const pool = [item('1', ind1.id, 1, 0), item('2', ind1.id, 1, 3), item('3', ind1.id, 2, 0)];
  it('ขอเกินจำนวนในคลัง → เตือนและสร้างไม่ได้', () => {
    const c = checkRequest(req([{ indicatorId: ind1.id, difficulty: 1, count: 3 }]), pool, cfg, { indicator: () => 'ค 1.1 ป.4/2', difficulty: () => 'ง่าย' });
    expect(c.ready).toBe(false);
    expect(c.errors.map((e) => e.message)).toContain('ค 1.1 ป.4/2 ง่าย: ขอ 3 ข้อ แต่มีในคลังเพียง 2 ข้อ');
    expect(() => buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 3 }]), pool, cfg, ordering, 1)).toThrow(/มีในคลังเพียง 2 ข้อ/);
  });
  it('ต้องเลือกครบพอดี', () => {
    const c = checkRequest(req([{ indicatorId: ind1.id, difficulty: 1, count: 1 }], { itemCount: 2 }), pool, cfg);
    expect(c.selected).toBe(1);
    expect(c.errors.map((e) => e.code)).toEqual(['count_mismatch']);
    expect(c.errors[0].message).toBe('เลือกแล้ว 1 จาก 2 ข้อ — ต้องเลือกอีก 1 ข้อ');
    const over = checkRequest(req([{ indicatorId: ind1.id, difficulty: 1, count: 2 }], { itemCount: 1 }), pool, cfg);
    expect(over.errors[0].message).toMatch(/เกินจำนวนข้อ/);
  });
  it('แถวซ้ำรวมกัน และตรวจกับจำนวนรวม', () => {
    const c = checkRequest(req([{ indicatorId: ind1.id, difficulty: 1, count: 1 }, { indicatorId: ind1.id, difficulty: 1, count: 2 }]), pool, cfg);
    expect(c.cells).toHaveLength(1);
    expect(c.errors.map((e) => e.code)).toEqual(['shortage']);
  });
  it('จำนวนชุด/นักเรียน/แถวไม่ครบ', () => {
    const c = checkRequest(req([{ indicatorId: '', difficulty: 1, count: 1 }], { setCount: 11, studentCount: 0 }), pool, cfg);
    expect(c.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['set_count', 'student_count', 'row_incomplete']));
  });
});

describe('เลือกข้อ (§6.2)', () => {
  it('n น้อยออกก่อน', () => {
    const pool = [item('1', ind1.id, 1, 40), item('2', ind1.id, 1, 2), item('3', ind1.id, 1, 9), item('4', ind1.id, 1, 0)];
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 2 }]), pool, { ...cfg, anchorRatio: { min: 0, max: 0 } }, ordering, 5);
    expect(p.items.map((x) => x.item.n).sort((a, b) => a - b)).toEqual([0, 2]);
  });
  it('ข้อยึดค่า 20–30% เมื่อมีพอ', () => {
    const pool: PoolItem[] = [];
    for (let k = 0; k < 20; k++) pool.push(item(`a${k}`, ind1.id, 1, 60 + k), item(`l${k}`, ind1.id, 1, k));
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 20 }]), pool, cfg, ordering, 9);
    expect(p.anchorCount).toBe(5); // 25% ของ 20
    expect(p.items.filter((x) => !x.isAnchor).map((x) => x.item.n).sort((a, b) => a - b)).toEqual([...Array(15).keys()]);
    expect(p.warnings).toEqual([]);
  });
  it('ยังไม่มีข้อยึดค่า → ใช้ข้อ n น้อยทั้งหมด และแจ้งให้ทราบ', () => {
    const pool = [item('1', ind1.id, 1, 0), item('2', ind1.id, 1, 1)];
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 2 }]), pool, cfg, ordering, 1);
    expect(p.anchorCount).toBe(0);
    expect(p.infos.map((i) => i.code)).toContain('no_anchor');
  });
  it('ข้อยึดค่ามีไม่พอ → เตือน', () => {
    const pool: PoolItem[] = [item('a', ind1.id, 1, 80)];
    for (let k = 0; k < 20; k++) pool.push(item(`l${k}`, ind1.id, 1, k));
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 20 }]), pool, cfg, ordering, 1);
    expect(p.anchorCount).toBe(1);
    expect(p.warnings.map((w) => w.code)).toContain('anchor_short');
  });
  it('ข้อ n น้อยไม่พอ → ใช้ข้อยึดค่าแทนและเตือนว่าเกินสัดส่วน', () => {
    const pool = [item('l', ind1.id, 1, 0), ...Array.from({ length: 9 }, (_, k) => item(`a${k}`, ind1.id, 1, 70))];
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 10 }]), pool, cfg, ordering, 1);
    expect(p.anchorCount).toBe(9);
    expect(p.warnings.map((w) => w.code)).toContain('anchor_excess');
  });
  it('ช่วงข้อยึดค่า', () => {
    expect(anchorRange(30, cfg)).toMatchObject({ lo: 6, hi: 9, target: 8 });
    expect(anchorRange(20, cfg)).toMatchObject({ lo: 4, hi: 6, target: 5 });
    expect(anchorRange(3, cfg)).toMatchObject({ rangeExists: false, target: 1 });
  });
});

describe('เรียง สลับ และสมดุลเฉลย (§6.3)', () => {
  const pool = [
    item('11', ind2.id, 3, 0), item('12', ind2.id, 3, 0), item('13', ind2.id, 1, 0),
    item('21', ind1.id, 4, 0), item('22', ind1.id, 1, 0), item('23', ind1.id, 1, 0), item('24', ind1.id, 1, 0),
    item('31', ind1.id, 2, 0, 3, true),
  ];
  const rows = [{ indicatorId: ind2.id, difficulty: 3, count: 2 }, { indicatorId: ind2.id, difficulty: 1, count: 1 },
    { indicatorId: ind1.id, difficulty: 4, count: 1 }, { indicatorId: ind1.id, difficulty: 1, count: 3 }, { indicatorId: ind1.id, difficulty: 2, count: 1 }];
  it('ตัวชี้วัดตามหลักสูตร แล้วง่าย→ท้าทาย', () => {
    const p = buildPlan(req(rows), pool, cfg, ordering, 3);
    const base = p.items.map((x) => `${x.item.indicatorId === ind1.id ? 'A' : 'B'}${x.item.difficulty}`);
    expect(base).toEqual(['A1', 'A1', 'A1', 'A2', 'A4', 'B1', 'B3', 'B3']);
    for (const s of p.sets) {
      const seq = s.entries.map((e) => { const it = pool.find((x) => x.id === e.itemId)!; return `${it.indicatorId === ind1.id ? 'A' : 'B'}${it.difficulty}`; });
      expect(seq).toEqual(base);
    }
  });
  it('ข้อห้ามสลับคงตัวเลือกเดิมทุกชุด', () => {
    const p = buildPlan(req(rows, { setCount: 10 }), pool, cfg, ordering, 4);
    for (const s of p.sets) {
      const e = s.entries.find((x) => x.itemId === '31')!;
      expect(e.optionOrder).toEqual([1, 2, 3, 4]);
      expect(e.key).toBe(3);
    }
  });
  it('สลับภายในกลุ่มเกิดขึ้นจริง', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const p = buildPlan(req(rows, { setCount: 1 }), pool, cfg, ordering, s);
      seen.add(p.sets[0].entries.slice(0, 3).map((e) => e.itemId).join(','));
    }
    expect(seen.size).toBe(6); // 3! แบบ
  });
  it('สมดุลเฉลย: 40 ข้อ ไม่มีห้ามสลับ → ชุดละ 10/10/10/10', () => {
    const big: PoolItem[] = Array.from({ length: 40 }, (_, k) => item(`b${k}`, ind1.id, 1, 0, 1));
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 40 }], { setCount: 4 }), big, cfg, ordering, 8);
    p.sets.forEach((s) => expect(s.counts).toEqual([10, 10, 10, 10]));
    p.sets.forEach((s) => expect(longestRun(s.entries.map((e) => e.key))).toBeLessThanOrEqual(cfg.maxAnswerRun));
  });
  it('ข้อห้ามสลับมาก → เตือนกันลอกได้น้อยลง และเตือนเฉลยเอียงเมื่อเลี่ยงไม่ได้', () => {
    const big: PoolItem[] = Array.from({ length: 10 }, (_, k) => item(`c${k}`, ind1.id, 1, 0, 2, k < 6));
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 10 }], { setCount: 2 }), big, cfg, ordering, 2);
    const codes = p.warnings.map((w) => w.code);
    expect(codes).toContain('many_no_shuffle');
    expect(codes).toContain('unbalanced');
    p.sets.forEach((s) => { expect(s.counts[1]).toBe(6); expect(s.counts.slice().sort()).toEqual([1, 1, 2, 6]); });
    expect(validatePlan(p, req([{ indicatorId: ind1.id, difficulty: 1, count: 10 }], { setCount: 2 }), big, cfg, ordering)).toEqual([]);
  });
  it('แต่ละกลุ่มมีข้อเดียว → แจ้งว่าลำดับข้อเหมือนกันทุกชุด', () => {
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 1 }, { indicatorId: ind1.id, difficulty: 2, count: 1 }]),
      [item('x', ind1.id, 1, 0), item('y', ind1.id, 2, 0)], cfg, ordering, 1);
    expect(p.infos.map((i) => i.code)).toContain('fixed_order');
  });
});

describe('กำหนดชุดตามเลขที่ (§6.4)', () => {
  it('วนชุดไล่เลขที่', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((s) => seatSet(s, 3))).toEqual([1, 2, 3, 1, 2, 3, 1]);
    const p = buildPlan(req([{ indicatorId: ind1.id, difficulty: 1, count: 1 }], { setCount: 4, studentCount: 2 }), [item('x', ind1.id, 1, 0)], cfg, ordering, 1);
    expect(p.seats).toEqual([{ seatNo: 1, setNo: 1 }, { seatNo: 2, setNo: 2 }]);
    expect(p.warnings.map((w) => w.code)).toContain('few_students');
  });
});

describe('ตัวช่วย', () => {
  it('สมดุลที่ดีที่สุด: สูตรปิดของตัวตรวจ = การเติมทีละข้อของตัวสร้าง', () => {
    const rng = makeRng(42);
    for (let t = 0; t < 2000; t++) {
      const f = [0, 0, 0, 0].map(() => Math.floor(rng() * 8));
      const m = Math.floor(rng() * 30);
      expect(bestSpread(f, m)).toBe(optimalSpread(f, m));
    }
  });
  it('ความคล้ายของชุด', () => {
    const a = [{ itemId: 'x', optionOrder: [1, 2, 3, 4], key: 1 }, { itemId: 'y', optionOrder: [1, 2, 3, 4], key: 2 }];
    expect(setSimilarity(a, a)).toBe(1);
    expect(setSimilarity(a, [a[0], { ...a[1], key: 3 }])).toBe(0.5);
  });
  it('อ่านค่าจากตั้งค่า', () => {
    const c: AssemblyConfig = configFromSettings({ 'assembly.anchor_min_n': 30, 'assembly.anchor_ratio': { min: 0.1, max: 0.2 }, 'assembly.prefer_low_n': false, 'assembly.max_sets': 5 });
    expect(c).toMatchObject({ anchorMinN: 30, anchorRatio: { min: 0.1, max: 0.2 }, preferLowN: false, maxSets: 5, maxStudents: 60 });
  });
});

describe('ตัวตรวจจับแผนที่ผิดกฎได้จริง (ทำให้พังทีละกฎ)', () => {
  const pool: PoolItem[] = [];
  for (let k = 0; k < 6; k++) pool.push(item(`p${k}`, ind1.id, 1, k), item(`q${k}`, ind1.id, 2, 60 + k), item(`r${k}`, ind2.id, 1, k, 2, k === 0));
  const rq = req([{ indicatorId: ind1.id, difficulty: 1, count: 3 }, { indicatorId: ind1.id, difficulty: 2, count: 2 },
    { indicatorId: ind2.id, difficulty: 1, count: 5 }], { setCount: 3, studentCount: 7 });
  const fresh = () => buildPlan(rq, pool, cfg, ordering, 11);
  const broken: Array<[string, (p: ReturnType<typeof fresh>) => void]> = [
    ['R1', (p) => { p.items.pop(); }],
    ['R2', (p) => { p.items[0].item = pool.find((x) => x.id === 'p5')!.indicatorId === ind1.id ? { ...p.items[0].item, difficulty: 3 } : p.items[0].item; }],
    ['R3', (p) => { const i = p.items.findIndex((x) => x.item.indicatorId === ind1.id && x.item.difficulty === 1); p.items[i].item = pool.find((x) => x.id === 'p5')!; }],
    ['R4', (p) => { p.items.find((x) => x.isAnchor)!.isAnchor = false; }],
    ['R5', (p) => { p.sets[1].entries[0] = { ...p.sets[1].entries[0], itemId: 'p5' }; }],
    ['R6', (p) => { const e = p.sets[2].entries; [e[0], e[e.length - 1]] = [e[e.length - 1], e[0]]; }],
    ['R7', (p) => { const e = p.sets[0].entries.find((x) => x.itemId === 'r0')!; e.optionOrder = [2, 1, 3, 4]; e.key = 1; }],
    ['R8', (p) => { p.sets[0].entries.filter((x) => x.itemId !== 'r0').forEach((e) => { const a = pool.find((x) => x.id === e.itemId)!.answer; e.optionOrder = [a, ...[1, 2, 3, 4].filter((o) => o !== a)]; e.key = 1; }); p.sets[0].counts = [9, 1, 0, 0]; }],
    ['R9', (p) => { p.seats[1].setNo = 1; }],
    ['R10', (p) => { const e = p.sets[1].entries.find((x) => x.itemId !== 'r0')!; e.key = e.key === 1 ? 2 : 1; }],
  ];
  it('แผนที่ถูกต้องผ่าน', () => expect(validatePlan(fresh(), rq, pool, cfg, ordering)).toEqual([]));
  for (const [rule, mutate] of broken)
    it(`จับ ${rule} ได้`, () => {
      const p = fresh();
      mutate(p);
      const v = validatePlan(p, rq, pool, cfg, ordering);
      expect(v.some((x) => x.startsWith(rule + ' ')), v.join('\n')).toBe(true);
    });
});
