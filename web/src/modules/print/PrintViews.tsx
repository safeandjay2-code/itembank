// หน้าเอกสารสำหรับพิมพ์/บันทึก PDF ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ (สระ วรรณยุกต์ไทยถูกต้องตามเบราว์เซอร์)
//   แบบทดสอบ: A4 สองคอลัมน์ "ชุดที่ X" ตัวใหญ่ ตัวเลือก 1)–4) ตามลำดับของชุด
//   เฉลยครู: ทุกชุด พร้อมรหัสประจำข้อ และเลขที่ → ชุด
//   กระดาษคำตอบ: 1 แผ่นต่อ A4 (ย่อลง A5 ได้) หรือ A5 สองแผ่นต่อ A4 แนวนอน
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { tryRenderFigure } from '../bank/figure/svg';
import { splitMath } from './math';
import { headerLine, INSTRUCTION, type PrintDoc, type PrintItem, type PrintSet } from './model';
import { answerSheetSvg } from './answerSheetSvg';
import { getTemplate } from './template';

export function MathText({ text }: { text: string }) {
  return (
    <>
      {splitMath(text).map((s, i) => s.t === 'text'
        ? <Fragment key={i}>{s.v}</Fragment>
        : (
          <span key={i} className="mx" aria-label={`${s.whole ? `${s.whole} ` : ''}${s.num}/${s.den}`}>
            {s.whole && <span className="mx-whole">{s.whole}</span>}
            <span className="mx-frac"><span className="mx-num">{s.num}</span><span className="mx-den">{s.den}</span></span>
          </span>
        ))}
    </>
  );
}

function Figure({ item, note }: { item: PrintItem; note: string }) {
  if (!item.figure) return null;
  const r = tryRenderFigure(item.figure, { note });
  if (!r.ok) return <div className="q-fig-error">[รูปผิดพลาด: {r.error}]</div>;
  // ความกว้างจริงบนกระดาษ: แปลงพิกเซลของตัววาดรูป (96 dpi) เป็น มม. แล้วจำกัดไม่เกินความกว้างคอลัมน์
  const mm = Math.min(78, r.result.width * 0.2646);
  return <div className="q-fig" style={{ width: `${mm}mm` }} dangerouslySetInnerHTML={{ __html: r.result.svg }} />;
}

function Question({ item, note }: { item: PrintItem; note: string }) {
  return (
    <div className="q" data-no={item.no} data-item={item.itemCode} data-key={item.key}>
      <div className="q-stem"><span className="q-no">{item.no}.</span><span><MathText text={item.stem} /></span></div>
      <Figure item={item} note={note} />
      <ol className={`q-opts ${item.layout}`}>
        {item.options.map((o, i) => (
          <li key={i} data-opt={i + 1}><span className="q-opt-no">{i + 1})</span> <MathText text={o} /></li>
        ))}
      </ol>
    </div>
  );
}

// ความสูงพื้นที่เนื้อหาต่อหน้า A4 (297 − ขอบบน 12 − ขอบล่าง 14) เผื่อความคลาดตอนพิมพ์ 4 มม.
const PAGE_CONTENT_MM = 271 - 4;
const PX_PER_MM = 96 / 25.4;

/** จัดข้อลงหน้า/คอลัมน์ทีละข้อจากความสูงจริง (วัดบนจอด้วยฟอนต์เดียวกับตอนพิมพ์) — หน้าตาบนจอ = หน้าที่พิมพ์ออกจริง
 *  ไม่ใช้ CSS column ตอนพิมพ์ เพราะเบราว์เซอร์ตัดหน้าคอลัมน์ไม่แน่นอน (เคยได้หน้าว่างท้ายเอกสาร) */
export function paginate(heights: number[], firstPageTop: number, endHeight: number, pageH: number): number[][][] {
  const pages: number[][][] = [];
  let page: number[][] = [[], []]; let col = 0; let used = firstPageTop; let top = firstPageTop;
  const next = () => {
    if (col === 0) { col = 1; used = top; return; }
    pages.push(page); page = [[], []]; col = 0; top = 0; used = 0;
  };
  heights.forEach((h, i) => {
    if (used + h > pageH && page[col].length > 0) next();
    page[col].push(i); used += h;
  });
  if (used + endHeight > pageH) next();
  page[col].push(-1); // -1 = "หมดข้อสอบ"
  pages.push(page);
  return pages;
}

