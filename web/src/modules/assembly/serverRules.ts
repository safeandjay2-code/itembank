// กฎที่ฐานข้อมูลตรวจตอนบันทึกชุด (exam_create ใน migration 0006) เขียนซ้ำเป็น TypeScript สำหรับโหมดสาธิต
// ข้อความผิดพลาดตรงกับฐานข้อมูล ฐานข้อมูลจริงมีชุดทดสอบของตัวเองใน tests/db/test_phase3.sql
import type { ExamCreateInput, PoolItem } from '../../core/types';
import { optimalSpread, type AssemblyConfig, type Ordering } from './assemble';

export function checkCreateInput(x: ExamCreateInput, pool: PoolItem[], cfg: AssemblyConfig, ordering: Ordering): void {
  const fail = (m: string) => { throw new Error(m); };
  if (!x.title?.trim() || x.title.trim().length > 200) fail('ชื่อแบบทดสอบต้องมี 1–200 ตัวอักษร');
  const maxSets = Math.min(cfg.maxSets, 10);
  if (!Number.isInteger(x.setCount) || x.setCount < 1 || x.setCount > maxSets) fail(`จำนวนชุดต้องอยู่ระหว่าง 1–${maxSets}`);
  if (!Number.isInteger(x.studentCount) || x.studentCount < 1 || x.studentCount > cfg.maxStudents) fail(`จำนวนนักเรียนต้องอยู่ระหว่าง 1–${cfg.maxStudents}`);
  const N = x.items.length;
  if (N < 1) fail('ชุดข้อสอบต้องมีอย่างน้อย 1 ข้อ');
  if (new Set(x.items.map((i) => i.itemId)).size !== N) fail('มีข้อซ้ำในชุดข้อสอบ');
  const pos = new Set(x.items.map((i) => i.basePosition).filter((p) => p >= 1 && p <= N));
  if (pos.size !== N) fail(`ลำดับมาตรฐานของข้อต้องเป็น 1–${N} ไม่ซ้ำ`);
  const byId = new Map(pool.map((p) => [p.id, p]));
  const bad = x.items.filter((i) => !byId.has(i.itemId));
  if (bad.length) fail(`ข้อ ${bad.map((b) => b.itemId).join(', ')} ไม่อยู่ในสถานะพร้อมใช้ (ตรวจแล้ว/ใช้งาน)`);
  const stale = x.items.filter((i) => byId.get(i.itemId)!.version !== i.version);
  if (stale.length) fail(`ข้อ ${stale.map((s) => byId.get(s.itemId)!.itemCode).join(', ')} ถูกแก้ไขระหว่างสร้างชุด กรุณาสร้างใหม่`);
  const want = new Map<string, number>(), got = new Map<string, number>();
  x.rows.forEach((r) => want.set(`${r.indicatorId}/${r.difficulty}`, (want.get(`${r.indicatorId}/${r.difficulty}`) ?? 0) + r.count));
  x.items.forEach((i) => { const p = byId.get(i.itemId)!; got.set(`${p.indicatorId}/${p.difficulty}`, (got.get(`${p.indicatorId}/${p.difficulty}`) ?? 0) + 1); });
  const diff = [...new Set([...want.keys(), ...got.keys()])].filter((k) => (want.get(k) ?? 0) !== (got.get(k) ?? 0));
  if (diff.length) fail(`จำนวนข้อไม่ตรงกับที่เลือก: ${diff.join(', ')}`);
  const base = x.items.slice().sort((a, b) => a.basePosition - b.basePosition).map((i) => byId.get(i.itemId)!);
  const rk = (p: PoolItem) => [ordering.indicatorRank.get(p.indicatorId) ?? 1e9, ordering.difficultyRank.get(p.difficulty) ?? 1e9];
  for (let i = 1; i < base.length; i++) {
    const [a1, a2] = rk(base[i - 1]), [b1, b2] = rk(base[i]);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) fail('ลำดับข้อต้องเรียงตามตัวชี้วัดในหลักสูตร และง่าย→ยากภายในตัวชี้วัด');
  }
  const setNos = new Set(x.sets.map((s) => s.setNo));
  if (x.sets.length !== x.setCount || setNos.size !== x.setCount || [...setNos].some((n) => n < 1 || n > x.setCount))
    fail(`ต้องมีลำดับข้อครบทุกชุด 1–${x.setCount}`);
  const ids = new Set(x.items.map((i) => i.itemId));
  for (const s of x.sets)
    if (s.entries.length !== N || new Set(s.entries.map((e) => e.itemId)).size !== N || s.entries.some((e) => !ids.has(e.itemId)))
      fail('ทุกชุดต้องใช้ข้อชุดเดียวกัน ครบทุกข้อ ไม่ซ้ำ');
  for (const s of x.sets)
    s.entries.forEach((e, p) => {
      const it = byId.get(e.itemId)!;
      if (it.indicatorId !== base[p].indicatorId || it.difficulty !== base[p].difficulty) fail('สลับลำดับข้อได้เฉพาะภายในกลุ่มตัวชี้วัดและระดับเดียวกัน');
    });
  for (const s of x.sets)
    for (const e of s.entries)
      if (e.optionOrder.length !== 4 || [...e.optionOrder].sort().join(',') !== '1,2,3,4') fail('ลำดับตัวเลือกต้องเป็นการสลับของตัวเลือก 1–4');
  const noShuf = new Set<string>();
  for (const s of x.sets) for (const e of s.entries) if (byId.get(e.itemId)!.noShuffle && e.optionOrder.join(',') !== '1,2,3,4') noShuf.add(byId.get(e.itemId)!.itemCode);
  if (noShuf.size) fail(`ข้อ ${[...noShuf].join(', ')} ห้ามสลับตัวเลือก`);
  const fixed = [0, 0, 0, 0];
  base.filter((p) => p.noShuffle).forEach((p) => { fixed[p.answer - 1] += 1; });
  const best = optimalSpread(fixed, base.filter((p) => !p.noShuffle).length);
  for (const s of x.sets.slice().sort((a, b) => a.setNo - b.setNo)) {
    const c = [0, 0, 0, 0];
    s.entries.forEach((e) => { c[e.optionOrder.indexOf(byId.get(e.itemId)!.answer)] += 1; });
    const spread = Math.max(...c) - Math.min(...c);
    if (spread > best) fail(`เฉลยชุดที่ ${s.setNo} กระจายไม่สมดุล (ต่างกัน ${spread} ข้อ ควรไม่เกิน ${best})`);
  }
}
