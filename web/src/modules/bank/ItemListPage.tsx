// หน้าค้นหาข้อสอบในคลัง — ตัวกรองเก็บใน URL (ลิงก์จากผังความครบมาที่นี่ได้)
import { useEffect, useState, type FormEvent } from 'react';
import { repo } from '../../data';
import { STATUS_TH, type ItemPage, type ItemStatus } from '../../core/types';
import { href, navigate, type Route } from '../../ui/router';
import { useRefData } from './useRefData';

const PAGE_SIZE = 30;
const STATUSES = Object.keys(STATUS_TH) as ItemStatus[];

export function StatusChip({ status }: { status: ItemStatus }) {
  return <span className={`chip st-${status}`}>{STATUS_TH[status]}</span>;
}

export function ItemListPage({ route }: { route: Route }) {
  const { data: ref, error: refError } = useRefData();
  const p = route.params;
  const filter = {
    gradeId: p.get('grade') ?? undefined,
    indicatorId: p.get('ind') ?? undefined,
    difficulty: p.get('d') ? Number(p.get('d')) : undefined,
    status: (p.get('s') as ItemStatus | null) ?? undefined,
    q: p.get('q') ?? '',
    includeSample: p.get('sample') !== '0',
    page: Number(p.get('page') ?? 0),
  };
  const [result, setResult] = useState<ItemPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(filter.q);
  const key = p.toString();

  useEffect(() => {
    setResult(null); setError(null);
    repo.listItems('MATH', { ...filter, pageSize: PAGE_SIZE }).then(setResult, (e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => setQ(filter.q), [filter.q]);

  function set(changes: Record<string, string | number | undefined | boolean>) {
    const next: Record<string, string | number | undefined | boolean> = {
      grade: filter.gradeId, ind: filter.indicatorId, d: filter.difficulty, s: filter.status, q: filter.q,
      sample: filter.includeSample ? undefined : '0', page: undefined, ...changes,
    };
    navigate('/items', next);
  }
  function search(e: FormEvent) { e.preventDefault(); set({ q: q.trim() || undefined }); }

  const inds = ref?.indicators.filter((i) => !filter.gradeId || i.gradeId === filter.gradeId) ?? [];
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const diffName = (id: number) => ref?.difficulties.find((d) => d.id === id)?.nameTh ?? id;
  const newLink = href('/items/new', { ind: filter.indicatorId, d: filter.difficulty });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>คลังข้อสอบ</h1>
          <p className="sub">ค้นหา เพิ่ม และแก้ไขข้อสอบ</p>
        </div>
        <a className="btn" href={newLink}>+ เพิ่มข้อ</a>
      </div>
      {(error || refError) && <div className="error" role="alert">{error || refError}</div>}

      <div className="tabs" role="group" aria-label="เลือกชั้น">
        <button aria-pressed={!filter.gradeId} onClick={() => set({ grade: undefined, ind: undefined })}>ทุกชั้น</button>
        {ref?.grades.map((g) => (
          <button key={g.id} aria-pressed={filter.gradeId === g.id} onClick={() => set({ grade: g.id, ind: undefined })}>{g.shortTh}</button>
        ))}
      </div>
      <div className="filters">
        <label>ตัวชี้วัด
          <select value={filter.indicatorId ?? ''} onChange={(e) => {
            const ind = ref?.indicatorById.get(e.target.value);
            set({ ind: e.target.value || undefined, grade: ind?.gradeId ?? filter.gradeId });
          }}>
            <option value="">ทั้งหมด</option>
            {inds.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}
          </select>
        </label>
        <label>ความยาก
          <select value={filter.difficulty ?? ''} onChange={(e) => set({ d: e.target.value || undefined })}>
            <option value="">ทั้งหมด</option>
            {ref?.difficulties.map((d) => <option key={d.id} value={d.id}>{d.nameTh}</option>)}
          </select>
        </label>
        <label>สถานะ
          <select value={filter.status ?? ''} onChange={(e) => set({ s: e.target.value || undefined })}>
            <option value="">ทั้งหมด</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TH[s]}</option>)}
          </select>
        </label>
        <form className="search" onSubmit={search} role="search">
          <input type="search" placeholder="ค้นโจทย์ รหัสข้อ หรือหัวข้อย่อย" value={q} onChange={(e) => setQ(e.target.value)} aria-label="คำค้น" />
          <button className="btn ghost" type="submit">ค้นหา</button>
        </form>
        <label className="check">
          <input type="checkbox" checked={filter.includeSample} onChange={(e) => set({ sample: e.target.checked ? undefined : '0' })} />
          แสดงข้อหุ่น
        </label>
      </div>

      <p className="sub" data-testid="result-count">
        {result ? `พบ ${result.total.toLocaleString('th-TH')} ข้อ` : 'กำลังค้นหา…'}
      </p>

      <ul className="item-list" data-testid="item-list">
        {result?.items.map((it) => (
          <li key={it.id}>
            <a href={href(`/items/${it.id}`)} className="item-row">
              <div className="item-top">
                <strong className="code">{it.itemCode}</strong>
                <StatusChip status={it.status} />
                {it.isSample && <span className="chip">ข้อหุ่น</span>}
                <span className="meta">{ref?.indicatorById.get(it.indicatorId)?.code} · {diffName(it.currentDifficulty)} · v{it.currentVersion}</span>
              </div>
              <div className="item-stem">{it.stem}</div>
              <div className="item-flags">
                {it.hasFigure && <span title="มีรูป">◧ รูป</span>}
                {it.qaPassed === true && <span className="ok-text">✓ ผ่านตรวจอัตโนมัติ</span>}
                {it.qaPassed === false && <span className="warn-text">✗ ไม่ผ่านตรวจอัตโนมัติ</span>}
                {it.n > 0 && <span>n {it.n} · p {it.p?.toFixed(2)}{it.r !== null ? ` · r ${it.r.toFixed(2)}` : ''}</span>}
                {it.subtopic && <span>{it.subtopic}</span>}
              </div>
            </a>
          </li>
        ))}
      </ul>
      {result && result.total === 0 && (
        <div className="card empty">ไม่พบข้อสอบตามเงื่อนไข · <a href={newLink}>เพิ่มข้อใหม่</a></div>
      )}
      {result && pages > 1 && (
        <div className="pager">
          <button className="btn ghost" disabled={filter.page <= 0} onClick={() => set({ page: filter.page - 1 || undefined })}>‹ ก่อนหน้า</button>
          <span className="sub" style={{ margin: 0 }}>หน้า {filter.page + 1} / {pages}</span>
          <button className="btn ghost" disabled={filter.page + 1 >= pages} onClick={() => set({ page: filter.page + 1 })}>ถัดไป ›</button>
        </div>
      )}
    </>
  );
}
