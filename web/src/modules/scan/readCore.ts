// คำขออ่านภาพ (ใช้ทั้งใน worker และสำรองบนเธรดหลัก)
import { toGray } from './image';
import { qrFactors, readOnetSheet, readPage, readSheet, type OnetReadResult, type ReadResult } from './omr';

export interface ReadRequest {
  id: number;
  rgba: ArrayBuffer;
  w: number;
  h: number;
  /** camera = 1 แผ่น ลองขนาด QR 1 ขนาดต่อเฟรม (เร็ว) · upload = ภาพอาจมี 2 แผ่น ลองทุกขนาด (ละเอียด) */
  mode: 'camera' | 'upload' | 'onet-camera' | 'onet-upload';
  frame: number;
}
export interface ReadResponse {
  id: number;
  /** ผลอ่านกระดาษระบบหลัก (โหมด camera/upload) */
  results: ReadResult[];
  /** ผลอ่านกระดาษ O-NET ON1 (โหมด onet-camera/onet-upload) — 1 แผ่นต่อภาพ */
  onet?: OnetReadResult[];
  ms: number;
}

export function handleReadRequest(req: ReadRequest): ReadResponse {
  const t0 = Date.now();
  const g = toGray(new Uint8ClampedArray(req.rgba), req.w, req.h);
  if (req.mode === 'onet-camera' || req.mode === 'onet-upload') {
    // O-NET: A4 แนวตั้ง 1 แผ่นต่อภาพ · กล้อง = ลองขนาด QR ทีละ 1 ขนาดต่อเฟรม · อัปโหลด = ลองทุกขนาด
    //   A4 ไกลกล้องกว่า A5 → QR เล็ก จึงไม่ย่อภาพมากเท่าระบบหลัก และทุก 4 เฟรมลองขยายภาพ 1.6 เท่า
    let opts = {};
    if (req.mode === 'onet-camera') {
      const fs = qrFactors(req.w, req.h, [1400, 0, 1000]);
      opts = req.frame % 4 === 3
        ? { qrFactors: [] as number[], sharpen: false, qrUpscales: [1.6] }
        : { qrFactors: [fs[req.frame % fs.length]], sharpen: req.frame % 4 === 2 };
    }
    return { id: req.id, results: [], onet: [readOnetSheet(g, opts)], ms: Date.now() - t0 };
  }
  let results: ReadResult[];
  if (req.mode === 'camera') {
    const fs = qrFactors(req.w, req.h, [900, 1300, 650]);
    results = [readSheet(g, { qrFactors: [fs[req.frame % fs.length]], sharpen: req.frame % 4 === 3 })];
  } else {
    results = readPage(g);
  }
  return { id: req.id, results, ms: Date.now() - t0 };
}
