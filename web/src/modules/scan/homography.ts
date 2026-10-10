// การแปลงมุมมอง (homography) จากพิกัดกระดาษ (มม.) → พิกัดภาพ (พิกเซล) — ใช้จัดภาพที่ถ่ายเอียง/มีมุมมองให้ตรง
export type Pt = { x: number; y: number };
/** เมทริกซ์ 3×3 แบบแถว [h0..h8] */
export type H = number[];

export function apply(h: H, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

function normalizer(pts: Pt[]): H {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const md = pts.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
  const s = Math.SQRT2 / md;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

function mul(a: H, b: H): H {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function invert(m: H): H {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('homography singular');
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** แก้ระบบเชิงเส้น Ax=b (Gaussian elimination + partial pivoting) */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** homography จากคู่จุด ≥ 4 คู่ (least squares เมื่อเกิน 4) — คืน null ถ้าจุดเรียงตัวเสื่อม */
export function fromPoints(src: Pt[], dst: Pt[]): H | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const Ts = normalizer(src), Td = normalizer(dst);
  const s = src.map((p) => apply(Ts, p)), d = dst.map((p) => apply(Td, p));
  // สมการ 2 แถวต่อจุด, ตัวแปร h0..h7 (h8 = 1) → normal equations
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  for (let i = 0; i < s.length; i++) {
    const { x, y } = s[i], { x: u, y: v } = d[i];
    const rows: Array<[number[], number]> = [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ];
    for (const [r, t] of rows) {
      for (let a = 0; a < 8; a++) { Atb[a] += r[a] * t; for (let b = 0; b < 8; b++) AtA[a][b] += r[a] * r[b]; }
    }
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn: H = [...h, 1];
  const out = mul(invert(Td), mul(Hn, Ts));
  const k = out[8];
  return Math.abs(k) < 1e-15 ? null : out.map((v) => v / k);
}

/** จำนวนพิกเซลต่อ 1 มม. โดยประมาณรอบจุด p (มม.) */
export function localScale(h: H, p: Pt): number {
  const a = apply(h, p), bx = apply(h, { x: p.x + 1, y: p.y }), by = apply(h, { x: p.x, y: p.y + 1 });
  return Math.sqrt(Math.abs((bx.x - a.x) * (by.y - a.y) - (bx.y - a.y) * (by.x - a.x)));
}

/** การแปลงแบบ affine (ไม่มีมุมมอง) จากคู่จุด ≥ 3 คู่ — เสถียรกว่า homography เมื่อจุดอยู่ในบริเวณเล็ก ๆ แล้วต้องคาดไปไกล */
export function affineFromPoints(src: Pt[], dst: Pt[]): H | null {
  if (src.length < 3 || src.length !== dst.length) return null;
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0], by = [0, 0, 0];
  for (let i = 0; i < src.length; i++) {
    const r = [src[i].x, src[i].y, 1];
    for (let a = 0; a < 3; a++) { bx[a] += r[a] * dst[i].x; by[a] += r[a] * dst[i].y; for (let b = 0; b < 3; b++) AtA[a][b] += r[a] * r[b]; }
  }
  const px = solve(AtA.map((row) => [...row]), bx), py = solve(AtA.map((row) => [...row]), by);
  if (!px || !py) return null;
  return [px[0], px[1], px[2], py[0], py[1], py[2], 0, 0, 1];
}
