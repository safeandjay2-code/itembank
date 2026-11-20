// ห้อง O-NET เฟส 4: วิเคราะห์รายงาน · ขั้นตอนสแกน (อ่าน → ตีความ → ส่ง/ถามครู) · โหมดสาธิตเลียนแบบ RPC · ส่งออก Excel
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { analyzeRoom, answerLabel } from '../../../src/modules/onet/analyze';
import { OnetStabilizer, processRead, readKey, submitInput } from '../../../src/modules/onet/scanFlow';
import { buildOnetXlsx } from '../../../src/modules/onet/xlsx';
import { MemoryOnet, onetDemoKey, type DemoUser } from '../../../src/data/onetMemory';
import { readOnetSheet } from '../../../src/modules/scan/omr';
import type { OnetReportData, OnetSetDetail, OnetSetSummary } from '../../../src/modules/onet/types';
import { renderOnetSheet, type OnetMark } from '../scan/onetSynth';
import { photograph } from '../scan/synth';

// ---------- ข้อมูลตัวอย่าง ----------
function set(code: string, setNo: number): OnetSetDetail {
  return {
    code, setNo, title: `ชุด ${setNo}`, bubbleCode: `${setNo}00`, isFree: true, usable: true,
    items: Array.from({ length: 15 }, (_, i) => ({
      itemNo: i + 1, kind: i < 11 ? 'mcq4' : 'numeric3', points: i < 11 ? 6.5 : 7.125,
      indicatorCode: i < 5 ? 'ค 1.1 ป.6/1' : i < 11 ? 'ค 2.1 ป.6/1' : 'ค 1.1 ป.6/4',
      topic: i < 5 ? 'เศษส่วน' : i < 11 ? 'พื้นที่' : 'ร้อยละ', sourceIndicator: null,
      focus: i === 0 ? 'ฝึกแปลงเศษเกิน' : null, solution: null, traps: i === 2 ? 'บวกตัวส่วน' : null,
    })),
  };
}
const ALL_RIGHT = Array(15).fill(true);
function res(code: string, seat: number, wrong: number[], answers: Array<string | null> = []) {
  const correct = ALL_RIGHT.map((_, i) => !wrong.includes(i + 1));
  const s = set(code, Number(code.slice(1)));
  return {
    setCode: code, seatNo: seat, answers: Array.from({ length: 15 }, (_, i) => answers[i] ?? (correct[i] ? 'ok' : null)),
    correct, score: s.items.reduce((a, it) => a + (correct[it.itemNo - 1] ? it.points : 0), 0),
    bubbledSet: s.bubbleCode, setMismatch: false, remarks: [], scannedAt: '2026-11-20T00:00:00Z',
  };
}

describe('วิเคราะห์ห้อง O-NET', () => {
  const data: OnetReportData = {
    room: { id: 'r', name: 'ป.6', status: 'open', expiresAt: '2027-03-31' },
    sets: [set('S02', 2), set('S01', 1)],
    results: [
      res('S01', 1, [1, 2, 3], [null, null, '2']),
      res('S01', 2, [3], [undefined as any, undefined as any, '2']),
      res('S01', 3, [3, 12], [undefined as any, undefined as any, '2']),
      res('S02', 1, [1, 4, 12, 13]),
      res('S02', 2, []),
    ],
  };
  const a = analyzeRoom(data);

  it('ค่าเฉลี่ยรายชุด เรียงตามเลขชุด · คะแนนเต็ม 100', () => {
    expect(a.sets.map((s) => s.code)).toEqual(['S01', 'S02']);
    expect(a.sets[0].fullScore).toBe(100);
    expect(a.sets[0].n).toBe(3);
    expect(a.sets[0].avg).toBeCloseTo((100 - 19.5 + 100 - 6.5 + 100 - 6.5 - 7.125) / 3, 2);
  });

  it('รายคน: คะแนนทุกชุด + ควรเน้น = แม่แบบที่เสียคะแนนมากสุด + พลาดซ้ำ ≥ 2 ครั้ง', () => {
    const s1 = a.students.find((s) => s.seatNo === 1)!;
    expect(s1.scores.map((x) => x.score)).toEqual([80.5, 100 - 13 - 7.125 * 2]);
    expect(s1.tested).toBe(2);
    // เศษส่วน: ผิด 1,2,3 (S01) + 1,4 (S02) = 5 ข้อ เสีย 32.5 · ร้อยละ: 12,13 (S02) เสีย 14.25
    expect(s1.focusTop[0]).toMatchObject({ key: 'เศษส่วน', count: 5, total: 10, lost: 32.5, focus: 'ฝึกแปลงเศษเกิน' });
    expect(s1.focusTop[1]).toMatchObject({ key: 'ร้อยละ', count: 2 });
    expect(s1.repeated.map((r) => r.key)).toEqual(['เศษส่วน', 'ร้อยละ']);
    const s2 = a.students.find((s) => s.seatNo === 2)!;
    expect(s2.scores[1].score).toBe(100);
    expect(s2.repeated).toEqual([]);
  });

  it('ตัวชี้วัด/แม่แบบที่อ่อนที่สุดอยู่บนสุด', () => {
    expect(a.weakTopics[0].key).toBe('เศษส่วน');
    expect(a.weakIndicators[0].key).toBe('ค 1.1 ป.6/1');
  });

  it('หลงตัวลวง: ข้อ 3 ชุด 1 ทุกคนตอบ ② (≥ 30%) พร้อมกับดัก', () => {
    expect(a.lures[0]).toMatchObject({ setCode: 'S01', itemNo: 3, answer: '2', count: 3, share: 1, traps: 'บวกตัวส่วน', kind: 'mcq4' });
    expect(answerLabel('2', 'mcq4')).toBe('②');
    expect(answerLabel('034', 'numeric3')).toBe('034');
    expect(answerLabel(null, 'mcq4')).toBe('–');
  });

  it('ส่งออก Excel: แผ่นสรุปรายคน + รายชุด + รายข้อ + ตัวชี้วัด', async () => {
    const bytes = await buildOnetXlsx(data, a);
    const zip = await JSZip.loadAsync(bytes);
    const wb = await zip.file('xl/workbook.xml')!.async('string');
    for (const n of ['สรุปรายคน', 'ชุดที่ 1', 'ชุดที่ 2', 'รายข้อ', 'ตัวชี้วัดและแม่แบบ']) expect(wb).toContain(`name="${n}"`);
    const s1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(s1).toContain('เศษส่วน (ผิด 5/10)');
  });
});

