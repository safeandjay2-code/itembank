// วาดฉากเป็น SVG (ข้อความล้วน ใช้ได้ทั้งในเบราว์เซอร์ เอกสารพิมพ์ และการทดสอบ)
// มาตรฐานเส้น ตัวอักษร สัญลักษณ์มุมฉาก/ด้านเท่า กำหนดที่นี่ที่เดียว (SPEC §5.5)
import { buildScene, FigureError, norm360, textWidth, verifyScene, type P, type Prim, type Scene, type VerifyResult } from './layout';
import type { FigureSpec } from './spec';

export const DEFAULT_FIGURE_NOTE = 'รูปอาจไม่ได้วาดตามมาตราส่วน ให้ใช้ขนาดที่กำหนดให้';
const FONT = "Sarabun, 'TH Sarabun New', Tahoma, sans-serif";
const INK = '#111111';

export interface RenderOptions {
  /** หมายเหตุใต้รูปเรขาคณิต (null = ไม่ใส่) */
  note?: string | null;
  /** ขนาดด้านยาวสุดของรูปเรขาคณิต (พิกเซล) */
  size?: number;
}

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  verify: VerifyResult;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => (Math.round(n * 100) / 100).toString();

function worldPoints(p: Prim): P[] {
  switch (p.t) {
    case 'path': return p.pts;
    case 'circle': case 'sector': return [{ x: p.c.x - p.r, y: p.c.y - p.r }, { x: p.c.x + p.r, y: p.c.y + p.r }];
    case 'tick': return [p.a, p.b];
    case 'dot': case 'text': return [p.at];
    case 'arc': case 'right': return [p.c];
  }
}

