// วิเคราะห์ผลห้อง O-NET (SPEC-ONET §7) — ฟังก์ชันล้วน ใช้ทั้งหน้ารายงานและไฟล์ Excel
//   รายห้อง: ค่าเฉลี่ยรายชุด · ตัวชี้วัด/แม่แบบที่อ่อนที่สุด · ข้อที่เด็กหลงตัวลวงมาก (+ กับดักของข้อนั้น)
//   รายคน: คะแนนทุกชุด (แนวโน้ม) · แม่แบบ/ตัวชี้วัดที่พลาดซ้ำ · "ควรเน้น" 3 อันดับแรก (เสียคะแนนมากสุด)
import type { OnetItemInfo, OnetReportData, OnetResult, OnetSetDetail } from './types';

export interface SetSummary {
  code: string; setNo: number; title: string; n: number; avg: number | null; max: number | null; min: number | null; fullScore: number;
  items: ItemSummary[];
}
export interface ItemSummary {
  itemNo: number; kind: OnetItemInfo['kind']; indicatorCode: string; topic: string; n: number; nCorrect: number; p: number | null;
  /** คำตอบผิดที่ถูกเลือกมากที่สุด (null = ไม่มีคำตอบผิดที่ซ้ำกัน) */
  topWrong: { answer: string; count: number; share: number } | null;
  blank: number;
  traps: string | null;
  focus: string | null;
}
export interface GroupStat { key: string; n: number; nCorrect: number; p: number; lost: number }
export interface Lure { setCode: string; setNo: number; itemNo: number; kind: OnetItemInfo['kind']; topic: string; indicatorCode: string; answer: string; count: number; share: number; p: number | null; traps: string | null }

export interface StudentMiss { key: string; count: number; total: number; lost: number; focus: string | null }
export interface StudentSummary {
  seatNo: number;
  /** คะแนนรายชุด เรียงตามเลขชุด (null = ยังไม่ได้สอบชุดนั้น) */
  scores: Array<{ code: string; setNo: number; score: number | null }>;
  avg: number;
  tested: number;
  topics: StudentMiss[];      // แม่แบบที่พลาด เรียงตามคะแนนที่เสีย
  indicators: StudentMiss[];  // ตัวชี้วัดที่พลาด
  /** แม่แบบที่พลาดอย่างน้อย 2 ครั้ง */
  repeated: StudentMiss[];
  focusTop: StudentMiss[];    // ควรเน้น 3 อันดับ
  remarks: number;
}

