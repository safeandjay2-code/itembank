// ข้อมูลรายงาน (SPEC §9): ชื่อเรียก ตัวช่วยแสดงผล และไฟล์ Excel รายงานผลสอบ
import type { DifficultyLevel, ExamDetail, Grade, Indicator } from '../../core/types';
import {
  type Analysis, type AnalysisConfig, type ItemStat, type OptionCounts, type OptionKey, DEFAULT_ANALYSIS, OPTION_KEYS, difficultyOfP, rLabel,
} from './analyze';
import { buildXlsx, S, type Row, type Sheet } from './xlsx';

export interface ReportNames {
  indicator: (id: string) => Indicator | undefined;
  difficulty: (id: number) => string;
  grade: (id: string) => string;
  difficulties: DifficultyLevel[];
}

export function makeNames(indicators: Indicator[], difficulties: DifficultyLevel[], grades: Grade[]): ReportNames {
  const ind = new Map(indicators.map((i) => [i.id, i]));
  return {
    indicator: (id) => ind.get(id),
    difficulty: (id) => difficulties.find((d) => d.id === id)?.nameTh ?? String(id),
    grade: (id) => grades.find((g) => g.id === id)?.shortTh ?? id,
    difficulties,
  };
}

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(digits)}%`);
export const fix = (x: number | null | undefined, digits = 2) => (x === null || x === undefined ? '–' : x.toFixed(digits));

/** สถิติรายข้อของชุดที่ปิดแล้ว (จาก item_stat_rounds) — ไม่มีข้อมูลรายเลขที่ จึงไม่มีกลุ่มสูง/ต่ำ */
export function itemStatsFromRounds(exam: ExamDetail, cfg: AnalysisConfig = DEFAULT_ANALYSIS): ItemStat[] {
  const byItem = new Map(exam.roundStats.map((s) => [s.itemId, s]));
  return exam.items.slice().sort((a, b) => a.basePosition - b.basePosition).map((it) => {
    const st = byItem.get(it.itemId);
    const counts = Object.fromEntries(OPTION_KEYS.map((k) => [k, Number(st?.optionCounts?.[k] ?? 0)])) as OptionCounts;
    const n = st?.n ?? 0;
    const nCorrect = st?.nCorrect ?? 0;
    const positions: Record<number, number> = {};
    for (const s of exam.sets) { const e = s.entries.find((x) => x.itemId === it.itemId); if (e) positions[s.setNo] = e.position; }
    const rationale = it.content?.distractor_rationale ?? [];
    return {
      itemId: it.itemId, itemCode: it.itemCode, basePosition: it.basePosition, indicatorId: it.indicatorId, difficulty: it.difficulty,
      version: it.version, answer: it.answer, n, nCorrect, p: n ? Math.round((1000 * nCorrect) / n) / 1000 : null, r: st?.r ?? null,
      groupSize: 0, upperCorrect: 0, lowerCorrect: 0, counts, positions,
      distractors: [1, 2, 3, 4].filter((o) => o !== it.answer).map((o) => {
        const count = counts[String(o) as OptionKey];
        return { option: o, count, ratio: n ? Math.round((1000 * count) / n) / 1000 : 0, rationale: rationale[o - 1] ?? null,
          strong: n > 0 && count > 0 && (count >= cfg.strongDistractor * n - 1e-9 || count > nCorrect),
          dead: n >= cfg.rMinN && count < cfg.deadDistractor * n - 1e-9, attractsUpper: false };
      }),
    };
  });
}

/** ข้อสังเกตของข้อ (ใช้ทั้งหน้าเว็บและ Excel) */
export function itemNotes(it: ItemStat, cfg: AnalysisConfig, names: ReportNames, optionText?: (o: number) => string): string[] {
  const out: string[] = [];
  const opt = (o: number) => (optionText ? `${o}) ${optionText(o)}` : `ตัวเลือก ${o})`);
  if (it.r !== null && it.r < 0) out.push('r ติดลบ: นักเรียนกลุ่มอ่อนตอบถูกมากกว่ากลุ่มเก่ง — ตรวจเฉลย/โจทย์ด่วน');
  else if (it.r !== null && it.r < cfg.rFlagBelow) out.push('อำนาจจำแนกต่ำ — ควรปรับปรุงข้อนี้');
  for (const d of it.distractors) {
    if (d.strong) out.push(`เด็กหลงตัวลวง ${opt(d.option)} ${pct(d.ratio)}${d.rationale ? ` — ${d.rationale}` : ''}`);
    if (d.attractsUpper) out.push(`ตัวลวง ${opt(d.option)} ดึงกลุ่มเก่งมากกว่ากลุ่มอ่อน — ตรวจว่าถูกได้หรือกำกวม`);
  }
  const dead = it.distractors.filter((d) => d.dead).map((d) => d.option);
  if (dead.length) out.push(`ตัวลวง ${dead.join(', ')} แทบไม่มีใครเลือก — ควรปรับให้น่าเลือกขึ้น`);
  const lvl = difficultyOfP(it.p, names.difficulties);
  if (lvl && it.n >= cfg.rMinN && lvl.id !== it.difficulty) out.push(`ค่า p ห้องนี้อยู่ระดับ "${lvl.nameTh}" (คลังตั้งไว้ "${names.difficulty(it.difficulty)}")`);
  return out;
}

export function reportFileName(exam: ExamDetail, names: ReportNames, ext = 'xlsx') {
  const safe = `${exam.title} ${names.grade(exam.gradeId)}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `รายงานผล ${safe}.${ext}`;
}

