// ห้อง O-NET ในโหมดสาธิต (หน่วยความจำ) — เลียนแบบ RPC onet_* ของ migration 0015
// ชุดสาธิตใช้ "เฉลยปลอม" (ONET_DEMO_KEY) ไม่ใช่เฉลยชุดติวจริง — repo เป็นสาธารณะ ห้ามใส่เฉลยจริงที่นี่
import {
  type OnetAdminStats, type OnetAdminUser, type OnetApi, type OnetCatalog, type OnetFileKind, type OnetReportData,
  type OnetResult, type OnetRoom, type OnetSetDetail, type OnetSubmitInput, type OnetSubmitResult,
} from '../modules/onet/types';

export const ONET_DEMO_EMAIL = 'onet@itembank.local';

export interface DemoUser { id: string; email: string; displayName: string; schoolName: string | null; role: 'owner' | 'onet'; createdAt: string }

/** เฉลยปลอมของชุดสาธิต: ปรนัยข้อ 1–11 · ระบายตัวเลขข้อ 12–15 */
export function onetDemoKey(setNo: number): string[] {
  const out: string[] = [];
  for (let n = 1; n <= 11; n++) out.push(String(((n + setNo) % 4) + 1));
  for (let n = 12; n <= 15; n++) out.push(String((setNo * 37 + n * 53) % 1000).padStart(3, '0'));
  return out;
}

const IND = ['ค 1.1 ป.6/1', 'ค 1.1 ป.6/4', 'ค 1.1 ป.6/7', 'ค 2.1 ป.6/1', 'ค 2.2 ป.6/2', 'ค 3.1 ป.6/1'];
const TOPIC = ['เศษส่วน', 'ทศนิยม', 'ร้อยละ', 'ความยาว/พื้นที่', 'รูปเรขาคณิต', 'แผนภูมิ'];

function demoSet(setNo: number) {
  const key = onetDemoKey(setNo);
  return {
    code: `S0${setNo}`, setNo, title: `ชุดสาธิต O-NET คณิต ป.6 ชุดที่ ${setNo}`, bubbleCode: `${setNo}00`, isFree: setNo <= 2,
    items: key.map((answer, i) => ({
      itemNo: i + 1, kind: (i < 11 ? 'mcq4' : 'numeric3') as 'mcq4' | 'numeric3', answer, points: i < 11 ? 6.5 : 7.125,
      indicatorCode: IND[(i + setNo) % IND.length], topic: TOPIC[(i * 2 + setNo) % TOPIC.length], sourceIndicator: null,
      focus: i % 3 === 0 ? `ฝึก${TOPIC[(i * 2 + setNo) % TOPIC.length]}แบบหลายขั้น` : null,
      solution: `วิธีคิดสาธิตข้อ ${i + 1}`, traps: i < 11 ? `ตัวลวงสาธิต: ลืมทำขั้นสุดท้าย` : 'ลืมระบาย 0 นำหน้า',
    })),
  };
}

const SLIDES_DEMO = (n: number) => `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>สไลด์เฉลยสาธิต</title>
<style>body{font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#fff}</style></head>
<body><h1 id="t">สไลด์เฉลยสาธิต ชุดที่ ${n}</h1></body></html>`;

interface MemRoom { id: string; ownerId: string; name: string; status: 'open' | 'closed'; expiresAt: string; createdAt: string; closedAt: string | null }
interface MemResult extends OnetResult { roomId: string }

export class MemoryOnet implements OnetApi {
  private sets = [1, 2, 3, 4, 5, 6].map(demoSet);
  private rooms: MemRoom[] = [];
  private results: MemResult[] = [];
  private entitlements = new Map<string, { grantedAt: string; note: string | null }>();
  private stats = new Map<string, { n: number; nCorrect: number; counts: Record<string, number> }>();
  private seq = 0;
  /** วันหมดอายุห้องใหม่ (ปรับได้ในชุดทดสอบ) */
  expireDate = '2027-03-31';
  priceText = 'ปลดล็อกชุดที่ 3–6';
  paymentText = 'โอนพร้อมเพย์ (สาธิต) แล้วส่งสลิปให้ครูวรวุฒิ';

  constructor(private users: DemoUser[], private current: () => DemoUser | null) {}

