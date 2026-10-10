// ชั้นเข้าถึงข้อมูล (Repository) — หน้าจอทุกหน้าคุยกับ interface นี้เท่านั้น
// เปลี่ยนผู้ให้บริการฐานข้อมูลได้โดยเขียน implementation ใหม่ ไม่ต้องแก้หน้าจอ (SPEC §3.1, §3.10)
import type {
  BankExport, CognitiveLevel, CoverageCell, DifficultyLevel, ExamCreateInput, ExamDetail, ExamSummary, Grade, ImportReport,
  Indicator, ItemDetail, ItemFilter, ItemPage, ItemStatus, PoolItem, Profile, SaveItemInput, Settings,
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
  listExams(subjectId: string): Promise<ExamSummary[]>;
  getExam(id: string): Promise<ExamDetail | null>;
  /** ลบชุดที่ยังไม่เริ่มสอบและยังไม่มีคำตอบ */
  deleteExam(id: string): Promise<void>;
}