const thDate = (d: Date) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

/** ไฟล์ Excel รายงานผลสอบ: สรุป · คะแนนรายเลขที่ · รายตัวชี้วัด · วิเคราะห์รายข้อ · คำตอบรายเลขที่ */
export function reportSheets(exam: ExamDetail, a: Analysis, names: ReportNames, now = new Date()): Sheet[] {
  const cfg = a.config;
  const sm = a.summary;
  const inds = a.indicators;
  const indCode = (id: string) => names.indicator(id)?.code ?? id;
  const items = a.items;
  const S_ = exam.setCount;
  const content = new Map(exam.items.map((i) => [i.itemId, i.content]));
  const optText = (itemId: string) => (o: number) => (content.get(itemId)?.options?.[o - 1] ?? '').slice(0, 60);

  // ---------- สรุป ----------
  const summary: Row[] = [
    [{ v: `รายงานผลการสอบ: ${exam.title}`, s: S.title }],
    [`${names.grade(exam.gradeId)} · ${exam.itemCount} ข้อ · ${exam.setCount} ชุด · ออกรายงาน ${thDate(now)}`],
    [],
    [{ v: 'ข้อมูล', s: S.header }, { v: 'ค่า', s: S.header }],
    ['จำนวนนักเรียน (เลขที่ 1–N)', sm.studentCount],
    ['ตรวจแล้ว', sm.n],
    ['ยังไม่ตรวจ / ขาดสอบ (เลขที่)', sm.missingSeats.length ? compactSeats(sm.missingSeats) : '-'],
    ['คะแนนเต็ม', sm.itemCount],
    ['คะแนนเฉลี่ย', { v: sm.mean, s: S.dec2 }],
    ['ร้อยละเฉลี่ย', { v: sm.meanPercent, s: S.dec2 }],
    ['ส่วนเบี่ยงเบนมาตรฐาน (S.D.)', { v: sm.sd, s: S.dec2 }],
    ['มัธยฐาน', sm.median],
    ['คะแนนต่ำสุด', sm.min],
    ['คะแนนสูงสุด', sm.max],
    ['เกณฑ์ผ่านตัวชี้วัด', `ตอบถูกอย่างน้อยร้อยละ ${Math.round(cfg.passRatio * 100)} ของข้อในตัวชี้วัด`],
    ['remark ที่ยังไม่ยืนยัน (เลขที่)', sm.unresolvedSeats.length ? compactSeats(sm.unresolvedSeats) : '-'],
    [],
    [{ v: 'ช่วงคะแนน (ร้อยละ)', s: S.header }, { v: 'จำนวนคน', s: S.header }],
    ...sm.histogram.map((c, i) => [i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`, c] as Row),
    [],
    [{ v: 'ตัวชี้วัดที่ควรสอนซ่อม (ผ่านไม่ถึงครึ่งห้อง)', s: S.bold }],
    ...(inds.filter((x) => x.weak).length
      ? inds.filter((x) => x.weak).map((x) => [indCode(x.indicatorId), `ผ่าน ${x.passCount}/${sm.n} คน`, names.indicator(x.indicatorId)?.text ?? ''] as Row)
      : [['-'] as Row]),
    [],
    [{ v: 'หมายเหตุ', s: S.bold }],
    [`ค่า p = สัดส่วนผู้ตอบถูก · ค่า r = อำนาจจำแนกแบบเทคนิค 27% (กลุ่มสูง/ต่ำกลุ่มละ ${Math.max(1, Math.round(sm.n * cfg.groupRatio))} คน) คำนวณเมื่อตรวจแล้วอย่างน้อย ${cfg.rMinN} คน`],
    ['ระบบไม่เก็บชื่อนักเรียน · เมื่อปิดชุดข้อสอบ คะแนนและคำตอบรายเลขที่จะถูกลบจากระบบ — เก็บไฟล์นี้ไว้เป็นหลักฐาน'],
  ];

  // ---------- คะแนนรายเลขที่ (ครบทุกเลขที่ 1–N ให้ลงสมุดคะแนนได้ทันที) ----------
  const head: Row = [{ v: 'เลขที่', s: S.header }, { v: 'ชุด', s: S.header }, { v: `คะแนน (เต็ม ${exam.itemCount})`, s: S.header }, { v: 'ร้อยละ', s: S.header }];
  for (const x of inds) { head.push({ v: `${indCode(x.indicatorId)} (ถูก/${x.itemCount})`, s: S.header }, { v: 'ผล', s: S.header }); }
  head.push({ v: `ผ่านตัวชี้วัด (จาก ${inds.length})`, s: S.header }, { v: 'หมายเหตุ', s: S.header });
  const bySeat = new Map(a.students.map((s) => [s.seatNo, s]));
  const scoreRows: Row[] = [head];
  for (const seat of exam.seats) {
    const st = bySeat.get(seat.seatNo);
    if (!st) { scoreRows.push([seat.seatNo, seat.setNo, null, null, ...inds.flatMap(() => [null, null]), null, 'ยังไม่ตรวจ/ขาดสอบ']); continue; }
    const row: Row = [st.seatNo, st.setNo, st.score, { v: st.percent, s: S.dec2 }];
    st.indicators.forEach((x) => row.push(x.correct, { v: x.pass ? 'ผ่าน' : 'ไม่ผ่าน', s: x.pass ? S.good : S.bad }));
    const notes = [st.setNo !== seat.setNo ? `ตรวจด้วยชุด ${st.setNo}` : '', st.unresolved ? 'มี remark ยังไม่ยืนยัน' : ''].filter(Boolean).join(' · ');
    row.push(st.passedIndicators, notes || null);
    scoreRows.push(row);
  }

  // ---------- รายตัวชี้วัด ----------
  const indRows: Row[] = [[
    { v: 'ตัวชี้วัด', s: S.header }, { v: 'จำนวนข้อ', s: S.header }, { v: 'ร้อยละตอบถูกเฉลี่ย', s: S.header },
    { v: 'ผ่าน (คน)', s: S.header }, { v: 'ร้อยละผ่าน', s: S.header }, { v: 'สถานะ', s: S.header }, { v: 'ข้อความตัวชี้วัด', s: S.header }]];
  for (const x of inds)
    indRows.push([indCode(x.indicatorId), x.itemCount, { v: x.meanRatio === null ? null : x.meanRatio * 100, s: S.pct }, x.passCount,
      { v: x.passRate === null ? null : x.passRate * 100, s: S.pct }, x.weak ? { v: 'ควรสอนซ่อม', s: S.bad } : (x.passRate === null ? '-' : { v: 'ผ่านเกินครึ่ง', s: S.good }),
      names.indicator(x.indicatorId)?.text ?? '']);

  // ---------- วิเคราะห์รายข้อ ----------
  const itemHead: Row = [{ v: 'ข้อ', s: S.header }];
  for (let s = 1; s <= S_; s++) itemHead.push({ v: `ชุด ${s}`, s: S.header });
  itemHead.push(...['รหัสข้อ', 'ตัวชี้วัด', 'ระดับในคลัง', 'n', 'ตอบถูก', 'p', 'ระดับตามค่า p', 'r', 'แปลผล r', 'เฉลย',
    'เลือก 1 (%)', 'เลือก 2 (%)', 'เลือก 3 (%)', 'เลือก 4 (%)', 'ไม่ฝน (%)', 'ฝนหลายช่อง (%)', 'ข้อสังเกต / ตัวลวงที่เด็กหลงมาก'].map((v) => ({ v, s: S.header })));
  const itemRows: Row[] = [itemHead];
  for (const it of items) {
    const row: Row = [it.basePosition];
    for (let s = 1; s <= S_; s++) row.push(it.positions[s] ?? null);
    const lvl = difficultyOfP(it.p, names.difficulties);
    const rl = rLabel(it.r, cfg);
    row.push(it.itemCode, indCode(it.indicatorId), names.difficulty(it.difficulty), it.n, it.nCorrect, { v: it.p, s: S.dec3 }, lvl?.nameTh ?? '-',
      { v: it.r, s: S.dec3 }, { v: rl.text, s: rl.level === 'bad' || rl.level === 'weak' ? S.bad : S.normal }, `${it.answer}) ${optText(it.itemId)(it.answer)}`);
    for (const k of OPTION_KEYS) row.push({ v: it.n ? (100 * it.counts[k]) / it.n : null, s: S.pct });
    row.push(itemNotes(it, cfg, names, optText(it.itemId)).join(' · ') || null);
    itemRows.push(row);
  }
  itemRows.push([], ['หมายเหตุ: "ข้อ" = ลำดับมาตรฐาน (ก่อนสลับ) · คอลัมน์ "ชุด X" = ข้อนี้อยู่ข้อที่เท่าไรในชุดนั้น · ตัวเลือก 1–4 เรียงตามต้นฉบับในคลัง (กระดาษแต่ละชุดสลับลำดับตัวเลือก)']);

  // ---------- คำตอบรายเลขที่ (สำหรับสอนซ่อมรายคน) ----------
  const ansHead: Row = [{ v: 'เลขที่', s: S.header }, { v: 'ชุด', s: S.header }, ...items.map((it) => ({ v: `ข้อ ${it.basePosition}`, s: S.header }))];
  const ansRows: Row[] = [ansHead];
  for (const st of a.students)
    ansRows.push([st.seatNo, st.setNo, ...st.answers.map((x, k) => (st.correct[k] ? { v: '✓', s: S.good } : { v: x === 'blank' ? '-' : x === 'multi' ? 'หลายช่อง' : `${x}`, s: S.bad }))]);
  ansRows.push([], ['✓ = ตอบถูก · ตัวเลข = ตัวเลือกต้นฉบับที่ตอบผิด · - = ไม่ฝน · ลำดับข้อตามลำดับมาตรฐาน (ดูแผ่นงาน "วิเคราะห์รายข้อ")']);

  return [
    { name: 'สรุป', rows: summary, widths: [38, 44, 60] },
    { name: 'คะแนนรายเลขที่', rows: scoreRows, widths: [8, 6, 12, 9, ...inds.flatMap(() => [14, 9]), 14, 24], freezeRows: 1, freezeCols: 1 },
    { name: 'รายตัวชี้วัด', rows: indRows, widths: [16, 10, 14, 10, 12, 14, 80], freezeRows: 1 },
    { name: 'วิเคราะห์รายข้อ', rows: itemRows, widths: [6, ...Array(S_).fill(6), 11, 16, 11, 6, 8, 7, 12, 7, 13, 28, 9, 9, 9, 9, 9, 11, 70], freezeRows: 1, freezeCols: 1 },
    { name: 'คำตอบรายเลขที่', rows: ansRows, widths: [8, 6, ...items.map(() => 7)], freezeRows: 1, freezeCols: 2 },
  ];
}

export function buildReportXlsx(exam: ExamDetail, a: Analysis, names: ReportNames, now = new Date()): Promise<Uint8Array> {
  return buildXlsx(reportSheets(exam, a, names, now));
}

/** 1,2,3,5,7,8,9 → "1–3, 5, 7–9" */
export function compactSeats(seats: number[]): string {
  const s = [...seats].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i + 1 ? `${s[i]}–${s[j]}` : j === i + 1 ? `${s[i]}, ${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(', ');
}