export function ExamPrint({ doc, set }: { doc: PrintDoc; set: PrintSet }) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][][] | null>(null);
  const [fontTick, setFontTick] = useState(0);
  useLayoutEffect(() => {
    let alive = true;
    (document as any).fonts?.ready?.then(() => { if (alive) setFontTick((t) => t + 1); });
    return () => { alive = false; };
  }, []);
  useLayoutEffect(() => {
    const m = measureRef.current; if (!m) return;
    const px = (el: Element | null) => (el ? el.getBoundingClientRect().height : 0);
    const head = px(m.querySelector('.exam-headblock'));
    const qs = [...m.querySelectorAll('.measure-col .q')].map((el) => {
      const cs = getComputedStyle(el);
      return px(el) + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    });
    const end = px(m.querySelector('.exam-end')) + 3 * PX_PER_MM;
    setPages(paginate(qs, head, end, PAGE_CONTENT_MM * PX_PER_MM));
  }, [doc, set, fontTick]);

  const header = (live: boolean) => (
    <div className="exam-headblock">
      <header className="exam-head">
        <div className="exam-head-text">
          <h1>{doc.title}</h1>
          <p>{headerLine(doc)}</p>
        </div>
        <div className="set-badge" data-testid={live ? 'set-badge' : undefined}><small>ชุดที่</small><b>{set.setNo}</b></div>
      </header>
      <p className="exam-instr">{INSTRUCTION}</p>
    </div>
  );
  const end = <p className="exam-end">— หมดข้อสอบ —</p>;
  return (
    <>
    <div className="pdoc exam-measure" ref={measureRef} aria-hidden="true">
      {header(false)}
      <div className="measure-col">{set.items.map((it) => <Question key={it.no} item={it} note={doc.figureNote} />)}{end}</div>
    </div>
    <div className="pdoc exam-doc" data-testid="print-exam" data-set={set.setNo} data-pages={pages?.length ?? 0}>
      <style>{`@page exam { @bottom-left { content: "${doc.gradeShort} · ชุดที่ ${set.setNo}"; font-family: 'TH Sarabun New', 'PrintThai', sans-serif; font-size: 13pt; } }`}</style>
      {pages && pages.map((pg, k) => (
        <section key={k} className="exam-page" data-page={k + 1}>
          {k === 0 && header(true)}
          <div className="exam-cols2">
            {pg.map((col, c) => (
              <div key={c} className="exam-col">
                {col.map((i) => (i < 0 ? <Fragment key="end">{end}</Fragment> : <Question key={set.items[i].no} item={set.items[i]} note={doc.figureNote} />))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
    </>
  );
}

export function KeyPrint({ doc }: { doc: PrintDoc }) {
  const base = doc.sets[0]?.items.slice().sort((a, b) => a.itemCode.localeCompare(b.itemCode)) ?? [];
  const posIn = (s: PrintSet, code: string) => s.items.find((i) => i.itemCode === code)!;
  return (
    <div className="pdoc key-doc" data-testid="print-key">
      <h1>เฉลยสำหรับครู — {doc.title}</h1>
      <p>{headerLine(doc)} · {doc.sets.length} ชุด · ห้ามแจกนักเรียน</p>
      {doc.sets.map((s) => (
        <section key={s.setNo} className="key-set" data-set={s.setNo}>
          <h2>ชุดที่ {s.setNo}</h2>
          <ol className="key-grid">
            {s.items.map((it) => (
              <li key={it.no} data-no={it.no}><b>{it.no}.</b> ตอบ <span className="key-ans">{it.key}</span> <small>{it.itemCode}</small></li>
            ))}
          </ol>
        </section>
      ))}
      <section className="key-set">
        <h2>เลขที่ → ชุด</h2>
        <p className="key-seats">
          {doc.sets.map((s) => {
            const seats = doc.seats.filter((x) => x.setNo === s.setNo).map((x) => x.seatNo);
            return <span key={s.setNo}><b>ชุดที่ {s.setNo}:</b> เลขที่ {seats.length ? seats.join(', ') : '—'}</span>;
          })}
        </p>
      </section>
      <section className="key-set">
        <h2>ข้อในชุด (รหัสประจำข้อ) และตำแหน่งในแต่ละชุด</h2>
        <table className="key-table">
          <thead><tr><th>รหัสข้อ</th><th>ตัวชี้วัด</th><th>ระดับ</th>{doc.sets.map((s) => <th key={s.setNo}>ชุด {s.setNo}</th>)}</tr></thead>
          <tbody>
            {base.map((it) => (
              <tr key={it.itemCode}>
                <td>{it.itemCode}</td><td>{it.indicatorCode}</td><td>{it.difficultyName}</td>
                {doc.sets.map((s) => { const p = posIn(s, it.itemCode); return <td key={s.setNo}>ข้อ {p.no} ตอบ {p.key}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export type SheetLayout = 'a4' | 'duo';

/** กระดาษคำตอบ: 'a4' = 1 แผ่นต่อหน้า A4 แนวตั้ง (สั่งพิมพ์ลงกระดาษ A5 ได้ด้วย "พอดีกับหน้า" เพราะสัดส่วนเท่ากัน)
 *  'duo' = A5 สองแผ่นต่อ A4 แนวนอน (ตัดครึ่ง) — ตำแหน่งในแบบกระดาษเป็นมม. ของ A5 เสมอ กล้องอ่านได้ทุกขนาดเพราะจัดภาพจาก QR + มุมดำ */
export function SheetsPrint({ doc, layout = 'a4' }: { doc: PrintDoc; layout?: SheetLayout }) {
  const t = getTemplate(doc.templateVersion);
  const per = layout === 'duo' ? 2 : 1;
  const pages: Array<typeof doc.seats> = [];
  for (let i = 0; i < doc.seats.length; i += per) pages.push(doc.seats.slice(i, i + per));
  return (
    <div className={`pdoc sheets-doc ${layout === 'a4' ? 'sheets-a4' : ''}`} data-testid="print-sheets" data-layout={layout}>
      {pages.map((grp, k) => (
        <div key={k} className="sheet-page">
          {grp.map((s) => (
            <div key={s.seatNo} className="sheet" data-seat={s.seatNo}
              dangerouslySetInnerHTML={{ __html: answerSheetSvg(t, { examId: doc.examId, title: doc.title, gradeShort: doc.gradeShort,
                itemCount: doc.itemCount, setNo: s.setNo, seatNo: s.seatNo }) }} />
          ))}
        </div>
      ))}
    </div>
  );
}
