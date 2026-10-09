// ตัวแก้ไขข้อกำหนดรูป: เลือกชนิด → กรอกช่องตามชนิด (หรือแก้ JSON โดยตรง)
import { useEffect, useState } from 'react';
import type { FigureKind, FigureSpec, Lbl } from './figure/spec';
import { KIND_LABEL_TH } from './figure/spec';
import { FIGURE_SAMPLES } from './figure/samples';
import { FIGURE_FORMS, getPath, setPath, type Field } from './figure/forms';

function ListInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const codec = field.codec!;
  const [text, setText] = useState(() => codec.format(value));
  useEffect(() => {
    // รับค่าจากภายนอก (เช่น เปลี่ยนชนิดรูป) โดยไม่ทับสิ่งที่กำลังพิมพ์ถ้าความหมายเท่าเดิม
    if (JSON.stringify(codec.parse(text)) !== JSON.stringify(value ?? codec.parse(''))) setText(codec.format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);
  const common = {
    value: text, 'aria-label': field.label,
    onChange: (e: { target: { value: string } }) => { setText(e.target.value); onChange(codec.parse(e.target.value)); },
  };
  return (
    <>
      {field.multiline ? <textarea rows={4} {...common} /> : <input type="text" {...common} />}
      <small className="hint-line">{codec.hint}</small>
    </>
  );
}

function LblInput({ label, value, onChange }: { label: string; value: Lbl; onChange: (v: Lbl) => void }) {
  const mode = value === undefined || value === false ? 'off' : value === true ? 'value' : 'text';
  return (
    <div className="lbl-input">
      <select aria-label={label} value={mode} onChange={(e) => {
        const m = e.target.value;
        onChange(m === 'off' ? undefined : m === 'value' ? true : '?');
      }}>
        <option value="off">ไม่แสดง</option>
        <option value="value">แสดงค่า</option>
        <option value="text">ข้อความเอง</option>
      </select>
      {mode === 'text' && (
        <input type="text" aria-label={`${label} (ข้อความ)`} value={value as string} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function FigureEditor({ value, onChange }: { value: FigureSpec | null; onChange: (v: FigureSpec | null) => void }) {
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const kind = value?.kind ?? '';

  useEffect(() => { if (jsonMode) { setJsonText(value ? JSON.stringify(value, null, 2) : ''); setJsonError(null); } }, [jsonMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = kind ? FIGURE_FORMS[kind as FigureKind] ?? [] : [];
  const set = (path: string, v: unknown) => onChange(setPath(value, path, v) as FigureSpec);

  return (
    <div className="figure-editor">
      <div className="row2">
        <label>ชนิดรูป
          <select value={kind} aria-label="ชนิดรูป" onChange={(e) => {
            const k = e.target.value as FigureKind | '';
            onChange(k ? structuredClone(FIGURE_SAMPLES[k]) : null);
          }}>
            <option value="">ไม่มีรูป</option>
            {(Object.keys(KIND_LABEL_TH) as FigureKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL_TH[k]}</option>)}
          </select>
        </label>
        {value && (
          <label className="check" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={jsonMode} onChange={(e) => setJsonMode(e.target.checked)} /> แก้แบบ JSON
          </label>
        )}
      </div>
      {value && !jsonMode && (
        <div className="field-grid" key={kind}>
          {fields.filter((f) => !f.when || f.when(value)).map((f) => {
            const v = getPath(value, f.path);
            return (
              <label key={f.path} className={f.type === 'list' ? 'wide' : f.type === 'bool' ? 'check' : ''}>
                {f.type === 'bool' ? (
                  <><input type="checkbox" checked={!!v} onChange={(e) => set(f.path, e.target.checked || undefined)} /> {f.label}</>
                ) : (
                  <>
                    <span>{f.label}</span>
                    {f.type === 'number' && (
                      <input type="number" step="any" aria-label={f.label} value={v === undefined ? '' : String(v)}
                        onChange={(e) => set(f.path, e.target.value === '' ? undefined : Number(e.target.value))} />
                    )}
                    {f.type === 'text' && (
                      <input type="text" aria-label={f.label} value={(v as string) ?? ''} onChange={(e) => set(f.path, e.target.value || undefined)} />
                    )}
                    {f.type === 'select' && (
                      <select aria-label={f.label} value={(v as string) ?? f.options![0].value} onChange={(e) => set(f.path, e.target.value)}>
                        {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                    {f.type === 'lbl' && <LblInput label={f.label} value={v as Lbl} onChange={(x) => set(f.path, x)} />}
                    {f.type === 'list' && <ListInput field={f} value={v} onChange={(x) => set(f.path, x)} />}
                  </>
                )}
              </label>
            );
          })}
        </div>
      )}
      {value && jsonMode && (
        <>
          <textarea className="mono" rows={10} aria-label="ข้อกำหนดรูป JSON" value={jsonText} onChange={(e) => {
            setJsonText(e.target.value);
            try {
              const v = JSON.parse(e.target.value);
              if (!v || typeof v !== 'object' || !v.kind) throw new Error('ต้องมี "kind"');
              setJsonError(null); onChange(v);
            } catch (err) { setJsonError(`JSON ไม่ถูกต้อง: ${(err as Error).message}`); }
          }} />
          {jsonError && <div className="error">{jsonError}</div>}
        </>
      )}
    </div>
  );
}