  private me(): DemoUser {
    const u = this.current();
    if (!u) throw new Error('ต้องเข้าสู่ระบบก่อน');
    return u;
  }
  private isAdmin() { return this.me().role === 'owner'; }
  private entitled() { return this.isAdmin() || this.entitlements.has(this.me().id); }
  private canUse(code: string) {
    const s = this.sets.find((x) => x.code === code);
    return !!s && (this.isAdmin() || s.isFree || this.entitlements.has(this.me().id));
  }
  private set(code: string) {
    const s = this.sets.find((x) => x.code === code);
    if (!s) throw new Error('ไม่พบชุด O-NET');
    return s;
  }
  private room(id: string, open = true): MemRoom {
    const r = this.rooms.find((x) => x.id === id && (x.ownerId === this.me().id || this.isAdmin()));
    if (!r) throw new Error('ไม่พบห้อง O-NET');
    if (open && r.status !== 'open') throw new Error('ห้องนี้ปิดแล้ว');
    if (open && r.expiresAt < today()) throw new Error('ห้องนี้หมดอายุแล้ว');
    return r;
  }

  async catalog(): Promise<OnetCatalog> {
    const u = this.me();
    return {
      role: u.role, entitled: this.entitled(), priceText: this.priceText, paymentText: this.paymentText,
      sets: this.sets.map((s) => ({ code: s.code, setNo: s.setNo, title: s.title, bubbleCode: s.bubbleCode, subjectId: 'MATH', gradeId: 'P6',
        isFree: s.isFree, usable: this.canUse(s.code), itemCount: s.items.length })),
    };
  }

  async setDetail(code: string): Promise<OnetSetDetail> {
    this.me();
    const s = this.set(code);
    const use = this.canUse(code);
    return {
      code: s.code, setNo: s.setNo, title: s.title, bubbleCode: s.bubbleCode, isFree: s.isFree, usable: use,
      items: s.items.map(({ answer: _a, ...i }) => ({ ...i, solution: use ? i.solution : null, traps: use ? i.traps : null })),
    };
  }

  async file(code: string, kind: OnetFileKind): Promise<Blob | null> {
    const s = this.set(code);
    if (!this.canUse(code)) throw new Error('ยังไม่มีสิทธิ์ดาวน์โหลดไฟล์ของชุดนี้');
    if (kind === 'slides') return new Blob([SLIDES_DEMO(s.setNo)], { type: 'text/html' });
    return new Blob([`%PDF-1.4\n% ไฟล์สาธิต ${s.code} ${kind}\n`], { type: 'application/pdf' });
  }

  private finalize(r: MemRoom) {
    for (const x of this.results.filter((y) => y.roomId === r.id)) {
      x.answers.forEach((a, i) => {
        const k = `${x.setCode}:${i + 1}`;
        const st = this.stats.get(k) ?? { n: 0, nCorrect: 0, counts: {} };
        st.n += 1; if (x.correct[i]) st.nCorrect += 1;
        const key = a ?? '_blank';
        st.counts[key] = (st.counts[key] ?? 0) + 1;
        this.stats.set(k, st);
      });
    }
    this.results = this.results.filter((y) => y.roomId !== r.id);
    r.status = 'closed';
    r.closedAt = new Date().toISOString();
  }

