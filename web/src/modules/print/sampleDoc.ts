// ชุดข้อสอบตัวอย่างที่เหมือนของจริง (เศษส่วน จำนวนคละ รูป ตัวเลือกยาว ข้อห้ามสลับ) — ใช้ทดสอบและตรวจหน้าตาเอกสาร
// แสดงได้เฉพาะโหมดสาธิตที่ #/dev/print-sample
import type { ExamDetail, ItemContent } from '../../core/types';
import { FIGURE_SAMPLES } from '../bank/figure/samples';
import { buildPlan, DEFAULT_CONFIG, makeOrdering } from '../assembly/assemble';
import type { PoolItem, Indicator, Grade, DifficultyLevel } from '../../core/types';

interface Raw { stem: string; options: string[]; answer: number; fig?: keyof typeof FIGURE_SAMPLES; noShuffle?: boolean; d: number; ind: number }

const RAW: Raw[] = [
  { ind: 0, d: 1, stem: 'ผลบวกของ 3/4 กับ 1/8 เท่ากับเท่าใด', options: ['7/8', '4/12', '1 1/8', '5/8'], answer: 1 },
  { ind: 0, d: 1, stem: 'เศษส่วนในข้อใดมีค่าเท่ากับ 2/3', options: ['4/6', '3/2', '2/6', '6/4'], answer: 1 },
  { ind: 0, d: 2, stem: 'แม่มีเชือกยาว 2 1/2 เมตร ตัดไปใช้ 3/4 เมตร เหลือเชือกยาวกี่เมตร', options: ['1 3/4', '1 1/4', '2 1/4', '3/4'], answer: 1 },
  { ind: 0, d: 2, stem: 'ข้อใดเรียงเศษส่วนจากน้อยไปมากได้ถูกต้อง', options: ['1/4, 1/3, 1/2', '1/2, 1/3, 1/4', '1/3, 1/4, 1/2', '1/4, 1/2, 1/3'], answer: 1, noShuffle: true },
  { ind: 0, d: 3, stem: 'นักเรียนห้องหนึ่งมี 36 คน เป็นนักเรียนหญิง 5/9 ของทั้งห้อง นักเรียนชายมีกี่คน', options: ['16 คน', '20 คน', '18 คน', '14 คน'], answer: 1 },
  { ind: 1, d: 1, stem: 'รูปสี่เหลี่ยมมุมฉากนี้มีพื้นที่กี่ตารางเซนติเมตร', options: ['60', '34', '17', '120'], answer: 1, fig: 'rectangle' },
  { ind: 1, d: 2, stem: 'จากรูป มุม x มีขนาดกี่องศา', options: ['125°', '55°', '35°', '145°'], answer: 1, fig: 'angles' },
  { ind: 1, d: 2, stem: 'จากแผนภูมิ นักเรียนที่ชอบกล้วยมากกว่านักเรียนที่ชอบองุ่นกี่คน', options: ['10 คน', '7 คน', '3 คน', '20 คน'], answer: 1, fig: 'bar_chart' },
  { ind: 1, d: 3, stem: 'รูปสามเหลี่ยมมุมฉากนี้มีพื้นที่เท่าใด', options: ['24 ตารางเซนติเมตร', '48 ตารางเซนติเมตร', '14 ตารางเซนติเมตร', '28 ตารางเซนติเมตร'], answer: 1, fig: 'triangle' },
  { ind: 1, d: 4, stem: 'สวนรูปหลายเหลี่ยมนี้ต้องการล้อมรั้วรอบ ต้องใช้รั้วยาวกี่เมตร และมีพื้นที่กี่ตารางเมตร', options: ['ยาว 38 เมตร พื้นที่ 60 ตารางเมตร', 'ยาว 38 เมตร พื้นที่ 90 ตารางเมตร', 'ยาว 28 เมตร พื้นที่ 60 ตารางเมตร', 'ยาว 19 เมตร พื้นที่ 40 ตารางเมตร'], answer: 1, fig: 'rectilinear' },
  { ind: 2, d: 1, stem: 'จากเส้นจำนวน จุด A แทนจำนวนใด', options: ['3/4', '1/4', '1 1/4', '3/8'], answer: 1, fig: 'number_line', noShuffle: false },
  { ind: 2, d: 2, stem: 'จากตาราง ซื้อดินสอ 3 แท่ง และสมุด 2 เล่ม ต้องจ่ายเงินกี่บาท', options: ['45 บาท', '35 บาท', '50 บาท', '40 บาท'], answer: 1, fig: 'table' },
  { ind: 2, d: 3, stem: '2/5 × 15 + 3 ÷ 1/2 มีค่าเท่าใด', options: ['12', '7 1/2', '9', '15'], answer: 1 },
  { ind: 2, d: 4, stem: 'ปิติมีเงินจำนวนหนึ่ง ใช้ซื้อหนังสือ 1/3 ของเงินที่มี และซื้อขนม 1/4 ของเงินที่เหลือ ปรากฏว่าเหลือเงิน 120 บาท เดิมปิติมีเงินกี่บาท', options: ['240 บาท', '180 บาท', '360 บาท', '200 บาท'], answer: 1 },
];

