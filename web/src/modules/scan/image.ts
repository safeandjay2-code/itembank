// ภาพระดับเทา + เครื่องมือพื้นฐานสำหรับเครื่องอ่านกระดาษคำตอบ (ไม่พึ่งไลบรารีภายนอก ทำงานได้ทั้งเบราว์เซอร์/worker/Node)
export interface Gray {
  w: number;
  h: number;
  /** ความสว่าง 0 (ดำ) – 255 (ขาว) แถวต่อแถว */
  d: Uint8Array;
}

/** แปลง RGBA (จาก canvas/ImageData) เป็นระดับเทา */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const d = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { w, h, d };
}

/** ระดับเทา → RGBA (ให้ตัวอ่าน QR ใช้) */
export function grayToRgba(g: Gray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0, j = 0; i < g.d.length; i++, j += 4) { out[j] = out[j + 1] = out[j + 2] = g.d[i]; out[j + 3] = 255; }
  return out;
}

/** ย่อภาพแบบเฉลี่ยพื้นที่ (box filter) ด้วยตัวคูณ 1/f ทั้งสองแกน */
export function downscale(g: Gray, f: number): Gray {
  if (f <= 1) return g;
  const w = Math.max(1, Math.floor(g.w / f)), h = Math.max(1, Math.floor(g.h / f));
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * f), y1 = Math.min(g.h, Math.floor((y + 1) * f));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * f), x1 = Math.min(g.w, Math.floor((x + 1) * f));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) { const row = yy * g.w; for (let xx = x0; xx < x1; xx++) { s += g.d[row + xx]; n++; } }
      d[y * w + x] = n ? Math.round(s / n) : 255;
    }
  }
  return { w, h, d };
}

/** ตัดภาพบางส่วน (ใช้แยกกระดาษ 2 แผ่นบน A4 แนวนอน) */
export function crop(g: Gray, x: number, y: number, w: number, h: number): Gray {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(g.w - x, Math.floor(w)); h = Math.min(g.h - y, Math.floor(h));
  const d = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) d.set(g.d.subarray((y + r) * g.w + x, (y + r) * g.w + x + w), r * w);
  return { w, h, d };
}

/** ค่าความสว่างแบบ bilinear ที่พิกัดทศนิยม (นอกภาพ = 255) */
export function sample(g: Gray, x: number, y: number): number {
  if (x < 0 || y < 0 || x > g.w - 1 || y > g.h - 1) return 255;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = g.d[y0 * g.w + x0], b = g.d[y0 * g.w + x1], c = g.d[y1 * g.w + x0], e = g.d[y1 * g.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

/** เกณฑ์ Otsu จากฮิสโทแกรม */
export function otsu(hist: Uint32Array | number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; th = t; }
  }
  return th;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[i];
}

/** เพิ่มความคม (unsharp mask) — ช่วยให้อ่าน QR จากภาพที่เบลอเล็กน้อยได้ */
export function sharpen(g: Gray, radius = 2, amount = 1.5): Gray {
  const { w, h } = g;
  const tmp = new Float32Array(w * h), blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -radius; x <= radius; x++) s += g.d[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / (2 * radius + 1);
      s += g.d[y * w + Math.min(w - 1, x + radius + 1)] - g.d[y * w + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -radius; y <= radius; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      blur[y * w + x] = s / (2 * radius + 1);
      s += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  const d = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(255, Math.round(g.d[i] + amount * (g.d[i] - blur[i]))));
  return { w, h, d };
}
