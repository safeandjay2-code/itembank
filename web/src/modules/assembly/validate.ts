// ตัวตรวจแผนชุดข้อสอบ — เขียนแยกจากตัวสร้าง เพื่อตรวจทุกกฎใน SPEC §6 อย่างอิสระ
// คืนรายการข้อผิด (ว่าง = ผ่านทุกกฎ) ใช้ทั้งในการจำลอง 1,000 ชุด และตรวจซ้ำก่อนบันทึกจริง
import type { PoolItem } from '../../core/types';
import type { AssemblyConfig, AssemblyRequest, ExamPlan, Ordering } from './assemble';

const PERMS_OK = (p: number[]) => p.length === 4 && [...p].sort().join(',') === '1,2,3,4';

/** ค่าต่างสูงสุด−ต่ำสุดที่ดีที่สุดเมื่อมีจำนวนตายตัว fixed และเติมได้อีก m (คำนวณแบบปิด ไม่ใช้โค้ดตัวสร้าง) */
function bestSpread(fixed: number[], m: number): number {
  // หาระดับน้ำ L ที่เติม m ลงถังที่ต่ำกว่า L ได้พอดี
  const total = fixed.reduce((a, b) => a + b, 0) + m;
  const sorted = fixed.slice().sort((a, b) => b - a);
  // ถังที่สูงเกินค่าเฉลี่ยของถังที่เหลือ จะไม่ได้รับเพิ่ม
  let k = 0, rest = total;
  while (k < sorted.length && sorted[k] * (sorted.length - k) > rest) { rest -= sorted[k]; k += 1; }
  const n = sorted.length - k;
  const lowMax = Math.ceil(rest / n), lowMin = Math.floor(rest / n);
  const max = k > 0 ? Math.max(sorted[0], lowMax) : lowMax;
  return max - lowMin;
}

