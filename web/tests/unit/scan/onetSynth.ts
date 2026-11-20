// สร้างภาพกระดาษคำตอบ O-NET (ON1) จำลองที่รู้คำตอบล่วงหน้า — ใช้คู่กับ photograph() ใน synth.ts
import { Resvg } from '@resvg/resvg-js';
import { onetSheetSvg } from '../../../src/modules/print/onetSheetSvg';
import { getOnetTemplate, on1AllBubbles, setCodeNumber } from '../../../src/modules/print/onetTemplate';
import { toGray, type Gray } from '../../../src/modules/scan/image';
import { makeRng } from '../../../src/modules/assembly/rng';
import type { MarkKind } from './synth';

export const ON1 = getOnetTemplate(1);
const BUBBLES = new Map(on1AllBubbles(ON1).map((b) => [b.key, b]));

export interface OnetMark { key: string; kind: MarkKind }

const GRAY: Record<MarkKind, [number, number]> = {
  dark: [0.08, 0.2], normal: [0.22, 0.38], faint: [0.6, 0.68], residue: [0.7, 0.78], scribble: [0.25, 0.4],
};

function markSvg(m: OnetMark, rnd: () => number): string {
  const b = BUBBLES.get(m.key);
  if (!b) throw new Error(`ไม่มีวง ${m.key}`);
  const k = b.r / 2.3;
  const [lo, hi] = GRAY[m.kind];
  const g = Math.round((lo + (hi - lo) * rnd()) * 255);
  const col = `rgb(${g},${g},${g})`;
  const dx = (rnd() - 0.5) * 0.6 * k, dy = (rnd() - 0.5) * 0.6 * k;
  const c = b.p;
  if (m.kind === 'scribble') {
    let d = '';
    for (let y = -1.6 * k; y <= 1.6 * k; y += 0.55 * k) d += `M${c.x - 1.9 * k + dx} ${c.y + y + dy}L${c.x + 1.9 * k + dx} ${c.y + y * 0.8 + dy}`;
    return `<path d="${d}" stroke="${col}" stroke-width="0.6" stroke-linecap="round" fill="none"/>`;
  }
  const rx = (1.9 + rnd() * 0.5) * k, ry = (1.9 + rnd() * 0.5) * k;
  return `<ellipse cx="${c.x + dx}" cy="${c.y + dy}" rx="${rx}" ry="${ry}" fill="${col}" transform="rotate(${Math.round(rnd() * 90)} ${c.x} ${c.y})"/>`;
}

export function renderOnetSheet(s: { setCode: string; marks: OnetMark[]; pxPerMm?: number; seed?: number }): Gray {
  const rnd = makeRng(s.seed ?? 1);
  let svg = onetSheetSvg(ON1, { setCode: s.setCode, subtitle: `ชุดติว O-NET คณิตศาสตร์ ป.6 · ชุดที่ ${Number(s.setCode.slice(1))}` });
  svg = svg.replace(/<\/svg>\s*$/, `${s.marks.map((m) => markSvg(m, rnd)).join('')}</svg>`);
  const px = Math.round(ON1.paper.width * (s.pxPerMm ?? 5));
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: px }, background: 'white', font: { loadSystemFonts: true } }).render();
  return toGray(img.pixels, img.width, img.height);
}

/** คำตอบที่ถูกต้องตามกฎ SPEC-ONET §6 ของแผ่นจำลอง */
export interface OnetTruth {
  /** null = เลขที่อ่านไม่ได้ตามกฎ (ครูต้องพิมพ์) */
  seat: number | null;
  /** ปรนัย: '1'–'4' · null = ไม่ฝน · 'multi' = ฝนหลายช่อง · ตัวเลข: '034' · null = ไม่ตอบ/ระบายไม่ครบ */
  answers: Array<string | null | 'multi'>;
  /** ข้อตัวเลขที่ระบายไม่ครบบางคอลัมน์ (ต้องมี remark) */
  partial: number[];
  bubbledSet: string | null;
}

