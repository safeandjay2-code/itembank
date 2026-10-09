// แสดงข้อสอบแบบที่นักเรียนเห็น (โจทย์ รูป ตัวเลือก 1)–4)) พร้อมเฉลยสำหรับครู
import type { ItemAnswer, ItemContent } from '../../core/types';
import { tryRenderFigure } from './figure/svg';

export function FigureView({ spec, note, testId }: { spec: unknown; note?: string | null; testId?: string }) {
  const r = tryRenderFigure(spec, { note });
  if (!r.ok) return <div className="error" role="alert" data-testid="figure-error">{r.error}</div>;
  return (
    <div className="figure" data-testid={testId ?? 'figure'}
         style={{ maxWidth: r.result.width }}
         // SVG สร้างจากโค้ดของเราเอง และ escape ข้อความทุกส่วนแล้ว
         dangerouslySetInnerHTML={{ __html: r.result.svg }} />
  );
}

export function ItemPreview({ content, answer, note, showAnswer = true }:
  { content: ItemContent; answer: ItemAnswer; note?: string | null; showAnswer?: boolean }) {
  return (
    <div className="preview" data-testid="item-preview">
      <p className="preview-stem">{content.stem || <span className="sub">(ยังไม่มีโจทย์)</span>}</p>
      {content.figure && <FigureView spec={content.figure} note={note} />}
      <ol className="preview-options">
        {content.options.map((o, i) => (
          <li key={i} className={showAnswer && answer.choice === i + 1 ? 'correct' : ''}>
            <span className="opt-no">{i + 1})</span> {o || <span className="sub">—</span>}
            {showAnswer && answer.choice === i + 1 && <span className="tag ok">เฉลย</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