export function sampleExam(ref: { indicators: Indicator[]; grades: Grade[]; difficulties: DifficultyLevel[] }, setCount = 3, students = 7): ExamDetail {
  const inds = ref.indicators.filter((i) => i.gradeId === 'P5').slice(0, 3);
  const content = new Map<string, { c: ItemContent; answer: number }>();
  const pool: PoolItem[] = RAW.map((r, k) => {
    const id = `sample-${k + 1}`;
    content.set(id, { c: { stem: r.stem, options: r.options, figure: r.fig ? FIGURE_SAMPLES[r.fig] : null, explanation: '',
      distractor_rationale: [null, null, null, null] }, answer: r.answer });
    return { id, itemCode: `M-90${String(k + 1).padStart(4, '0')}`, indicatorId: inds[r.ind].id, difficulty: r.d, version: 1,
      n: k % 5 === 0 ? 80 : k, noShuffle: !!r.noShuffle, answer: r.answer, isSample: true };
  });
  const rows = new Map<string, { indicatorId: string; difficulty: number; count: number }>();
  pool.forEach((p) => { const key = `${p.indicatorId}|${p.difficulty}`; const r = rows.get(key) ?? { indicatorId: p.indicatorId, difficulty: p.difficulty, count: 0 }; r.count += 1; rows.set(key, r); });
  const req = { gradeId: 'P5', itemCount: pool.length, setCount, studentCount: students, rows: [...rows.values()] };
  const plan = buildPlan(req, pool, DEFAULT_CONFIG, makeOrdering(ref.indicators, ref.grades, ref.difficulties), 4242);
  return {
    id: '0b6c1f2e-6a3d-4c55-9e1a-1234567890ab', title: 'แบบทดสอบ คณิตศาสตร์ ป.5 (ตัวอย่าง)', gradeId: 'P5', itemCount: pool.length,
    setCount, studentCount: students, status: 'draft', createdAt: new Date(0).toISOString(), durationMin: 30,
    rows: req.rows, build: null, hasResponses: false, templateVersion: 1,
    items: plan.items.map((x) => ({ itemId: x.item.id, itemCode: x.item.itemCode, version: 1, basePosition: x.basePosition,
      indicatorId: x.item.indicatorId, difficulty: x.item.difficulty, isAnchor: x.isAnchor, noShuffle: x.item.noShuffle, n: x.item.n,
      content: content.get(x.item.id)!.c, answer: content.get(x.item.id)!.answer })),
    sets: plan.sets.map((s) => ({ setNo: s.setNo, entries: s.entries.map((e, i) => ({ position: i + 1, itemId: e.itemId, optionOrder: e.optionOrder, key: e.key })) })),
    seats: plan.seats,
  };
}
