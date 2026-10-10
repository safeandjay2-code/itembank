// ตัวเรียกเครื่องอ่าน: ส่งภาพให้ Web Worker (ถ้าใช้ไม่ได้ ประมวลผลบนเธรดหลักแทน)
import type { ReadResult } from './omr';
import { handleReadRequest, type ReadRequest, type ReadResponse } from './readCore';

export class SheetReader {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (r: ReadResponse | null) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<ReadResponse>) => {
        const cb = this.pending.get(ev.data.id);
        this.pending.delete(ev.data.id);
        cb?.(ev.data);
      };
      this.worker.onerror = () => {
        // worker ใช้ไม่ได้ (เช่น เบราว์เซอร์เก่า) → งานที่ค้างคืนผลว่าง แล้วใช้เธรดหลักต่อจากนี้
        this.worker?.terminate();
        this.worker = null;
        this.pending.forEach((cb) => cb(null));
        this.pending.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  /** อ่านภาพ 1 ภาพ — ข้อมูลภาพถูกโอนให้ worker แล้วทิ้ง (ไม่เก็บ ไม่ส่งออกนอกเครื่อง) */
  read(img: ImageData, mode: ReadRequest['mode'], frame = 0): Promise<{ results: ReadResult[]; ms: number }> {
    const id = ++this.seq;
    const req: ReadRequest = { id, rgba: img.data.buffer as ArrayBuffer, w: img.width, h: img.height, mode, frame };
    if (!this.worker) {
      const r = handleReadRequest(req);
      return Promise.resolve({ results: r.results, ms: r.ms });
    }
    return new Promise((resolve) => {
      this.pending.set(id, (r) => resolve(r ? { results: r.results, ms: r.ms } : { results: [], ms: 0 }));
      this.worker!.postMessage(req, [req.rgba]);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.forEach((cb) => cb(null));
    this.pending.clear();
  }
}
