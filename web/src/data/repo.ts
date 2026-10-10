// ชั้นเข้าถึงข้อมูล (Repository) — หน้าจอทุกหน้าคุยกับ interface นี้เท่านั้น
// เปลี่ยนผู้ให้บริการฐานข้อมูลได้โดยเขียน implementation ใหม่ ไม่ต้องแก้หน้าจอ (SPEC §3.1, §3.10)
import type {
  BankExport, CognitiveLevel, CoverageCell, DifficultyLevel, ExamCreateInput, ExamDetail, ExamSummary, Grade, ImportReport,
  Indicator, ItemDetail, ItemFilter, ItemPage, ItemStatus, PoolItem, Profile, SaveItemInput, ScanAnswer, ScanResponse, ScanSaveInput,
  ScanSaveResult, Settings, ClosedSummary,
} from '../core/types';

export interface AuthState {
  signedIn: boolean;
  email: string | null;
}

export interface Repo {
  readonly mode: 'supabase' | 'memory';
  getAuth(): Promise<AuthState>;
  onAuthChange(cb: (s: AuthState) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** ล็อกอินด้วยบัญชี Google (เปลี่ยนหน้าไป Google แล้วกลับมา) */
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;

  getProfile(): Promise<Profile | null>;
  getGrades(): Promise<Grade[]>;
  getIndicators(subjectId: string): Promise<Indicator[]>;
  getDifficultyLevels(): Promise<DifficultyLevel[]>;
  getCoverage(subjectId: string): Promise<CoverageCell[]>;
  getSettings(): Promise<Settings>;

  // ---------- คลังข้อสอบ (เฟส 2) ----------
  getCognitiveLevels(): Promise<CognitiveLevel[]>;
  /** ค้นหาข้อ เรียงตาม ชั้น → ลำดับตัวชี้วัด → ความยาก → รหัสข้อ */
  listItems(subjectId: string, filter: ItemFilter): Promise<ItemPage>;
  getItem(id: string): Promise<ItemDetail | null>;
  /** บันทึกข้อ คืนค่า id ของข้อ (กฎเวอร์ชัน/สถานะบังคับที่ฐานข้อมูล) */
  saveItem(input: SaveItemInput): Promise<string>;
  setItemStatus(id: string, status: ItemStatus, note?: string): Promise<void>;
  deleteItem(id: string): Promise<void>;
  exportBank(subjectId: string, includeSamples: boolean): Promise<BankExport>;
  importBank(data: unknown, dryRun: boolean): Promise<ImportReport>;

  // ---------- ประกอบชุดข้อสอบ (เฟส 3) ----------
  /** ข้อพร้อมใช้ (ตรวจแล้ว/ใช้งาน) แบบข้อมูลย่อ ไม่มีโจทย์ — ใช้เลือกข้อและสลับในหน้าเว็บ */
  getAssemblyPool(subjectId: string): Promise<PoolItem[]>;
  /** บันทึกชุดข้อสอบ (ฐานข้อมูลตรวจกฎ §6 ซ้ำทั้งหมด) คืนค่า id ของชุด */
  createExam(input: ExamCreateInput): Promise<string>;
  /** รายการชุดข้อสอบ (ก่อนคืนผล ชุดที่ครบกำหนดหมดอายุจะถูกปิดอัตโนมัติ — SPEC §10) */
  listExams(subjectId: string): Promise<ExamSummary[]>;
  getExam(id: string): Promise<ExamDetail | null>;
  /** ลบชุดที่ยังไม่เริ่มสอบและยังไม่มีคำตอบ */
  deleteExam(id: string): Promise<void>;

  // ---------- เอกสารพิมพ์ (เฟส 4) ----------
  /** แก้ชื่อแบบทดสอบและเวลาสอบ (หัวกระดาษ) */
  updateExamMeta(id: string, title: string, durationMin: number): Promise<void>;

  // ---------- ตรวจด้วยกล้อง (เฟส 5) ----------
  /** บันทึกผลตรวจ 1 แผ่น (คะแนน + remark แจกผิดชุด คำนวณที่ฐานข้อมูล) — เลขที่ซ้ำไม่เขียนทับถ้าไม่สั่ง replace */
  saveScan(input: ScanSaveInput): Promise<ScanSaveResult>;
  /** ครูยืนยัน/แก้คำตอบ หรือเปลี่ยนชุดที่ใช้ตรวจ → remark ของเลขที่นี้ถือว่าแก้แล้ว */
  reviewScan(examId: string, seatNo: number, setNo: number, answers: ScanAnswer[]): Promise<ScanResponse>;
  deleteScan(examId: string, seatNo: number): Promise<void>;
  listScans(examId: string): Promise<ScanResponse[]>;

  // ---------- วิเคราะห์และปิดชุด (เฟส 6) ----------
  /** ปิดชุด: รวมสถิติรายข้อเข้าคลัง แล้วลบข้อมูลรายเลขที่ทั้งหมด (ย้อนกลับไม่ได้) */
  closeExam(id: string): Promise<ClosedSummary>;
}
