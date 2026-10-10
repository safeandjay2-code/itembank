// แปลงผลจากฐานข้อมูล (migration 0010: bank_health, calib_run, calib_item_info, calib_exam_result) เป็นชนิดข้อมูลของหน้าเว็บ
// ทดสอบด้วยผลจริงจาก PostgreSQL (tests/unit/calibration-fromdb.test.ts)
import type { BankHealth, CalibrationRun, FlagChange, ItemCalibrationInfo, LevelMove, Shortfall } from './calibrate';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const int = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

function move(m: any): LevelMove & { indicatorCode: string; gradeId: string } {
  return {
    itemId: m.item_id, itemCode: m.item_code, indicatorId: m.indicator_id, indicatorCode: m.indicator_code ?? '', gradeId: m.grade_id ?? '',
    version: m.version ?? undefined, from: Number(m.from), to: Number(m.to), direction: m.direction, p: Number(m.p), n: int(m.n),
    r: num(m.r), movedAt: m.moved_at ?? undefined,
  };
}

function flag(f: any): FlagChange {
  return { itemId: f.item_id, itemCode: f.item_code, indicatorId: f.indicator_id ?? undefined, flag: f.flag ?? null, from: f.from ?? undefined,
    r: num(f.r), nR: f.n_r === undefined ? undefined : int(f.n_r) };
}

function shortfall(x: any): Shortfall {
  return {
    indicatorId: x.indicator_id, indicatorCode: x.indicator_code, gradeId: x.grade_id, difficultyId: Number(x.difficulty_id),
    ready: int(x.ready), target: x.target !== undefined ? int(x.target) : int(x.ready) + int(x.need),
    draft: x.draft === undefined ? undefined : int(x.draft), needsFix: x.needs_fix === undefined ? undefined : int(x.needs_fix),
    movedOut: x.moved_out === undefined ? undefined : int(x.moved_out),
  };
}

export function toCalibrationRun(d: any): CalibrationRun {
  return {
    runId: int(d.run_id), source: d.source, examId: d.exam_id ?? null, itemsChecked: int(d.items_checked),
    moved: (d.moved ?? []).map(move), flagged: (d.flagged ?? []).map(flag), unflagged: (d.unflagged ?? []).map(flag),
    stopped: int(d.stopped), shortfalls: (d.shortfalls ?? []).map(shortfall),
  };
}

export function toBankHealth(d: any): BankHealth {
  const s = d.settings ?? {};
  return {
    generatedAt: d.generated_at,
    settings: { target: int(s.target), minNToMove: int(s.min_n_to_move), buffer: Number(s.buffer), rFlagBelow: Number(s.r_flag_below),
      rMinN: int(s.r_min_n), sameGradeOnly: !!s.same_grade_only, recentDays: int(s.recent_days) },
    statusCounts: Object.fromEntries(Object.entries(d.status_counts ?? {}).map(([k, v]) => [k, int(v)])),
    sampleCount: int(d.sample_count),
    nBuckets: { none: int(d.n_buckets?.none), collecting: int(d.n_buckets?.collecting), calibrated: int(d.n_buckets?.calibrated) },
    coverage: { cells: int(d.coverage?.cells), full: int(d.coverage?.full), empty: int(d.coverage?.empty),
      readyTotal: int(d.coverage?.ready_total), targetTotal: int(d.coverage?.target_total) },
    shortfalls: (d.shortfalls ?? []).map((x: any) => ({ ...shortfall(x), target: int(s.target) })),
    flagged: (d.flagged ?? []).map((f: any) => ({
      itemId: f.item_id, itemCode: f.item_code, indicatorId: f.indicator_id, indicatorCode: f.indicator_code, gradeId: f.grade_id,
      difficulty: Number(f.difficulty), status: f.status, flag: f.flag, flagAt: f.flag_at ?? null, r: num(f.r), nR: num(f.n_r), p: num(f.p), n: num(f.n),
    })),
    needsFixCount: int(d.needs_fix_count),
    recentMoves: (d.recent_moves ?? []).map(move),
    moveTotals: { easier: int(d.move_totals?.easier), harder: int(d.move_totals?.harder), allTime: int(d.move_totals?.all_time) },
    levelMix: (d.level_mix ?? []).map((x: any) => ({ difficulty: Number(x.difficulty), est: int(x.est), current: int(x.current) })),
    runs: (d.runs ?? []).map((r: any) => ({ id: int(r.id), source: r.source, examId: r.exam_id ?? null, ranAt: r.ran_at, itemsChecked: int(r.items_checked),
      moved: int(r.moved), flagged: int(r.flagged), unflagged: int(r.unflagged), shortfalls: int(r.shortfalls) })),
  };
}

export function toItemCalibrationInfo(d: any): ItemCalibrationInfo {
  const s = d.stats;
  return {
    stats: { n: int(s.n), nCorrect: int(s.n_correct), nR: int(s.n_r), rSumMilli: int(s.r_sum_milli), p: num(s.p), r: num(s.r), rounds: int(s.rounds),
      gradeId: s.grade_id, version: int(s.version) },
    decision: { target: d.decision?.target ?? null, direction: d.decision?.direction ?? null, flag: d.decision?.flag ?? null },
    rounds: (d.rounds ?? []).map((r: any) => ({ version: int(r.version), gradeId: r.grade_id ?? null, n: int(r.n), nCorrect: int(r.n_correct), r: num(r.r),
      optionCounts: r.option_counts ?? {}, recordedAt: r.recorded_at })),
    moves: (d.moves ?? []).map((m: any) => ({ version: int(m.version), from: Number(m.from), to: Number(m.to), direction: m.direction, p: Number(m.p),
      n: int(m.n), r: num(m.r), movedAt: m.moved_at })),
  };
}
