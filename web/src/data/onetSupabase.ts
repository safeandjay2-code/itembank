// ห้อง O-NET บน Supabase — เรียก RPC onet_* (migration 0015) + Storage bucket 'onet' (ส่วนตัว ตรวจสิทธิ์ด้วย policy)
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ONET_FILES, type OnetAdminStats, type OnetAdminUser, type OnetApi, type OnetCatalog, type OnetFileKind, type OnetReportData,
  type OnetResult, type OnetRoom, type OnetSetDetail, type OnetSubmitInput, type OnetSubmitResult,
} from '../modules/onet/types';

export function toSetDetail(s: any): OnetSetDetail {
  return {
    code: s.code, setNo: s.set_no, title: s.title, bubbleCode: s.bubble_code, isFree: !!s.is_free, usable: !!s.usable,
    items: (s.items ?? []).map((i: any) => ({
      itemNo: i.item_no, kind: i.kind, points: +i.points, indicatorCode: i.indicator_code, topic: i.topic,
      sourceIndicator: i.source_indicator ?? null, focus: i.focus ?? null, solution: i.solution ?? null, traps: i.traps ?? null,
    })),
  };
}

export function toResult(x: any): OnetResult {
  return {
    setCode: x.set_code, seatNo: x.seat_no, answers: x.answers ?? [], correct: x.correct ?? [], score: +x.score,
    bubbledSet: x.bubbled_set ?? null, setMismatch: !!x.set_mismatch, remarks: x.remarks ?? [], scannedAt: x.scanned_at,
  };
}

export class SupabaseOnet implements OnetApi {
  constructor(private sb: SupabaseClient) {}

  private async rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }

  async catalog(): Promise<OnetCatalog> {
    const d = await this.rpc('onet_catalog');
    return {
      role: d.role, entitled: !!d.entitled, priceText: d.price_text ?? '', paymentText: d.payment_text ?? '',
      sets: (d.sets ?? []).map((s: any) => ({
        code: s.code, setNo: s.set_no, title: s.title, bubbleCode: s.bubble_code, subjectId: s.subject_id, gradeId: s.grade_id,
        isFree: !!s.is_free, usable: !!s.usable, itemCount: s.item_count,
      })),
    };
  }

  async setDetail(code: string) { return toSetDetail(await this.rpc('onet_set_detail', { p_code: code })); }

  async file(code: string, kind: OnetFileKind): Promise<Blob | null> {
    const { data, error } = await this.sb.storage.from('onet').download(`${code}/${ONET_FILES[kind].path}`);
    if (error) {
      const status = (error as any).statusCode ?? (error as any).status;
      if (String(status) === '404' || /not.?found/i.test(error.message)) return null;
      if (String(status) === '400' || String(status) === '403') throw new Error('ยังไม่มีสิทธิ์ดาวน์โหลดไฟล์ของชุดนี้');
      throw new Error(error.message);
    }
    return data;
  }

  async roomList(): Promise<OnetRoom[]> {
    const rows = (await this.rpc<any[]>('onet_room_list')) ?? [];
    return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, expiresAt: r.expires_at, createdAt: r.created_at,
      closedAt: r.closed_at ?? null, students: r.students, sheets: r.sheets }));
  }
  async roomCreate(name: string) { return this.rpc<string>('onet_room_create', { p_name: name }); }
  async roomRename(id: string, name: string) { await this.rpc('onet_room_rename', { p_room: id, p_name: name }); }
  async roomClose(id: string) { await this.rpc('onet_room_close', { p_room: id }); }
  async roomDelete(id: string) { await this.rpc('onet_room_delete', { p_room: id }); }

  async submit(i: OnetSubmitInput): Promise<OnetSubmitResult> {
    const d = await this.rpc('onet_submit', {
      p_room: i.roomId, p_set: i.setCode, p_seat: i.seatNo, p_answers: i.answers,
      p_bubbled_set: i.bubbledSet, p_remarks: i.remarks, p_replace: !!i.replace,
    });
    if (d.status === 'duplicate')
      return { status: 'duplicate', seatNo: d.seat_no, existing: { score: +d.existing.score, scannedAt: d.existing.scanned_at } };
    return { status: d.status, seatNo: d.seat_no, score: +d.score, correctCount: d.correct_count, itemCount: d.item_count,
      correct: d.correct ?? [], setMismatch: !!d.set_mismatch };
  }

  async resultDelete(roomId: string, setCode: string, seatNo: number) {
    await this.rpc('onet_result_delete', { p_room: roomId, p_set: setCode, p_seat: seatNo });
  }

  async report(roomId: string): Promise<OnetReportData> {
    const d = await this.rpc('onet_report', { p_room: roomId });
    return {
      room: { id: d.room.id, name: d.room.name, status: d.room.status, expiresAt: d.room.expires_at },
      sets: (d.sets ?? []).map(toSetDetail),
      results: (d.results ?? []).map(toResult),
    };
  }

  async adminUsers(query: string): Promise<OnetAdminUser[]> {
    const rows = (await this.rpc<any[]>('onet_admin_users', { p_query: query || null })) ?? [];
    return rows.map((u) => ({
      id: u.id, email: u.email, displayName: u.display_name ?? null, schoolName: u.school_name ?? null, role: u.role,
      createdAt: u.created_at, entitled: !!u.entitled, grantedAt: u.granted_at ?? null, note: u.note ?? null,
      rooms: u.rooms, sheets: u.sheets,
    }));
  }
  async adminGrant(userId: string, note: string | null) { await this.rpc('onet_admin_grant', { p_user: userId, p_note: note }); }
  async adminRevoke(userId: string) { await this.rpc('onet_admin_revoke', { p_user: userId }); }
  async adminStats(): Promise<OnetAdminStats> {
    const d = await this.rpc('onet_admin_stats');
    return {
      users: d.users, entitled: d.entitled, openRooms: d.open_rooms, sheets: d.sheets,
      items: (d.items ?? []).map((s: any) => ({ setCode: s.set_code, itemNo: s.item_no, n: s.n, nCorrect: s.n_correct,
        p: s.p === null ? null : +s.p, answerCounts: s.answer_counts ?? {} })),
    };
  }
}
