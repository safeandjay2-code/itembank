// ตีความรอยฝนและให้คะแนนตามกฎ SPEC §8.3 — ใช้ร่วมกันทั้งโหมดกล้อง/อัปโหลด/โหมดสาธิต
// (ฐานข้อมูลคำนวณคะแนนและตรวจแจกผิดชุดซ้ำเองใน migration 0008 ด้วยกฎเดียวกัน)
//   ฝน 1 ช่องชัดเจน → ตรวจตามเฉลยของชุดนั้น
//   ฝน 2 ช่องขึ้นไป → 0 · ไม่ฝน → 0
//   กำกวม (จาง/ลบไม่สะอาด) → ใช้คำตอบที่อ่านได้ดีที่สุด + remark ให้ครูยืนยันทีหลัง
//   เกณฑ์ "ฝนแล้ว" ปรับตามความเข้มรอยฝนของแต่ละแผ่น (ดู interpret)
import type { ScanAnswer, ScanFlag, Settings } from '../../core/types';

/** คำตอบ 1 ข้อ: ตัวเลือก 1–4 | null (ไม่ฝน) | 'multi' (ฝนหลายช่อง) */
export type Answer = ScanAnswer;

export interface ScanConfig {
  /** เกณฑ์ "มีรอยฝน" ขั้นต่ำ (ความเข้มหลังหักพื้นหลัง) — กันรอยเปื้อน/ตัวเลขในวงถูกนับเป็นคำตอบ */
  markFloor: number;
  /** เกณฑ์ "มีรอยฝน" ของแผ่นนี้ = สัดส่วนนี้ × ความเข้มรอยฝนตามปกติของแผ่นนั้น (ไม่ต่ำกว่า markFloor)
   *  เด็กแต่ละคนฝนเข้มไม่เท่ากัน จึงวัดเทียบกับรอยฝนของแผ่นตัวเอง ไม่ใช้ค่าตายตัว */
  markRatio: number;
  /** ช่องที่ 2 เข้ม ≥ สัดส่วนนี้ของช่องเข้มสุด (และเกินเกณฑ์) = ฝนหลายช่อง → 0 คะแนน */
  multiRatio: number;
  /** ช่องที่ 2 เข้มระหว่างสัดส่วนนี้ถึง multiRatio ของช่องเข้มสุด = น่าจะลบไม่สะอาด → remark */
  residueRatio: number;
  /** ช่องเข้มสุดเกินเกณฑ์ไม่ถึงเท่านี้ (× เกณฑ์ของแผ่น) = จางจนไม่แน่ใจ → remark */
  faintBand: number;
  /** แจกผิดชุด: คะแนนด้วยเฉลยชุดอื่นต้องสูงกว่าชุดตัวเอง ≥ สัดส่วนนี้ของจำนวนข้อ */
  wrongSetGain: number;
  /** แจกผิดชุด: คะแนนด้วยเฉลยชุดอื่นต้อง ≥ สัดส่วนนี้ของจำนวนข้อ */
  wrongSetMinAlt: number;
  /** จำนวนข้อขั้นต่ำที่จะตรวจแจกผิดชุด */
  wrongSetMinItems: number;
}

export const DEFAULT_SCAN: ScanConfig = {
  markFloor: 0.05, markRatio: 0.25, multiRatio: 0.55, residueRatio: 0.3, faintBand: 1.5,
  wrongSetGain: 0.25, wrongSetMinAlt: 0.6, wrongSetMinItems: 10,
};

export function scanConfigFromSettings(s: Settings): ScanConfig {
  const num = (k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : d);
  return {
    markFloor: num('scan.mark_floor', DEFAULT_SCAN.markFloor),
    markRatio: num('scan.mark_ratio', DEFAULT_SCAN.markRatio),
    multiRatio: num('scan.multi_ratio', DEFAULT_SCAN.multiRatio),
    residueRatio: num('scan.residue_ratio', DEFAULT_SCAN.residueRatio),
    faintBand: num('scan.faint_band', DEFAULT_SCAN.faintBand),
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
  /** ความเข้มรอยฝนตามปกติของแผ่นนี้ (หลังหักพื้นหลัง) */
  markLevel: number;
  /** เกณฑ์ "มีรอยฝน" ที่ใช้กับแผ่นนี้ */
  threshold: number;
}

/** ตีความความเข้มของวงกลม เฉพาะข้อ 1..itemCount
 *  ปรับเกณฑ์ตามแผ่น (ทดสอบกับกระดาษจริง ป.5 พ.ย. 2569: เด็กฝนดินสอเบา 0.13–0.44 ขณะวงว่าง ~0.02)
 *    เกณฑ์ T = max(markFloor, markRatio × ค่ากลางของความเข้มสูงสุดรายข้อที่มีรอยฝน)
 *    ช่องเข้มสุด < T                              → ไม่ฝน
 *    ช่องที่ 2 ≥ T และ ≥ multiRatio × ช่องเข้มสุด   → ฝนหลายช่อง (0 คะแนน)
 *    ไม่งั้น                                       → ช่องเข้มสุด
 *      + remark ถ้าช่องเข้มสุด < faintBand × T (จาง) หรือช่องที่ 2 ≥ T และ ≥ residueRatio × ช่องเข้มสุด (ลบไม่สะอาด) */
export function interpret(darkness: number[][], itemCount: number, cfg: ScanConfig = DEFAULT_SCAN): Interpretation {
  const rows = darkness.slice(0, itemCount);
  const all = rows.flat().sort((a, b) => a - b);
  // วงส่วนใหญ่ว่าง (3 ใน 4 ของทุกข้อ) → ค่ากลางล่างคือระดับวงว่าง (ตัวเลขสีเทาในวง เงา ฯลฯ)
  const baseline = all.length ? Math.min(0.25, all[Math.floor(all.length * 0.35)]) : 0;
  const adjRows = rows.map((row) => row.map((d) => d - baseline));
  const maxima = adjRows.map((r) => Math.max(...r)).filter((m) => m >= 2 * cfg.markFloor).sort((a, b) => a - b);
  const markLevel = maxima.length ? maxima[Math.floor((maxima.length - 1) / 2)] : 0.3;
  const T = Math.max(cfg.markFloor, cfg.markRatio * markLevel);
  const answers: Answer[] = [];
  const ambiguous: number[] = [];
  const calls: ItemCall[] = [];
  adjRows.forEach((adj, i) => {
    const order = adj.map((v, c) => ({ v, c: c + 1 })).sort((a, b) => b.v - a.v);
    const top = order[0], second = order[1];
    let call: ItemCall;
    if (top.v < T) {
      call = 'blank';
      answers.push(null);
    } else if (second.v >= T && second.v >= cfg.multiRatio * top.v) {
      call = 'multi';
      answers.push('multi');
    } else {
      answers.push(top.c as 1 | 2 | 3 | 4);
      if (second.v >= T && second.v >= cfg.residueRatio * top.v) call = 'residue';
      else if (top.v < cfg.faintBand * T) call = 'faint';
      else call = 'clean';
    }
    calls.push(call);
    if (call === 'faint' || call === 'residue') ambiguous.push(i + 1);
  });
  return { answers, ambiguous, calls, baseline, markLevel, threshold: T };
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