export interface OnetMix {
  kinds?: MarkKind[];
  mcqBlank?: number; mcqMulti?: number;
  numBlank?: number; numPartial?: number; numMulti?: number;
  seatTensBlank?: number; seatMulti?: number;
  setWrong?: number; setBlank?: number;
}

const pick = <T>(rnd: () => number, a: T[]) => a[Math.floor(rnd() * a.length)];

/** สุ่มการฝนทั้งแผ่น */
export function randomOnet(setCode: string, seed: number, mix: OnetMix = {}): { marks: OnetMark[]; truth: OnetTruth } {
  const rnd = makeRng(seed);
  const kinds = mix.kinds ?? ['dark', 'normal', 'scribble'];
  const marks: OnetMark[] = [];
  const answers: OnetTruth['answers'] = [];
  const partial: number[] = [];
  const add = (key: string) => marks.push({ key, kind: pick(rnd, kinds) });

  for (let n = 1; n <= 11; n++) {
    const r = rnd();
    if (r < (mix.mcqBlank ?? 0.06)) { answers.push(null); continue; }
    const c = 1 + Math.floor(rnd() * 4);
    add(`q${n}:${c}`);
    if (r < (mix.mcqBlank ?? 0.06) + (mix.mcqMulti ?? 0.06)) {
      add(`q${n}:${((c + Math.floor(rnd() * 3)) % 4) + 1}`);
      answers.push('multi');
    } else answers.push(String(c));
  }
  for (const n of [12, 13, 14, 15]) {
    const r = rnd();
    const pBlank = mix.numBlank ?? 0.05, pPart = mix.numPartial ?? 0.08, pMulti = mix.numMulti ?? 0.06;
    if (r < pBlank) { answers.push(null); continue; }
    // ค่าคำตอบ: บางทีมี 0 นำหน้า เหมือนข้อสอบจริง (034, 007)
    const v = rnd() < 0.4 ? Math.floor(rnd() * 100) : Math.floor(rnd() * 1000);
    const ds = String(v).padStart(3, '0').split('').map(Number);
    if (r < pBlank + pPart) {
      // ลืมระบาย 0 นำหน้า / ข้ามหลัก → คอลัมน์ว่าง
      const skip = rnd() < 0.6 ? 0 : Math.floor(rnd() * 3);
      ds.forEach((d, col) => { if (col !== skip) add(`q${n}:c${col}:${d}`); });
      answers.push(null); partial.push(n);
    } else if (r < pBlank + pPart + pMulti) {
      const col = Math.floor(rnd() * 3);
      ds.forEach((d, c) => add(`q${n}:c${c}:${d}`));
      add(`q${n}:c${col}:${(ds[col] + 1 + Math.floor(rnd() * 8)) % 10}`);
      answers.push(null); partial.push(n);
    } else {
      ds.forEach((d, c) => add(`q${n}:c${c}:${d}`));
      answers.push(ds.join(''));
    }
  }
  // เลขที่ 1–99
  let seat: number | null = 1 + Math.floor(rnd() * 99);
  const sd = [Math.floor(seat / 10), seat % 10];
  const rs = rnd();
  if (rs < (mix.seatTensBlank ?? 0.08)) { add(`seat:c1:${sd[1]}`); seat = null; }
  else if (rs < (mix.seatTensBlank ?? 0.08) + (mix.seatMulti ?? 0.05)) {
    add(`seat:c0:${sd[0]}`); add(`seat:c1:${sd[1]}`); add(`seat:c1:${(sd[1] + 1 + Math.floor(rnd() * 8)) % 10}`); seat = null;
  } else { add(`seat:c0:${sd[0]}`); add(`seat:c1:${sd[1]}`); }
  // รหัสชุด
  const own = setCodeNumber(setCode);
  let bubbledSet: string | null = String(own);
  const rset = rnd();
  if (rset < (mix.setBlank ?? 0.08)) bubbledSet = null;
  else {
    if (rset < (mix.setBlank ?? 0.08) + (mix.setWrong ?? 0.1)) bubbledSet = String(pick(rnd, ON1.set_code.codes.filter((c) => c !== own)));
    add(`set:${bubbledSet}`);
  }
  return { marks, truth: { seat, answers, partial, bubbledSet } };
}