export function validatePlan(plan: ExamPlan, req: AssemblyRequest, pool: PoolItem[], cfg: AssemblyConfig, ordering: Ordering): string[] {
  const v: string[] = [];
  const N = req.itemCount, S = req.setCount;
  const byId = new Map(pool.map((p) => [p.id, p]));
  const items = plan.items.map((x) => x.item);

  // R1 จำนวนข้อ ไม่ซ้ำ และมาจากคลังพร้อมใช้
  if (items.length !== N) v.push(`R1 จำนวนข้อ ${items.length} ≠ ${N}`);
  if (new Set(items.map((i) => i.id)).size !== items.length) v.push('R1 มีข้อซ้ำในชุด');
  items.forEach((i) => { if (!byId.has(i.id)) v.push(`R1 ข้อ ${i.itemCode} ไม่อยู่ในคลังพร้อมใช้`); });

  // R2 จำนวนต่อช่องตรงคำขอ
  const want = new Map<string, number>();
  req.rows.forEach((r) => want.set(`${r.indicatorId}|${r.difficulty}`, (want.get(`${r.indicatorId}|${r.difficulty}`) ?? 0) + r.count));
  const got = new Map<string, number>();
  items.forEach((i) => got.set(`${i.indicatorId}|${i.difficulty}`, (got.get(`${i.indicatorId}|${i.difficulty}`) ?? 0) + 1));
  for (const k of new Set([...want.keys(), ...got.keys()]))
    if ((want.get(k) ?? 0) !== (got.get(k) ?? 0)) v.push(`R2 ช่อง ${k}: ได้ ${got.get(k) ?? 0} ต้องการ ${want.get(k) ?? 0}`);

  // R3 ข้อ n น้อยออกก่อน (ในกลุ่มข้อที่ยังไม่ถึงเกณฑ์ยึดค่า)
  const chosenIds = new Set(items.map((i) => i.id));
  if (cfg.preferLowN)
    for (const k of want.keys()) {
      const cell = pool.filter((p) => `${p.indicatorId}|${p.difficulty}` === k && p.n < cfg.anchorMinN);
      const inN = cell.filter((p) => chosenIds.has(p.id)).map((p) => p.n);
      const outN = cell.filter((p) => !chosenIds.has(p.id)).map((p) => p.n);
      if (inN.length && outN.length && Math.max(...inN) > Math.min(...outN))
        v.push(`R3 ช่อง ${k}: เลือกข้อ n=${Math.max(...inN)} ทั้งที่ยังมีข้อ n=${Math.min(...outN)}`);
    }

  // R4 ข้อยึดค่า: ป้ายถูกต้อง และจำนวนอยู่ในช่วงเท่าที่คลังทำได้
  plan.items.forEach((x) => { if (x.isAnchor !== (x.item.n >= cfg.anchorMinN)) v.push(`R4 ป้ายข้อยึดค่าของ ${x.item.itemCode} ผิด`); });
  const anchors = items.filter((i) => i.n >= cfg.anchorMinN).length;
  if (anchors !== plan.anchorCount) v.push('R4 จำนวนข้อยึดค่าที่รายงานไม่ตรง');
  {
    let forced = 0, cap = 0;
    for (const [k, c] of want) {
      const cell = pool.filter((p) => `${p.indicatorId}|${p.difficulty}` === k);
      const a = cell.filter((p) => p.n >= cfg.anchorMinN).length;
      forced += Math.max(0, c - (cell.length - a));
      cap += Math.min(c, a);
    }
    const lo = Math.ceil(cfg.anchorRatio.min * N - 1e-9), hi = Math.floor(cfg.anchorRatio.max * N + 1e-9);
    const mid = Math.round(((cfg.anchorRatio.min + cfg.anchorRatio.max) / 2) * N);
    const target = lo <= hi ? Math.min(hi, Math.max(lo, mid)) : mid;
    const expect = Math.min(cap, Math.max(forced, target));
    if (anchors !== expect) v.push(`R4 ข้อยึดค่า ${anchors} ข้อ ควรเป็น ${expect} (ช่วง ${lo}–${hi}, บังคับ ${forced}, มีได้สูงสุด ${cap})`);
    if (lo <= hi && cap >= lo && forced <= hi && (anchors < lo || anchors > hi)) v.push(`R4 ข้อยึดค่า ${anchors} ข้อ อยู่นอกช่วง ${lo}–${hi} ทั้งที่คลังทำได้`);
  }

  // R5 ทุกชุดใช้ข้อชุดเดียวกัน และครบ S ชุด
  if (plan.sets.length !== S) v.push(`R5 จำนวนชุด ${plan.sets.length} ≠ ${S}`);
  plan.sets.forEach((s, i) => {
    if (s.setNo !== i + 1) v.push(`R5 เลขชุดไม่เรียง (${s.setNo})`);
    const ids = s.entries.map((e) => e.itemId);
    if (ids.length !== N || new Set(ids).size !== N || ids.some((id) => !chosenIds.has(id))) v.push(`R5 ชุดที่ ${s.setNo} ใช้ข้อไม่ตรงกับชุดอื่น`);
  });

  // R6 ลำดับมาตรฐานเรียงตามหลักสูตร และทุกชุดสลับเฉพาะในกลุ่ม (ตัวชี้วัด+ระดับเดียวกันตรงตำแหน่ง)
  const rank = (i: PoolItem) => [ordering.indicatorRank.get(i.indicatorId)!, ordering.difficultyRank.get(i.difficulty)!];
  const base = plan.items.slice().sort((a, b) => a.basePosition - b.basePosition);
  base.forEach((x, i) => { if (x.basePosition !== i + 1) v.push('R6 ลำดับมาตรฐานไม่ต่อเนื่อง'); });
  for (let i = 1; i < base.length; i++) {
    const [a1, a2] = rank(base[i - 1].item), [b1, b2] = rank(base[i].item);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) { v.push(`R6 ลำดับมาตรฐานผิดที่ตำแหน่ง ${i + 1}`); break; }
  }
  const groupAt = base.map((x) => `${x.item.indicatorId}|${x.item.difficulty}`);
  plan.sets.forEach((s) => s.entries.forEach((e, p) => {
    const it = byId.get(e.itemId);
    if (it && `${it.indicatorId}|${it.difficulty}` !== groupAt[p]) v.push(`R6 ชุดที่ ${s.setNo} ตำแหน่ง ${p + 1} สลับข้ามกลุ่ม`);
  }));

  // R7 ลำดับตัวเลือกเป็นการเรียงสับเปลี่ยน และข้อห้ามสลับต้องคงเดิม · R10 เฉลยที่แสดงถูกต้อง
  plan.sets.forEach((s) => s.entries.forEach((e, p) => {
    const it = byId.get(e.itemId);
    if (!PERMS_OK(e.optionOrder)) v.push(`R7 ชุดที่ ${s.setNo} ข้อ ${p + 1} ลำดับตัวเลือกไม่ถูกต้อง`);
    if (it?.noShuffle && e.optionOrder.join(',') !== '1,2,3,4') v.push(`R7 ข้อห้ามสลับ ${it.itemCode} ถูกสลับในชุดที่ ${s.setNo}`);
    if (it && e.optionOrder[e.key - 1] !== it.answer) v.push(`R10 เฉลยชุดที่ ${s.setNo} ข้อ ${p + 1} ผิด`);
  }));

  // R8 เฉลยแต่ละชุดกระจาย 1–4 สมดุลที่สุดเท่าที่ข้อห้ามสลับยอมให้
  const fixed = [0, 0, 0, 0];
  items.filter((i) => i.noShuffle).forEach((i) => { fixed[i.answer - 1] += 1; });
  const optimal = bestSpread(fixed, items.filter((i) => !i.noShuffle).length);
  plan.sets.forEach((s) => {
    const c = [0, 0, 0, 0];
    s.entries.forEach((e) => { c[e.key - 1] += 1; });
    if (c.join(',') !== s.counts.join(',')) v.push(`R8 ชุดที่ ${s.setNo} นับเฉลยไม่ตรง`);
    const spread = Math.max(...c) - Math.min(...c);
    if (spread !== optimal) v.push(`R8 ชุดที่ ${s.setNo} เฉลยกระจาย ${c.join('/')} (ต่าง ${spread}) ควรต่างได้ ${optimal}`);
  });

  // R9 เลขที่ 1..N วนชุด 1..S
  if (plan.seats.length !== req.studentCount) v.push(`R9 จำนวนเลขที่ ${plan.seats.length} ≠ ${req.studentCount}`);
  plan.seats.forEach((st, i) => {
    if (st.seatNo !== i + 1 || st.setNo !== (i % S) + 1) v.push(`R9 เลขที่ ${st.seatNo} ได้ชุด ${st.setNo}`);
  });
  for (let i = 1; i < plan.seats.length; i++)
    if (S > 1 && plan.seats[i].setNo === plan.seats[i - 1].setNo) v.push(`R9 เลขที่ ${i} และ ${i + 1} ได้ชุดเดียวกัน`);
  return v;
}

export { bestSpread };
