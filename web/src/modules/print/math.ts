// แยกข้อความเป็นส่วนข้อความกับเศษส่วน เพื่อพิมพ์เศษส่วนแบบซ้อนบน-ล่าง (เหมือนสมการใน Word ที่ครูใช้)
//   "3/4" → เศษส่วน · "1 1/8" → จำนวนคละ · ตัวหารต้องเป็นตัวเลข (หารใช้ ÷)
export type MathSeg = { t: 'text'; v: string } | { t: 'frac'; whole: string | null; num: string; den: string };

const FRAC = /(?<![\d/.,])(?:(\d+)\s+)?(\d+)\/(\d+)(?![\d/])/g;

export function splitMath(text: string): MathSeg[] {
  const out: MathSeg[] = [];
  let last = 0;
  for (const m of text.matchAll(FRAC)) {
    const i = m.index!;
    if (i > last) out.push({ t: 'text', v: text.slice(last, i) });
    out.push({ t: 'frac', whole: m[1] ?? null, num: m[2], den: m[3] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

/** ความกว้างที่มองเห็นโดยประมาณ (นับตัวอักษร ไม่นับสระบน/ล่าง เศษส่วนนับตามด้านที่ยาวกว่า) */
export function visualLength(text: string): number {
  return splitMath(text).reduce((a, s) => a + (s.t === 'text'
    ? s.v.replace(/[ัิ-ฺ็-๎]/g, '').length
    : (s.whole?.length ?? 0) + Math.max(s.num.length, s.den.length) + 0.5), 0);
}