  async roomList(): Promise<OnetRoom[]> {
    const u = this.me();
    this.rooms.filter((r) => r.status === 'open' && r.expiresAt < today() && r.ownerId === u.id).forEach((r) => this.finalize(r));
    return this.rooms.filter((r) => r.ownerId === u.id)
      .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'open' ? -1 : 1))
      .map((r) => {
        const rs = this.results.filter((x) => x.roomId === r.id);
        return { id: r.id, name: r.name, status: r.status, expiresAt: r.expiresAt, createdAt: r.createdAt, closedAt: r.closedAt,
          students: new Set(rs.map((x) => x.seatNo)).size, sheets: rs.length };
      });
  }

  async roomCreate(name: string): Promise<string> {
    const u = this.me();
    if (!name.trim()) throw new Error('กรุณาตั้งชื่อห้อง');
    if (this.rooms.filter((r) => r.ownerId === u.id && r.status === 'open').length >= 10) throw new Error('เปิดห้องได้สูงสุด 10 ห้อง กรุณาปิดห้องเก่าก่อน');
    const id = `onet-room-${++this.seq}`;
    this.rooms.push({ id, ownerId: u.id, name: name.trim(), status: 'open', expiresAt: this.expireDate, createdAt: new Date(Date.now() + this.seq).toISOString(), closedAt: null });
    return id;
  }
  async roomRename(id: string, name: string) {
    const r = this.room(id, false);
    if (!name.trim()) throw new Error('กรุณาตั้งชื่อห้อง');
    r.name = name.trim();
  }
  async roomClose(id: string) {
    const r = this.room(id, false);
    if (r.status === 'closed') throw new Error('ห้องนี้ปิดแล้ว');
    this.finalize(r);
  }
  async roomDelete(id: string) {
    const r = this.room(id, false);
    if (this.results.some((x) => x.roomId === r.id)) throw new Error('ห้องนี้ยังมีผลสอบ กรุณาปิดห้องก่อนลบ');
    this.rooms = this.rooms.filter((x) => x !== r);
  }

  async submit(i: OnetSubmitInput): Promise<OnetSubmitResult> {
    const r = this.room(i.roomId, true);
    if (!this.canUse(i.setCode)) throw new Error('ชุดนี้ยังไม่ได้ปลดล็อก');
    if (!(i.seatNo >= 1 && i.seatNo <= 99)) throw new Error('เลขที่ต้องอยู่ระหว่าง 1–99');
    const s = this.set(i.setCode);
    if (i.answers.length !== s.items.length) throw new Error(`จำนวนคำตอบไม่ตรงกับจำนวนข้อ (${s.items.length} ข้อ)`);
    const old = this.results.find((x) => x.roomId === r.id && x.setCode === i.setCode && x.seatNo === i.seatNo);
    if (old && !i.replace) return { status: 'duplicate', seatNo: i.seatNo, existing: { score: old.score, scannedAt: old.scannedAt } };
    const correct = s.items.map((it, k) => i.answers[k] === it.answer);
    const score = s.items.reduce((a, it, k) => a + (correct[k] ? it.points : 0), 0);
    const res: MemResult = { roomId: r.id, setCode: i.setCode, seatNo: i.seatNo, answers: [...i.answers], correct, score,
      bubbledSet: i.bubbledSet, setMismatch: i.bubbledSet !== s.bubbleCode, remarks: [...i.remarks], scannedAt: new Date().toISOString() };
    this.results = [...this.results.filter((x) => x !== old), res];
    return { status: old ? 'replaced' : 'saved', seatNo: i.seatNo, score, correctCount: correct.filter(Boolean).length,
      itemCount: s.items.length, correct, setMismatch: res.setMismatch };
  }

  async resultDelete(roomId: string, setCode: string, seatNo: number) {
    const r = this.room(roomId, true);
    const n = this.results.length;
    this.results = this.results.filter((x) => !(x.roomId === r.id && x.setCode === setCode && x.seatNo === seatNo));
    if (n === this.results.length) throw new Error(`ไม่พบผลของเลขที่ ${seatNo}`);
  }

  async report(roomId: string): Promise<OnetReportData> {
    const r = this.room(roomId, false);
    const rs = this.results.filter((x) => x.roomId === r.id);
    const codes = [...new Set(rs.map((x) => x.setCode))];
    const sets = await Promise.all(this.sets.filter((s) => codes.includes(s.code)).map((s) => this.setDetail(s.code)));
    const setNo = (c: string) => this.set(c).setNo;
    return {
      room: { id: r.id, name: r.name, status: r.status, expiresAt: r.expiresAt },
      sets,
      results: rs.sort((a, b) => setNo(a.setCode) - setNo(b.setCode) || a.seatNo - b.seatNo).map(({ roomId: _r, ...x }) => structuredClone(x)),
    };
  }

  private requireAdmin() { if (!this.isAdmin()) throw new Error('เฉพาะผู้ดูแลระบบ'); }

  async adminUsers(query: string): Promise<OnetAdminUser[]> {
    this.requireAdmin();
    const q = query.trim().toLowerCase();
    return this.users
      .filter((u) => !q || u.email.includes(q) || u.displayName.toLowerCase().includes(q) || (u.schoolName ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((u) => {
        const e = this.entitlements.get(u.id);
        const rooms = this.rooms.filter((r) => r.ownerId === u.id);
        return { id: u.id, email: u.email, displayName: u.displayName, schoolName: u.schoolName, role: u.role, createdAt: u.createdAt,
          entitled: !!e, grantedAt: e?.grantedAt ?? null, note: e?.note ?? null, rooms: rooms.length,
          sheets: this.results.filter((x) => rooms.some((r) => r.id === x.roomId)).length };
      });
  }
  async adminGrant(userId: string, note: string | null) {
    this.requireAdmin();
    if (!this.users.some((u) => u.id === userId)) throw new Error('ไม่พบผู้ใช้');
    this.entitlements.set(userId, { grantedAt: new Date().toISOString(), note });
  }
  async adminRevoke(userId: string) { this.requireAdmin(); this.entitlements.delete(userId); }
  async adminStats(): Promise<OnetAdminStats> {
    this.requireAdmin();
    return {
      users: this.users.filter((u) => u.role === 'onet').length, entitled: this.entitlements.size,
      openRooms: this.rooms.filter((r) => r.status === 'open').length, sheets: this.results.length,
      items: [...this.stats.entries()].map(([k, s]) => {
        const [setCode, n] = k.split(':');
        return { setCode, itemNo: Number(n), n: s.n, nCorrect: s.nCorrect, p: s.n ? Math.round((s.nCorrect / s.n) * 1000) / 1000 : null, answerCounts: { ...s.counts } };
      }).sort((a, b) => a.setCode.localeCompare(b.setCode) || a.itemNo - b.itemNo),
    };
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
