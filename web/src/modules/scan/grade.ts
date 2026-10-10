// ตีความรอยฝนและให้คะแนนตามกฎ SPEC §8.3 — ใช้ร่วมกันทั้งโหมดกล้อง/อัปโหลด/โหมดสาธิต
// (ฐานข้อมูลคำนวณคะแนนและตรวจแจกผิดชุดซ้ำเองใน migration 0008 ด้วยกฎเดียวกัน)
//   ฝน 1 ช่องชัดเจน → ตรวจตามเฉลยของชุดนั้น
//   ฝน 2 ช่องขึ้นไป → 0 · ไม่ฝน → 0
//   กำกวม (จาง/ลบไม่สะอาด) → ใช้คำตอบที่อ่านได้ดีที่สุด + remark ให้ครูยืนยันทีหลัง
import type { ScanAnswer, ScanFlag, Settings } from '../../core/types';

/** คำตอบ 1 ข้อ: ตัวเลือก 1–4 | null (ไม่ฝน) | 'multi' (ฝนหลายช่อง) */
export type Answer = ScanAnswer;

export interface ScanConfig {
  /** ความเข้ม (หลังหักพื้นหลัง) ตั้งแต่ค่านี้ = ฝน */
  fill: number;
  /** ต่ำกว่าค่านี้ = ว่างแน่นอน · ระหว่าง blank–fill = กำกวม */
  blank: number;
  /** ฝน ≥ 2 ช่องแต่ช่องเข้มสุดเข้มกว่าช่องถัดไปเกินค่านี้ = น่าจะลบไม่สะอาด (กำกวม) แทนที่จะเป็นฝนหลายช่อง */
  multiGap: number;
  /** แจกผิดชุด: คะแนนด้วยเฉลยชุดอื่นต้องสูงกว่าชุดตัวเอง ≥ สัดส่วนนี้ของจำนวนข้อ */
  wrongSetGain: number;
  /** แจกผิดชุด: คะแนนด้วยเฉลยชุดอื่นต้อง ≥ สัดส่วนนี้ของจำนวนข้อ */
  wrongSetMinAlt: number;
  /** จำนวนข้อขั้นต่ำที่จะตรวจแจกผิดชุด */
  wrongSetMinItems: number;
}

export const DEFAULT_SCAN: ScanConfig = { fill: 0.34, blank: 0.1, multiGap: 0.45, wrongSetGain: 0.25, wrongSetMinAlt: 0.6, wrongSetMinItems: 10 };

export function scanConfigFromSettings(s: Settings): ScanConfig {
  const num = (k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : d);
  return {
    fill: num('scan.fill_threshold', DEFAULT_SCAN.fill),
    blank: num('scan.blank_threshold', DEFAULT_SCAN.blank),
    multiGap: num('scan.multi_gap', DEFAULT_SCAN.multiGap),
    wrongSetGain: num('scan.wrong_set_min_gain_ratio', DEFAULT_SCAN.wrongSetGain),
    wrongSetMinAlt: num('scan.wrong_set_min_alt_ratio', DEFAULT_SCAN.wrongSetMinAlt),
    wrongSetMinItems: num('scan.wrong_set_min_items', DEFAULT_SCAN.wrongSetMinItems),
  };
}

export type ItemCall = 'clean' | 'blank' | 'multi' | 'faint' | 'residue';

export interface Interpretation {
  answers: Answer[];
  /** ลำดับข้อ (เริ่ม 1) ที่กำกวม ต้องให้ครูยืนยัน */
  ambiguous: number[];
  calls: ItemCall[];
  /** ระดับพื้นหลังของวงว่างในแผ่นนี้ */
  baseline: number;
}

/** ตีความความเข้มของวงกลม เฉพาะข้อ 1..itemCount */
export function interpret(darkness: number[][], itemCount: number, cfg: ScanConfig = DEFAULT_SCAN): Interpretation {
  const rows = darkness.slice(0, itemCount);
  const all = rows.flat().sort((a, b) => a - b);
  // วงส่วนใหญ่ว่าง (3 ใน 4 ของทุกข้อ) → ค่ากลางล่างคือระดับวงว่าง (ตัวเลขสีเทาในวง เงา ฯลฯ)
  const baseline = all.length ? Math.min(0.25, all[Math.floor(all.length * 0.35)]) : 0;
  const answers: Answer[] = [];
  const ambiguous: number[] = [];
  const calls: ItemCall[] = [];
  rows.forEach((row, i) => {
    const adj = row.map((d) => d - baseline);
    const order = adj.map((v, c) => ({ v, c: c + 1 })).sort((a, b) => b.v - a.v);
    const marked = order.filter((o) => o.v >= cfg.fill);
    const weak = order.filter((o) => o.v > cfg.blank && o.v < cfg.fill);
    const top = order[0].c as 1 | 2 | 3 | 4;
    let call: ItemCall;
    if (marked.length === 0) {
      call = weak.length ? 'faint' : 'blank';
      answers.push(weak.length ? top : null);
    } else if (marked.length === 1) {
      call = weak.length ? 'residue' : 'clean';
      answers.push(top);
    } else if (order[0].v - order[1].v >= cfg.multiGap) {
      call = 'residue';
      answers.push(top);
    } else {
      call = 'multi';
      answers.push('multi');
    }
    calls.push(call);
    if (call === 'faint' || call === 'residue') ambiguous.push(i + 1);
  });
  return { answers, ambiguous, calls, baseline };
}

export function score(answers: Answer[], keys: number[]): number {
  return keys.reduce((a, k, i) => a + (answers[i] === k ? 1 : 0), 0);
}

export interface WrongSetHint { suggestedSet: number; scoreAlt: number }

/** ตรวจจับแจกผิดชุด: คะแนนต่ำผิดปกติ แต่ตรวจด้วยเฉลยชุดอื่นได้สูง (SPEC §8.3) */
export function detectWrongSet(answers: Answer[], keysBySet: Record<number, number[]>, ownSet: number, cfg: ScanConfig = DEFAULT_SCAN): WrongSetHint | null {
  const own = keysBySet[ownSet];
  if (!own || own.length < cfg.wrongSetMinItems) return null;
  const n = own.length;
  const ownScore = score(answers, own);
  let best: WrongSetHint | null = null;
  for (const [s, keys] of Object.entries(keysBySet)) {
    const setNo = Number(s);
    if (setNo === ownSet) continue;
    const alt = score(answers, keys);
    if (alt - ownScore >= Math.ceil(cfg.wrongSetGain * n) && alt >= Math.ceil(cfg.wrongSetMinAlt * n) && (!best || alt > best.scoreAlt))
      best = { suggestedSet: setNo, scoreAlt: alt };
  }
  return best;
}

/** remark ที่เก็บใน responses.flags */
export type Flag = ScanFlag;

export function answersEqual(a: Answer[], b: Answer[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function answerLabel(a: Answer): string {
  if (a === null) return 'ไม่ฝน';
  if (a === 'multi') return 'ฝนหลายช่อง';
  return String(a);
}