// ---------- ขั้นตอนสแกน ----------
const SETS: OnetSetSummary[] = [1, 2, 3].map((n) => ({ code: `S0${n}`, setNo: n, title: '', bubbleCode: `${n}00`, subjectId: 'MATH', gradeId: 'P6',
  isFree: n <= 2, usable: n <= 2, itemCount: 15 }));

function sheet(code: string, seat: [number | null, number] | null, answers: string[]): OnetMark[] {
  const m: OnetMark[] = [{ key: `set:${Number(code.slice(1)) * 100}`, kind: 'dark' }];
  if (seat) { if (seat[0] !== null) m.push({ key: `seat:c0:${seat[0]}`, kind: 'dark' }); m.push({ key: `seat:c1:${seat[1]}`, kind: 'dark' }); }
  answers.forEach((a, i) => {
    if (i < 11) m.push({ key: `q${i + 1}:${a}`, kind: 'dark' });
    else a.split('').forEach((d, c) => m.push({ key: `q${i + 1}:c${c}:${d}`, kind: 'dark' }));
  });
  return m;
}
const read = (code: string, marks: OnetMark[]) => readOnetSheet(photograph(renderOnetSheet({ setCode: code, marks }), { seed: 3, fill: 0.95 }));

describe('ขั้นตอนสแกน O-NET', () => {
  const key = onetDemoKey(1);

  it('เลขที่ชัด → พร้อมส่ง (คำตอบดิบ + รหัสชุดที่ระบาย) ไม่มี remark เรื่องเลขที่', () => {
    const p = processRead(read('S01', sheet('S01', [1, 7], key)), SETS);
    expect(p.kind).toBe('read');
    if (p.kind !== 'read') return;
    expect(p.interp.seat).toMatchObject({ status: 'ok', value: 17 });
    expect(p.interp.answers).toEqual(key);
    const inp = submitInput('room', p, 17);
    expect(inp).toMatchObject({ roomId: 'room', setCode: 'S01', seatNo: 17, bubbledSet: '100', remarks: [] });
  });

  it('ลืมระบาย 0 หลักสิบ → ต้องถามครู (เดาเลขที่ให้) · remark เลขที่ไม่ถูกส่งหลังครูพิมพ์', () => {
    const p = processRead(read('S02', sheet('S02', [null, 5], onetDemoKey(2))), SETS);
    if (p.kind !== 'read') throw new Error(p.message);
    expect(p.interp.seat).toMatchObject({ status: 'missing', suggested: 5 });
    expect(p.interp.remarks.some((r) => r.code === 'seat_unreadable')).toBe(true);
    expect(submitInput('room', p, 5).remarks).toEqual([]);
  });

  it('ชุดที่ยังล็อก → ไม่อ่านคำตอบ แจ้งให้ปลดล็อก', () => {
    const p = processRead(read('S03', sheet('S03', [0, 1], onetDemoKey(3))), SETS);
    expect(p).toEqual({ kind: 'fail', message: 'ชุดที่ 3 ยังไม่ได้ปลดล็อก — สแกนไม่ได้' });
  });

  it('กล้อง: รับเมื่อเหมือนกัน 2 เฟรม · ไม่รับซ้ำขณะแผ่นเดิมยังอยู่ · หายเกิน 1.5 วินาทีแล้วรับใหม่ได้', () => {
    const p = processRead(read('S01', sheet('S01', [0, 3], key)), SETS);
    if (p.kind !== 'read') throw new Error('อ่านไม่ได้');
    const st = new OnetStabilizer(2, 1500);
    expect(st.push(p, 0)).toBeNull();
    expect(st.push(p, 100)).toBe(p);
    expect(st.push(p, 200)).toBeNull();
    expect(st.push(p, 1000)).toBeNull();
    expect(st.push(null, 1200)).toBeNull();
    expect(st.push(p, 3000)).toBeNull();
    expect(st.push(p, 3100)).toBe(p);
    expect(readKey(p)).toContain('S01|ok|3|');
  });
});

