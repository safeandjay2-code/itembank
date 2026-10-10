// คำขออ่านภาพ (ใช้ทั้งใน worker และสำรองบนเธรดหลัก)
import { toGray } from './image';
import { qrFactors, readPage, readSheet, type ReadResult } from './omr';

export interface ReadRequest {
  id: number;
  rgba: ArrayBuffer;
  w: number;
  h: number;
  /** camera = 1 แผ่น ลองขนาด QR 1 ขนาดต่อเฟรม (เร็ว) · upload = ภาพอาจมี 2 แผ่น ลองทุกขนาด (ละเอียด) */
  mode: 'camera' | 'upload';
  frame: number;
}
export interface ReadResponse { id: number; results: ReadResult[]; ms: number }

export function handleReadRequest(req: ReadRequest): ReadResponse {
  const t0 = Date.now();
  const g = toGray(new Uint8ClampedArray(req.rgba), req.w, req.h);
  let results: ReadResult[];
  if (req.mode === 'camera') {
    const fs = qrFactors(req.w, req.h, [900, 1300, 650]);
    results = [readSheet(g, { qrFactors: [fs[req.frame % fs.length]], sharpen: req.frame % 4 === 3 })];
  } else {
    results = readPage(g);
  }
  return { id: req.id, results, ms: Date.now() - t0 };
}