export interface RoomAnalysis {
  sets: SetSummary[];
  students: StudentSummary[];
  weakIndicators: GroupStat[];
  weakTopics: GroupStat[];
  lures: Lure[];
  remarkCount: number;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
export const fmtScore = (x: number | null) => (x === null ? '–' : String(round(x, 2)));

/** หลงตัวลวง: คำตอบผิดคำตอบเดียวกันอย่างน้อย 30% ของผู้สอบ และอย่างน้อย 2 คน */
export const LURE_SHARE = 0.3;

function itemSummary(rs: OnetResult[], it: OnetItemInfo): ItemSummary {
  const k = it.itemNo - 1;
  let nCorrect = 0, blank = 0;
  const wrong = new Map<string, number>();
  for (const r of rs) {
    if (r.correct[k]) { nCorrect++; continue; }
    const a = r.answers[k];
    if (a === null || a === undefined) { blank++; continue; }
    wrong.set(a, (wrong.get(a) ?? 0) + 1);
  }
  const top = [...wrong.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    itemNo: it.itemNo, kind: it.kind, indicatorCode: it.indicatorCode, topic: it.topic, n: rs.length, nCorrect,
    p: rs.length ? nCorrect / rs.length : null, blank,
    topWrong: top && top[1] >= 2 ? { answer: top[0], count: top[1], share: top[1] / rs.length } : null,
    traps: it.traps, focus: it.focus,
  };
}

function groupStats(sets: OnetSetDetail[], results: OnetResult[], by: (i: OnetItemInfo) => string): GroupStat[] {
  const m = new Map<string, GroupStat>();
  for (const s of sets) for (const r of results.filter((x) => x.setCode === s.code))
    for (const it of s.items) {
      const g = m.get(by(it)) ?? { key: by(it), n: 0, nCorrect: 0, p: 0, lost: 0 };
      g.n++;
      if (r.correct[it.itemNo - 1]) g.nCorrect++; else g.lost += it.points;
      m.set(g.key, g);
    }
  return [...m.values()].map((g) => ({ ...g, p: g.n ? g.nCorrect / g.n : 0, lost: round(g.lost, 3) }))
    .sort((a, b) => a.p - b.p || b.lost - a.lost || a.key.localeCompare(b.key, 'th'));
}

function misses(sets: Map<string, OnetSetDetail>, rs: OnetResult[], by: (i: OnetItemInfo) => string): StudentMiss[] {
  const m = new Map<string, StudentMiss & { focusCount: Map<string, number> }>();
  for (const r of rs) {
    const s = sets.get(r.setCode);
    if (!s) continue;
    for (const it of s.items) {
      const key = by(it);
      const g = m.get(key) ?? { key, count: 0, total: 0, lost: 0, focus: null, focusCount: new Map() };
      g.total++;
      if (!r.correct[it.itemNo - 1]) {
        g.count++;
        g.lost += it.points;
        if (it.focus) g.focusCount.set(it.focus, (g.focusCount.get(it.focus) ?? 0) + 1);
      }
      m.set(key, g);
    }
  }
  return [...m.values()].filter((g) => g.count > 0)
    .map(({ focusCount, ...g }) => ({ ...g, lost: round(g.lost, 3),
      focus: [...focusCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
    .sort((a, b) => b.lost - a.lost || b.count / b.total - a.count / a.total || a.key.localeCompare(b.key, 'th'));
}

export function analyzeRoom(d: OnetReportData): RoomAnalysis {
  const sets = [...d.sets].sort((a, b) => a.setNo - b.setNo);
  const byCode = new Map(sets.map((s) => [s.code, s]));
  const setSums: SetSummary[] = sets.map((s) => {
    const rs = d.results.filter((r) => r.setCode === s.code);
    const sc = rs.map((r) => r.score);
    return {
      code: s.code, setNo: s.setNo, title: s.title, n: rs.length,
      avg: sc.length ? round(sc.reduce((a, b) => a + b, 0) / sc.length) : null,
      max: sc.length ? Math.max(...sc) : null, min: sc.length ? Math.min(...sc) : null,
      fullScore: round(s.items.reduce((a, i) => a + i.points, 0), 3),
      items: s.items.map((it) => itemSummary(rs, it)),
    };
  });

  const seats = [...new Set(d.results.map((r) => r.seatNo))].sort((a, b) => a - b);
  const students: StudentSummary[] = seats.map((seat) => {
    const rs = d.results.filter((r) => r.seatNo === seat);
    const topics = misses(byCode, rs, (i) => i.topic);
    const tested = rs.length;
    return {
      seatNo: seat,
      scores: sets.map((s) => ({ code: s.code, setNo: s.setNo, score: rs.find((r) => r.setCode === s.code)?.score ?? null })),
      avg: tested ? round(rs.reduce((a, r) => a + r.score, 0) / tested) : 0,
      tested,
      topics,
      indicators: misses(byCode, rs, (i) => i.indicatorCode),
      repeated: topics.filter((t) => t.count >= 2),
      focusTop: topics.slice(0, 3),
      remarks: rs.reduce((a, r) => a + r.remarks.length, 0),
    };
  });

  const lures: Lure[] = [];
  for (const s of setSums) for (const it of s.items)
    if (it.topWrong && it.topWrong.share >= LURE_SHARE)
      lures.push({ setCode: s.code, setNo: s.setNo, itemNo: it.itemNo, kind: it.kind, topic: it.topic, indicatorCode: it.indicatorCode,
        answer: it.topWrong.answer, count: it.topWrong.count, share: it.topWrong.share, p: it.p, traps: it.traps });
  lures.sort((a, b) => b.share - a.share || a.setNo - b.setNo || a.itemNo - b.itemNo);

  return {
    sets: setSums, students,
    weakIndicators: groupStats(sets, d.results, (i) => i.indicatorCode),
    weakTopics: groupStats(sets, d.results, (i) => i.topic),
    lures,
    remarkCount: d.results.filter((r) => r.remarks.length > 0).length,
  };
}

/** แสดงคำตอบสั้น ๆ: ปรนัย "②" · ตัวเลข "034" · ไม่ตอบ "–" */
export function answerLabel(a: string | null | undefined, kind: OnetItemInfo['kind']): string {
  if (a === null || a === undefined) return '–';
  return kind === 'mcq4' ? ['①', '②', '③', '④'][Number(a) - 1] ?? a : a;
}