// ---------- โหมดสาธิต (เลียนแบบ RPC) ----------
describe('MemoryOnet เลียนแบบ RPC onet_*', () => {
  const users: DemoUser[] = [
    { id: 'own', email: 'o@x', displayName: 'เจ้าของ', schoolName: null, role: 'owner', createdAt: '2026-01-01' },
    { id: 't1', email: 't1@gmail.com', displayName: 'ครู 1', schoolName: 'รร.ก', role: 'onet', createdAt: '2026-11-01' },
  ];
  let me = users[1];
  const api = new MemoryOnet(users, () => me);

  it('ผู้สมัครใหม่: ฟรี 2 ชุด · ชุดล็อกไม่มีวิธีคิด/ไฟล์ · ผู้ดูแลเท่านั้นปลดล็อกได้', async () => {
    me = users[1];
    const c = await api.catalog();
    expect(c.sets.map((s) => s.usable)).toEqual([true, true, false, false, false, false]);
    const d3 = await api.setDetail('S03');
    expect(d3.items[0].solution).toBeNull();
    expect(JSON.stringify(d3)).not.toContain('"answer"');
    await expect(api.file('S03', 'exam')).rejects.toThrow('ยังไม่มีสิทธิ์');
    await expect(api.adminGrant('t1', null)).rejects.toThrow('เฉพาะผู้ดูแล');
  });

  it('สแกนชุดฟรี → ตรวจบนเซิร์ฟเวอร์ · เลขที่ซ้ำ = duplicate · replace = แทนที่ · ชุดล็อกส่งไม่ได้', async () => {
    me = users[1];
    const room = await api.roomCreate('ป.6/1');
    const key = onetDemoKey(1);
    const ok = await api.submit({ roomId: room, setCode: 'S01', seatNo: 4, answers: key, bubbledSet: '100', remarks: [] });
    expect(ok).toMatchObject({ status: 'saved', score: 100, correctCount: 15 });
    const half = [...key.slice(0, 11).map(() => null), ...key.slice(11)];
    expect(await api.submit({ roomId: room, setCode: 'S01', seatNo: 4, answers: half, bubbledSet: null, remarks: [] }))
      .toMatchObject({ status: 'duplicate', existing: { score: 100 } });
    expect(await api.submit({ roomId: room, setCode: 'S01', seatNo: 4, answers: half, bubbledSet: null, remarks: [], replace: true }))
      .toMatchObject({ status: 'replaced', score: 28.5, setMismatch: true });
    await expect(api.submit({ roomId: room, setCode: 'S03', seatNo: 1, answers: onetDemoKey(3), bubbledSet: '300', remarks: [] }))
      .rejects.toThrow('ยังไม่ได้ปลดล็อก');
    const rep = await api.report(room);
    expect(rep.results).toHaveLength(1);
    expect(rep.sets[0].items[0]).not.toHaveProperty('answer');
  });

  it('ผู้ดูแลปลดล็อก → ครูใช้ชุด 3 ได้ · ปิดห้อง = สถิติรวม + ลบรายเลขที่', async () => {
    me = users[0];
    const u = (await api.adminUsers('gmail'))[0];
    expect(u).toMatchObject({ email: 't1@gmail.com', entitled: false, rooms: 1, sheets: 1 });
    await api.adminGrant('t1', 'สลิป 20 พ.ย.');
    me = users[1];
    expect((await api.catalog()).sets[2].usable).toBe(true);
    const room = (await api.roomList())[0];
    expect(await api.submit({ roomId: room.id, setCode: 'S03', seatNo: 4, answers: onetDemoKey(3), bubbledSet: '300', remarks: [] }))
      .toMatchObject({ status: 'saved', score: 100 });
    await api.roomClose(room.id);
    expect((await api.roomList())[0]).toMatchObject({ status: 'closed', sheets: 0 });
    await expect(api.submit({ roomId: room.id, setCode: 'S01', seatNo: 1, answers: onetDemoKey(1), bubbledSet: '100', remarks: [] })).rejects.toThrow('ปิดแล้ว');
    me = users[0];
    const st = await api.adminStats();
    expect(st.items.find((i) => i.setCode === 'S01' && i.itemNo === 1)).toMatchObject({ n: 1, nCorrect: 0, answerCounts: { _blank: 1 } });
    expect(st.items.find((i) => i.setCode === 'S03' && i.itemNo === 12)).toMatchObject({ n: 1, nCorrect: 1 });
  });
});