export function renderScene(scene: Scene, opts: RenderOptions = {}): RenderResult {
  const pts = scene.prims.flatMap(worldPoints);
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const k = scene.pixelSpace ? 1 : (opts.size ?? 240) / span;
  const map = (p: P): P => ({ x: (p.x - minX) * k, y: (maxY - p.y) * k });

  const out: string[] = [];
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number) => { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); };
  const dir = (a: number) => ({ x: Math.cos((a * Math.PI) / 180), y: -Math.sin((a * Math.PI) / 180) });

  for (const p of scene.prims) {
    if (p.t === 'path') {
      const s = p.pts.map(map);
      s.forEach((q) => grow(q.x, q.y));
      const d = s.map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join(' ') + (p.closed ? ' Z' : '');
      out.push(`<path d="${d}" fill="${p.fill ?? 'none'}" stroke="${p.stroke ?? INK}" stroke-width="${p.width ?? 1.6}"` +
        `${p.dashed ? ' stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`);
    } else if (p.t === 'circle') {
      const c = map(p.c), r = p.r * k;
      grow(c.x - r, c.y - r); grow(c.x + r, c.y + r);
      out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="none" stroke="${INK}" stroke-width="1.6"${p.dashed ? ' stroke-dasharray="5 4"' : ''}/>`);
    } else if (p.t === 'sector') {
      const c = map(p.c), r = p.r * k;
      const s1 = dir(p.a1), s2 = dir(p.a2), sweep = norm360(p.a2 - p.a1);
      grow(c.x - r, c.y - r); grow(c.x + r, c.y + r);
      if (sweep > 359.999 || sweep === 0 && p.a1 !== p.a2) {
        out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${p.fill}" stroke="${INK}" stroke-width="1"/>`);
      } else {
        out.push(`<path d="M${f(c.x)} ${f(c.y)} L${f(c.x + s1.x * r)} ${f(c.y + s1.y * r)} A${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} 0 ` +
          `${f(c.x + s2.x * r)} ${f(c.y + s2.y * r)} Z" fill="${p.fill}" stroke="${INK}" stroke-width="1"/>`);
      }
    } else if (p.t === 'arc') {
      const c = map(p.c), s1 = dir(p.a1), s2 = dir(p.a2), sweep = norm360(p.a2 - p.a1);
      out.push(`<path d="M${f(c.x + s1.x * p.r)} ${f(c.y + s1.y * p.r)} A${p.r} ${p.r} 0 ${sweep > 180 ? 1 : 0} 0 ` +
        `${f(c.x + s2.x * p.r)} ${f(c.y + s2.y * p.r)}" fill="none" stroke="${INK}" stroke-width="1.2"/>`);
      grow(c.x - p.r, c.y - p.r); grow(c.x + p.r, c.y + p.r);
    } else if (p.t === 'right') {
      const c = map(p.c), u = dir(p.a1), w = dir(p.a2), s = p.size;
      const a = { x: c.x + u.x * s, y: c.y + u.y * s }, b = { x: a.x + w.x * s, y: a.y + w.y * s }, e = { x: c.x + w.x * s, y: c.y + w.y * s };
      out.push(`<path d="M${f(a.x)} ${f(a.y)} L${f(b.x)} ${f(b.y)} L${f(e.x)} ${f(e.y)}" fill="none" stroke="${INK}" stroke-width="1.2"/>`);
    } else if (p.t === 'tick') {
      const a = map(p.a), b = map(p.b);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, n = { x: -t.y, y: t.x };
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (let i = 0; i < p.count; i++) {
        const o = (i - (p.count - 1) / 2) * 4;
        const c = { x: m.x + t.x * o, y: m.y + t.y * o };
        out.push(`<path d="M${f(c.x - n.x * 5)} ${f(c.y - n.y * 5)} L${f(c.x + n.x * 5)} ${f(c.y + n.y * 5)}" stroke="${INK}" stroke-width="1.4"/>`);
      }
    } else if (p.t === 'dot') {
      const c = map(p.at);
      grow(c.x, c.y);
      out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${p.r}" fill="${INK}"/>`);
    } else if (p.t === 'text') {
      if (!p.text) continue;
      const c = map(p.at), size = p.size ?? 14;
      const x = c.x + (p.dx ?? 0), y = c.y + (p.dy ?? 0);
      const w = textWidth(p.text, size), anchor = p.anchor ?? 'middle';
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      grow(x0, y - size * 0.65); grow(x0 + w, y + size * 0.65);
      out.push(`<text x="${f(x)}" y="${f(y)}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="central"` +
        `${p.bold ? ' font-weight="700"' : ''} fill="${p.muted ? '#555555' : INK}">${esc(p.text)}</text>`);
    }
  }

  const note = scene.geometric ? (opts.note === undefined ? DEFAULT_FIGURE_NOTE : opts.note) : null;
  const pad = 10;
  if (note) {
    const size = 13, w = textWidth(note, size);
    const cx = (box.x0 + box.x1) / 2, y = box.y1 + 22;
    grow(cx - w / 2, y - 9); grow(cx + w / 2, y + 9);
    out.push(`<text x="${f(cx)}" y="${f(y)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" font-weight="700" fill="#000000" data-role="figure-note">${esc(note)}</text>`);
  }
  const vx = box.x0 - pad, vy = box.y0 - pad, width = Math.ceil(box.x1 - box.x0 + pad * 2), height = Math.ceil(box.y1 - box.y0 + pad * 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vx)} ${f(vy)} ${width} ${height}" width="${width}" height="${height}" ` +
    `font-family="${esc(FONT)}" role="img"><rect x="${f(vx)}" y="${f(vy)}" width="${width}" height="${height}" fill="#ffffff"/>` +
    out.join('') + '</svg>';
  return { svg, width, height, verify: verifyScene(scene, map) };
}

export function renderFigure(spec: FigureSpec, opts: RenderOptions = {}): RenderResult {
  return renderScene(buildScene(spec), opts);
}

/** วาดแบบไม่โยนข้อผิดพลาด สำหรับหน้าจอแสดงตัวอย่าง */
export function tryRenderFigure(spec: unknown, opts: RenderOptions = {}): { ok: true; result: RenderResult } | { ok: false; error: string } {
  try { return { ok: true, result: renderFigure(spec as FigureSpec, opts) }; }
  catch (e) { return { ok: false, error: e instanceof FigureError ? e.message : `ข้อกำหนดรูปผิดพลาด: ${(e as Error).message}` }; }
}
