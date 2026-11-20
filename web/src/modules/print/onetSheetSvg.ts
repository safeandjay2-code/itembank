// วาดกระดาษคำตอบ O-NET แบบ ON1 (A4 แนวตั้ง 1 แผ่นต่อคน) เป็น SVG หน่วย มม. — SPEC-ONET §5
// เลียนแบบส่วนที่เด็กต้องฝนของกระดาษคำตอบจริง สทศ. 2568: ระบายรหัสชุด 100–600 · ตอนที่ 1 สามคอลัมน์ ①–④
// · ตอนที่ 2 บล็อก หลักร้อย/หลักสิบ/หลักหน่วย วง ⓪–⑨ แนวตั้ง · ของเราเพิ่ม: มุมดำ 4 มุม, QR ON1:S0x:รุ่น, เลขที่ 2 หลัก
// พิมพ์ขาวดำ ถ่ายเอกสารได้ · ไม่มีชื่อนักเรียนในข้อมูล (มีแค่เส้นให้เขียนบนกระดาษ)
import { qrPath, SHEET_FONT } from './answerSheetSvg';
import {
  on1DigitBlock, on1DigitCenter, on1McqCenter, on1McqNumberPos, on1SetCodeCenter, onetQrPayload, setCodeCellW,
  type DigitBlockId, type OnetTemplate,
} from './onetTemplate';

export interface OnetSheetInfo {
  /** รหัสชุด S01–S06 */
  setCode: string;
  /** ชื่อชุดที่แสดงบนหัวกระดาษ เช่น "ชุดติว O-NET คณิตศาสตร์ ป.6 · ชุดที่ 1" */
  subtitle: string;
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const INK = '#1a1a1a';
const SOFT = '#555';
const FILL = '#ececec';

function text(x: number, y: number, s: string, size: number, o: { anchor?: string; bold?: boolean; fill?: string; role?: string } = {}) {
  return `<text x="${r2(x)}" y="${r2(y)}" font-size="${size}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}`
    + `${o.bold ? ' font-weight="700"' : ''}${o.fill ? ` fill="${o.fill}"` : ''}${o.role ? ` data-role="${o.role}"` : ''}>${esc(s)}</text>`;
}

function bubble(x: number, y: number, r: number, label: string) {
  return `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="none" stroke="${INK}" stroke-width="0.28"/>`
    + `<text x="${r2(x)}" y="${r2(y + r * 0.45)}" font-size="${r2(r * 1.25)}" text-anchor="middle" fill="#9a9a9a">${label}</text>`;
}

/** กล่องมุมมนพร้อมแถบหัว (แบบกล่อง "ข้อ 1 – 11" ของจริง) */
function headedBox(x: number, y: number, w: number, h: number, headH: number, title: string, titleSize = 3.6) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="none" stroke="${INK}" stroke-width="0.35"/>`
    + `<path d="M${x} ${y + headH}h${w}" stroke="${INK}" stroke-width="0.3"/>`
    + `<path d="M${x + 1.6} ${y}h${w - 3.2}a1.6 1.6 0 0 1 1.6 1.6v${headH - 1.6}h${-w}v${-(headH - 1.6)}a1.6 1.6 0 0 1 1.6 -1.6z" fill="${FILL}"/>`
    + text(x + 3, y + headH / 2 + titleSize * 0.36, title, titleSize, { bold: true });
}

function digitBlock(t: OnetTemplate, id: DigitBlockId): string {
  const b = on1DigitBlock(t, id);
  const db = t.digit_block;
  const parts: string[] = [];
  parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${db.h}" rx="1.2" fill="none" stroke="${INK}" stroke-width="0.35"/>`);
  parts.push(`<rect x="${b.x + 0.2}" y="${b.y + 0.2}" width="${b.w - 0.4}" height="${db.header_h - 0.2}" rx="1" fill="${FILL}"/>`);
  parts.push(`<path d="M${b.x} ${b.y + db.header_h}h${b.w}" stroke="${INK}" stroke-width="0.3"/>`);
  parts.push(text(b.x + b.w / 2, b.y + db.header_h / 2 + 1.4, b.title, 3.9, { anchor: 'middle', bold: true }));
  // เส้นแบ่งคอลัมน์ (กึ่งกลางระหว่างคอลัมน์)
  for (let c = 1; c < b.colDx.length; c++) {
    const xm = b.x + (b.colDx[c - 1] + b.colDx[c]) / 2;
    parts.push(`<path d="M${r2(xm)} ${b.y + db.header_h}V${b.y + db.h}" stroke="#888" stroke-width="0.2"/>`);
  }
  const lineY = b.y + db.write_y + db.write_h + 1.5;
  parts.push(`<path d="M${b.x} ${lineY}h${b.w}" stroke="#888" stroke-width="0.2"/>`);
  b.colDx.forEach((dx, col) => {
    const cx = b.x + dx;
    parts.push(text(cx, b.y + db.label_y1, b.labels[col][0], 2.5, { anchor: 'middle' }));
    parts.push(text(cx, b.y + db.label_y2, b.labels[col][1], 2.5, { anchor: 'middle' }));
    parts.push(`<rect x="${r2(cx - db.write_w / 2)}" y="${b.y + db.write_y}" width="${db.write_w}" height="${db.write_h}" fill="none" stroke="${SOFT}" stroke-width="0.25"/>`);
    for (let d = 0; d <= 9; d++) {
      const p = on1DigitCenter(t, id, col, d);
      parts.push(bubble(p.x, p.y, db.radius, String(d)));
    }
  });
  return parts.join('');
}

