// ส่งออก Excel ห้อง O-NET ตามเลขที่ (SPEC-ONET §7) — ไม่มีชื่อนักเรียน (ครูจับคู่เลขที่เอง)
import { buildXlsx, S, type Cell, type Row, type Sheet } from '../analysis/xlsx';
import { answerLabel, type RoomAnalysis } from './analyze';
import type { OnetReportData } from './types';

const pct = (p: number | null) => (p === null ? null : Math.round(p * 1000) / 10);

export function onetSheets(d: OnetReportData, a: RoomAnalysis): Sheet[] {
  const sets = a.sets;
  const head = (v: string): Cell => ({ v, s: S.header });

  // 1) สรุปรายคน
  const sum: Row[] = [
    [{ v: `ห้อง O-NET: ${d.room.name}`, s: S.title }],
    [],
    [head('เลขที่'), ...sets.map((s) => head(`ชุดที่ ${s.setNo} (เต็ม ${s.fullScore})`)), head('เฉลี่ย'), head('ควรเน้น 1'), head('ควรเน้น 2'), head('ควรเน้น 3')],
    ...a.students.map((st): Row => [
      st.seatNo,
      ...st.scores.map((x) => (x.score === null ? null : { v: x.score, s: S.dec2 })),
      { v: st.avg, s: S.dec2 },
      ...[0, 1, 2].map((k) => st.focusTop[k] ? `${st.focusTop[k].key} (ผิด ${st.focusTop[k].count}/${st.focusTop[k].total})` : ''),
    ]),
    [],
    [{ v: 'ค่าเฉลี่ยห้อง', s: S.bold }, ...sets.map((s) => (s.avg === null ? null : { v: s.avg, s: S.dec2 }))],
  ];

  // 2) รายชุด: คำตอบรายข้อ
  const perSet: Sheet[] = sets.map((s) => {
    const set = d.sets.find((x) => x.code === s.code)!;
    const rs = d.results.filter((r) => r.setCode === s.code);
    return {
      name: `ชุดที่ ${s.setNo}`,
      rows: [
        [head('เลขที่'), head('คะแนน'), ...set.items.map((i) => head(`ข้อ ${i.itemNo}`)), head('หมายเหตุ')],
        ...rs.map((r): Row => [
          r.seatNo, { v: r.score, s: S.dec2 },
          ...set.items.map((i): Cell => ({ v: r.correct[i.itemNo - 1] ? '✓' : answerLabel(r.answers[i.itemNo - 1], i.kind), s: r.correct[i.itemNo - 1] ? S.good : S.bad })),
          r.remarks.map((m) => m.message).join(' · '),
        ]),
        [],
        [{ v: 'ตอบถูก (%)', s: S.bold }, null, ...s.items.map((i) => (i.p === null ? null : { v: pct(i.p), s: S.pct }))],
      ],
      widths: [8, 9, ...set.items.map(() => 6), 50],
      freezeRows: 1, freezeCols: 2,
    };
  });

  // 3) รายข้อ
  const items: Row[] = [
    [head('ชุด'), head('ข้อ'), head('ตัวชี้วัด'), head('แม่แบบ'), head('ตอบถูก (%)'), head('คำตอบผิดที่พบบ่อย'), head('จำนวน'), head('ไม่ตอบ'), head('กับดัก/ตัวลวง')],
    ...sets.flatMap((s) => s.items.map((i): Row => [
      s.setNo, i.itemNo, i.indicatorCode, i.topic, i.p === null ? null : { v: pct(i.p), s: S.pct },
      i.topWrong ? answerLabel(i.topWrong.answer, i.kind) : '', i.topWrong?.count ?? null, i.blank, i.traps ?? '',
    ])),
  ];

  // 4) ตัวชี้วัด/แม่แบบที่อ่อน
  const weak: Row[] = [
    [head('ตัวชี้วัด'), head('ตอบถูก (%)'), head('จำนวนคำตอบ'), head('คะแนนที่เสียรวม')],
    ...a.weakIndicators.map((g): Row => [g.key, { v: pct(g.p), s: S.pct }, g.n, { v: g.lost, s: S.dec2 }]),
    [],
    [head('แม่แบบ'), head('ตอบถูก (%)'), head('จำนวนคำตอบ'), head('คะแนนที่เสียรวม')],
    ...a.weakTopics.map((g): Row => [g.key, { v: pct(g.p), s: S.pct }, g.n, { v: g.lost, s: S.dec2 }]),
  ];

  return [
    { name: 'สรุปรายคน', rows: sum, widths: [8, ...sets.map(() => 14), 9, 30, 30, 30], freezeRows: 3, freezeCols: 1 },
    ...perSet,
    { name: 'รายข้อ', rows: items, widths: [6, 6, 16, 26, 11, 18, 8, 8, 60], freezeRows: 1 },
    { name: 'ตัวชี้วัดและแม่แบบ', rows: weak, widths: [30, 12, 14, 16] },
  ];
}

export function buildOnetXlsx(d: OnetReportData, a: RoomAnalysis): Promise<Uint8Array> {
  return buildXlsx(onetSheets(d, a));
}

export function onetXlsxName(room: string) {
  const d = new Date();
  const stamp = `${d.getFullYear() + 543}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ห้อง O-NET-${room.replace(/[\\/:*?"<>|]/g, ' ').trim()}-${stamp}.xlsx`;
}
