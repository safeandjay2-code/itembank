// Web Worker: อ่านกระดาษคำตอบนอกเธรดหน้าจอ (หน้าเว็บไม่ค้างระหว่างประมวลผลภาพ) — ภาพอยู่ในหน่วยความจำของเครื่องนี้เท่านั้น
import { handleReadRequest, type ReadRequest } from './readCore';

self.onmessage = (ev: MessageEvent<ReadRequest>) => {
  const res = handleReadRequest(ev.data);
  (self as unknown as Worker).postMessage(res);
};