/** สัญลักษณ์ตัวอย่างการระบายผิด: kind = slash | cross | check | half */
function wrongMark(x: number, y: number, r: number, kind: string) {
  const c = `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${INK}" stroke-width="0.28"/>`;
  const s = `stroke="${INK}" stroke-width="0.45" stroke-linecap="round" fill="none"`;
  if (kind === 'slash') return c + `<path d="M${x - r * 0.75} ${y + r * 0.75}L${x + r * 0.75} ${y - r * 0.75}" ${s}/>`;
  if (kind === 'cross') return c + `<path d="M${x - r * 0.7} ${y - r * 0.7}L${x + r * 0.7} ${y + r * 0.7}M${x - r * 0.7} ${y + r * 0.7}L${x + r * 0.7} ${y - r * 0.7}" ${s}/>`;
  if (kind === 'check') return c + `<path d="M${x - r * 0.7} ${y}L${x - r * 0.15} ${y + r * 0.6}L${x + r * 0.8} ${y - r * 0.7}" ${s}/>`;
  return c + `<path d="M${x} ${y - r}A${r} ${r} 0 0 1 ${x} ${y + r}z" fill="${INK}"/>`;
}

export function onetSheetSvg(t: OnetTemplate, s: OnetSheetInfo): string {
  const W = t.paper.width, H = t.paper.height;
  const P: string[] = [];
  P.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
  // มุมดำ
  const k = t.corner_marks.size;
  t.corner_marks.top_left.forEach(([x, y]) => P.push(`<rect x="${x}" y="${y}" width="${k}" height="${k}" fill="#000"/>`));
  // QR + ป้ายใต้ QR
  const q = t.qr;
  P.push(qrPath(onetQrPayload({ setCode: s.setCode, template: t.version }), q.x, q.y, q.size, q.ecc));
  P.push(text(q.x + q.size / 2, q.y + q.size + 2.6, `ON${t.version} · ${s.setCode}`, 2.6, { anchor: 'middle', fill: '#888' }));

  // หัวกระดาษ
  const cx = t.header.center_x, hx = t.header.x;
  P.push(text(cx, 19.5, '** กระดาษคำตอบ รหัสวิชา 64 คณิตศาสตร์ **', 6.2, { anchor: 'middle', bold: true, role: 'title' }));
  P.push(text(cx, 26.5, s.subtitle, 4.4, { anchor: 'middle', role: 'subtitle' }));
  P.push(text(hx, 34, 'คำชี้แจง : ให้นักเรียนระบายรหัสชุดข้อสอบที่ปรากฏบนหน้าปกแบบทดสอบ', 3.6, { bold: false }));
  P.push(text(hx + 15.5, 39, 'และระบายเลขที่ของตนเองให้ถูกต้อง จึงจะได้คะแนน', 3.6));
  P.push(text(hx, 47.5, 'ชื่อ-สกุล ..............................................................  ห้อง ...........', 3.8));

  // รหัสชุดข้อสอบ 100–600
  const sc = t.set_code, cw = setCodeCellW(t);
  P.push(`<rect x="${sc.x}" y="${sc.y}" width="${sc.w}" height="${sc.h}" rx="1.2" fill="none" stroke="${INK}" stroke-width="0.35"/>`);
  P.push(`<rect x="${sc.x + 0.2}" y="${sc.y + 0.2}" width="${sc.w - 0.4}" height="${sc.header_h - 0.2}" rx="1" fill="${FILL}"/>`);
  P.push(`<path d="M${sc.x} ${sc.y + sc.header_h}h${sc.w}" stroke="${INK}" stroke-width="0.3"/>`);
  P.push(text(sc.x + sc.w / 2, sc.y + sc.header_h / 2 + 1.3, 'รหัสชุดข้อสอบวิชาคณิตศาสตร์', 3.6, { anchor: 'middle', bold: true }));
  sc.codes.forEach((code, i) => {
    if (i > 0) P.push(`<path d="M${r2(sc.x + i * cw)} ${sc.y + sc.header_h}V${sc.y + sc.h}" stroke="#888" stroke-width="0.2"/>`);
    const p = on1SetCodeCenter(t, i);
    P.push(`<circle cx="${r2(p.x)}" cy="${p.y}" r="${sc.radius}" fill="none" stroke="${INK}" stroke-width="0.28"/>`);
    P.push(text(p.x + sc.radius + 2, p.y + 1.4, String(code), 3.9, { bold: true }));
  });

  // เลขที่ 2 หลัก
  P.push(digitBlock(t, 'seat'));

  // ตอนที่ 1
  const m = t.mcq, mb = m.box;
  P.push(text(mb.x, 81, `ตอนที่ 1 : แบบปรนัย 4 ตัวเลือก จำนวน ${m.last_item - m.first_item + 1} ข้อ`, 3.9, { bold: true }));
  P.push(text(mb.x + 4, 87, 'วิธีการตอบ  ระบาย 1 คำตอบที่เป็นคำตอบที่ถูกที่สุดในแต่ละข้อ', 3.6));
  P.push(headedBox(mb.x, mb.y, mb.w, mb.h, mb.header_h, `ข้อ ${m.first_item} – ${m.last_item}`));
  for (let n = m.first_item; n <= m.last_item; n++) {
    const np = on1McqNumberPos(t, n);
    P.push(text(np.x, np.y + 1.45, String(n), 4, { anchor: 'end', bold: true }));
    for (let c = 1; c <= m.choices; c++) {
      const p = on1McqCenter(t, n, c);
      P.push(bubble(p.x, p.y, m.radius, String(c)));
    }
  }

  // ตัวอย่างการระบาย + คำแนะนำเลขที่
  const ex = { x: mb.x, y: 136.5, w: mb.w, h: 20.5 };
  P.push(`<rect x="${ex.x}" y="${ex.y}" width="${ex.w}" height="${ex.h}" rx="1.2" fill="none" stroke="#888" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>`);
  P.push(text(ex.x + 3, ex.y + 6, 'ตัวอย่างการระบาย   ถูก', 3.5, { bold: true }));
  P.push(`<circle cx="${ex.x + 41}" cy="${ex.y + 4.8}" r="2.3" fill="#111"/>`);
  P.push(text(ex.x + 50, ex.y + 6, 'ผิด', 3.5, { bold: true }));
  ['slash', 'cross', 'check', 'half'].forEach((kd, i) => P.push(wrongMark(ex.x + 60 + i * 7, ex.y + 4.8, 2.3, kd)));
  P.push(text(ex.x + 92, ex.y + 6, 'ใช้ดินสอ 2B ฝนให้เต็มวง', 3.3));
  P.push(text(ex.x + 3, ex.y + 12, 'เลขที่ : เขียนตัวเลขในช่อง แล้วระบายให้ตรงกัน ทั้ง 2 หลัก', 3.3));
  P.push(text(ex.x + 3, ex.y + 17.2, 'เลขที่ 1–9 ให้ระบาย 0 ที่หลักสิบ เช่น เลขที่ 7 → 0 7 · เปลี่ยนคำตอบให้ลบรอยเดิมให้สะอาด', 3.3));

  // ตอนที่ 2
  const nm = t.numeric, nb = nm.box;
  P.push(text(nb.x, 166.5, `ตอนที่ 2 : แบบระบายตัวเลขที่เป็นคำตอบ จำนวน ${nm.items.length} ข้อ`, 3.9, { bold: true }));
  P.push(text(nb.x + 4, 172.5, 'วิธีการตอบ  เขียนคำตอบในช่อง แล้วระบายตัวเลขให้ตรงกัน · คำตอบไม่ถึง 3 หลัก ให้ระบาย 0 ข้างหน้า เช่น 27 → 0 2 7', 3.4));
  P.push(headedBox(nb.x, nb.y, nb.w, nb.h, nb.header_h, `ข้อ ${nm.items[0]} – ${nm.items[nm.items.length - 1]}`));
  nm.items.forEach((n) => P.push(digitBlock(t, n)));

  // เครดิต
  P.push(text(W / 2, t.credit.y, 'Created by Teacher Worawut Laowang', 2.6, { anchor: 'middle', fill: '#c4c4c4' }));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" `
    + `font-family="${SHEET_FONT.replace(/"/g, '')}" fill="${INK}" data-template="ON${t.version}" data-set="${s.setCode}">${P.join('')}</svg>`;
}
