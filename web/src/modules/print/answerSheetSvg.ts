// วาดกระดาษคำตอบ A5 1 แผ่นเป็น SVG (หน่วย = มม. ตามแบบกระดาษ) — ไม่มีชื่อนักเรียน (SPEC §7.2, §10)
// มุมดำ 4 มุม + QR (รหัสชุดข้อสอบ/ชุด/เลขที่/รุ่นแบบกระดาษ) + วงกลมฝน ①–④ เฉพาะข้อที่มีในชุด
import QRCode from 'qrcode';
import { bubbleCenter, numberPos, qrPayload, type SheetTemplate } from './template';

export interface SheetInfo {
  examId: string;
  title: string;
  gradeShort: string;
  itemCount: number;
  setNo: number;
  seatNo: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n: number) => Math.round(n * 1000) / 1000;
export const SHEET_FONT = "'TH Sarabun New', 'PrintThai', Sarabun, sans-serif";

/** QR เป็นสี่เหลี่ยมโมดูล (path เดียว) พร้อมขอบเงียบ 4 โมดูลภายในกรอบที่แบบกระดาษกำหนด */
export function qrPath(text: string, x: number, y: number, size: number, ecc: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: ecc as QRCode.QRCodeErrorCorrectionLevel });
  const n = qr.modules.size;
  const m = size / (n + 8);
  let d = '';
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++)
      if (qr.modules.get(row, col)) d += `M${r2(x + (col + 4) * m)} ${r2(y + (row + 4) * m)}h${r2(m)}v${r2(m)}h${r2(-m)}z`;
  return `<path d="${d}" fill="#000" shape-rendering="crispEdges"/>`;
}

export function answerSheetSvg(t: SheetTemplate, s: SheetInfo): string {
  const W = t.paper.width, H = t.paper.height;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
  // มุมดำ
  const k = t.corner_marks.size;
  t.corner_marks.top_left.forEach(([x, y]) => parts.push(`<rect x="${x}" y="${y}" width="${k}" height="${k}" fill="#000"/>`));
  // QR
  parts.push(qrPath(qrPayload({ examId: s.examId, setNo: s.setNo, seatNo: s.seatNo, template: t.version }), t.qr.x, t.qr.y, t.qr.size, t.qr.ecc));
  // หัวกระดาษ (คนอ่าน): ชื่อการสอบ ชั้น เลขที่ ชุด
  const hx = t.header.x, hy = t.header.y;
  parts.push(`<text x="${hx}" y="${hy + 4.5}" font-size="5.2" font-weight="700">กระดาษคำตอบ</text>`);
  parts.push(`<text x="${hx}" y="${hy + 10.5}" font-size="4.4" data-role="title">${esc(clip(s.title, 34))}</text>`);
  parts.push(`<text x="${hx}" y="${hy + 19}" font-size="7" font-weight="700" data-role="seat">`
    + `ชั้น ${esc(s.gradeShort)}   เลขที่ ${s.seatNo}   ชุดที่ ${s.setNo}</text>`);
  parts.push(`<text x="${hx}" y="${hy + 25.5}" font-size="3.7" fill="#333">จำนวน ${s.itemCount} ข้อ · ฝนวงกลมให้เต็มวงเพียงวงเดียวในแต่ละข้อ</text>`);
  parts.push(`<text x="${hx}" y="${hy + 30.5}" font-size="3.7" fill="#333">ตัวอย่าง</text>`
    + `<circle cx="${hx + 14}" cy="${hy + 29.3}" r="${t.bubbles.radius}" fill="#000"/>`
    + `<text x="${hx + 18.5}" y="${hy + 30.5}" font-size="3.7" fill="#333">ถ้าเปลี่ยนคำตอบ ลบรอยเดิมให้สะอาด</text>`);
  // หัวคอลัมน์ ข้อ 1 2 3 4 (เฉพาะคอลัมน์ที่ใช้)
  const b = t.bubbles;
  const usedCols = Math.ceil(s.itemCount / b.rows);
  for (let c = 0; c < usedCols; c++) {
    const n0 = c * b.rows + 1;
    const np = numberPos(t, n0);
    parts.push(`<text x="${np.x + 3}" y="${b.label_y}" font-size="3.4" text-anchor="end" fill="#333">ข้อ</text>`);
    for (let ch = 1; ch <= b.choices; ch++) {
      const p = bubbleCenter(t, n0, ch);
      parts.push(`<text x="${p.x}" y="${b.label_y}" font-size="3.6" text-anchor="middle" font-weight="700">${ch}</text>`);
    }
  }
  // ข้อ + วงกลม
  for (let n = 1; n <= s.itemCount; n++) {
    const np = numberPos(t, n);
    parts.push(`<text x="${np.x + 3}" y="${r2(np.y + 1.3)}" font-size="3.9" text-anchor="end" font-weight="700">${n}</text>`);
    for (let ch = 1; ch <= b.choices; ch++) {
      const p = bubbleCenter(t, n, ch);
      parts.push(`<circle cx="${r2(p.x)}" cy="${r2(p.y)}" r="${b.radius}" fill="none" stroke="#222" stroke-width="0.28"/>`
        + `<text x="${r2(p.x)}" y="${r2(p.y + 1.05)}" font-size="2.9" text-anchor="middle" fill="#9a9a9a">${ch}</text>`);
    }
  }
  // สำหรับผู้ตรวจ
  const sc = t.scorer;
  parts.push(`<text x="${sc.x}" y="${sc.y + 5}" font-size="3.8">สำหรับผู้ตรวจ   คะแนน .............. / ${s.itemCount}   ผู้ตรวจ ..............................</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" `
    + `font-family="${SHEET_FONT.replace(/"/g, '')}" data-seat="${s.seatNo}" data-set="${s.setNo}">${parts.join('')}</svg>`;
}

function clip(s: string, n: number) { return [...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s; }
