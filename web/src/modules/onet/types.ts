// ชนิดข้อมูลห้อง O-NET (SPEC-ONET §4) — ตรงกับผลของ RPC onet_* ใน migration 0015
// เฉลยไม่เคยมาถึงเครื่องครู: onet_submit ตรวจคะแนนบนเซิร์ฟเวอร์ แล้วคืน correct[] รายข้อ
import type { OnetRemark } from '../scan/onetGrade';

export interface OnetSetSummary {
  code: string;          // 'S01'
  setNo: number;
  title: string;
  bubbleCode: string;    // '100'
  subjectId: string;
  gradeId: string;
  isFree: boolean;
  /** ผู้ใช้ปัจจุบันใช้ชุดนี้ได้ (ฟรี / ปลดล็อกแล้ว / ผู้ดูแล) */
  usable: boolean;
  itemCount: number;
}

export interface OnetCatalog {
  role: string;
  entitled: boolean;
  priceText: string;
  paymentText: string;
  sets: OnetSetSummary[];
}

export interface OnetItemInfo {
  itemNo: number;
  kind: 'mcq4' | 'numeric3';
  points: number;
  indicatorCode: string;
  topic: string;
  sourceIndicator: string | null;
  focus: string | null;
  /** วิธีคิด/กับดัก — ได้เฉพาะชุดที่ใช้ได้ */
  solution: string | null;
  traps: string | null;
}

export interface OnetSetDetail {
  code: string;
  setNo: number;
  title: string;
  bubbleCode: string;
  isFree: boolean;
  usable: boolean;
  items: OnetItemInfo[];
}

export interface OnetRoom {
  id: string;
  name: string;
  status: 'open' | 'closed';
  expiresAt: string;
  createdAt: string;
  closedAt: string | null;
  students: number;
  sheets: number;
}

export interface OnetSubmitInput {
  roomId: string;
  setCode: string;
  seatNo: number;
  answers: Array<string | null>;
  bubbledSet: string | null;
  remarks: OnetRemark[];
  replace?: boolean;
}

export type OnetSubmitResult =
  | { status: 'saved' | 'replaced'; seatNo: number; score: number; correctCount: number; itemCount: number; correct: boolean[]; setMismatch: boolean }
  | { status: 'duplicate'; seatNo: number; existing: { score: number; scannedAt: string } };

export interface OnetResult {
  setCode: string;
  seatNo: number;
  answers: Array<string | null>;
  correct: boolean[];
  score: number;
  bubbledSet: string | null;
  setMismatch: boolean;
  remarks: OnetRemark[];
  scannedAt: string;
}

export interface OnetReportData {
  room: { id: string; name: string; status: 'open' | 'closed'; expiresAt: string };
  sets: OnetSetDetail[];
  results: OnetResult[];
}

/** ไฟล์ของชุดใน Storage bucket 'onet' (ชื่อไฟล์ภาษาอังกฤษ — Storage ไม่รับชื่อไทย) */
export type OnetFileKind = 'exam' | 'key' | 'slides';
export const ONET_FILES: Record<OnetFileKind, { path: string; label: string; download: (setNo: number) => string }> = {
  exam: { path: 'exam.pdf', label: 'ข้อสอบ (PDF)', download: (n) => `ONET-P6-คณิต-ชุดที่${n}-ข้อสอบ.pdf` },
  key: { path: 'key.pdf', label: 'เฉลยย่อ (PDF)', download: (n) => `ONET-P6-คณิต-ชุดที่${n}-เฉลยย่อ.pdf` },
  slides: { path: 'slides.html', label: 'สไลด์เฉลย', download: (n) => `ONET-P6-คณิต-ชุดที่${n}-สไลด์เฉลย.html` },
};

export interface OnetAdminUser {
  id: string;
  email: string;
  displayName: string | null;
  schoolName: string | null;
  role: string;
  createdAt: string;
  entitled: boolean;
  grantedAt: string | null;
  note: string | null;
  rooms: number;
  sheets: number;
}

export interface OnetAdminStats {
  users: number;
  entitled: number;
  openRooms: number;
  sheets: number;
  items: Array<{ setCode: string; itemNo: number; n: number; nCorrect: number; p: number | null; answerCounts: Record<string, number> }>;
}

export interface OnetApi {
  catalog(): Promise<OnetCatalog>;
  setDetail(code: string): Promise<OnetSetDetail>;
  /** ไฟล์ของชุด (ต้องมีสิทธิ์ชุดนั้น — Storage ตรวจ policy) · null = ยังไม่มีไฟล์ */
  file(code: string, kind: OnetFileKind): Promise<Blob | null>;

  roomList(): Promise<OnetRoom[]>;
  roomCreate(name: string): Promise<string>;
  roomRename(id: string, name: string): Promise<void>;
  /** ปิดห้อง: รวมสถิติรายข้อ แล้วลบผลรายเลขที่ (ย้อนกลับไม่ได้) */
  roomClose(id: string): Promise<void>;
  roomDelete(id: string): Promise<void>;

  submit(input: OnetSubmitInput): Promise<OnetSubmitResult>;
  resultDelete(roomId: string, setCode: string, seatNo: number): Promise<void>;
  report(roomId: string): Promise<OnetReportData>;

  adminUsers(query: string): Promise<OnetAdminUser[]>;
  adminGrant(userId: string, note: string | null): Promise<void>;
  adminRevoke(userId: string): Promise<void>;
  adminStats(): Promise<OnetAdminStats>;
}
