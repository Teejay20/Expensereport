import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { monthLabel } from '../lib/dates';
import { shiftMonth, useToasts } from '../state';
import type { Attachment } from '../lib/types';

export function Header({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
      ) : <span className="brand-dot" aria-hidden />}
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-nav">
      <button className="icon-btn" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}><Icon name="left" /></button>
      <label className="month-label">
        {monthLabel(month)}
        <input type="month" value={month} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Pick month" />
      </label>
      <button className="icon-btn" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}><Icon name="right" /></button>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Numeric input that keeps the user's text while typing (no jumping cursor). */
export function MoneyInput({ value, onChange, placeholder, autoFocus, id }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; id?: string }) {
  return (
    <input
      id={id}
      className="input money"
      inputMode="decimal"
      value={value}
      placeholder={placeholder ?? '0.00'}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.'))}
    />
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)}>
      <div className="progress-bar" style={{ width: `${Math.max(4, value * 100)}%` }} />
      {label && <span className="progress-label">{label}</span>}
    </div>
  );
}

export function Toasts() {
  const t = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {t.map((x) => <div key={x.id} className={`toast ${x.kind}`}>{x.text}</div>)}
    </div>
  );
}

export function useObjectUrl(blob?: Blob): string | undefined {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

export function AttachmentThumb({ a, onOpen, onRemove, onRotate }: { a: Attachment; onOpen?: () => void; onRemove?: () => void; onRotate?: () => void }) {
  const url = useObjectUrl(a.blob);
  const isPdf = a.mime === 'application/pdf';
  return (
    <div className="thumb">
      <button className="thumb-img" onClick={onOpen} aria-label={`Open ${a.name}`}>
        {isPdf ? <span className="pdf-badge">PDF</span> : url && <img src={url} alt="" />}
      </button>
      <div className="thumb-actions">
        {onRotate && !isPdf && <button className="mini" onClick={onRotate} aria-label="Rotate"><Icon name="rotate" /></button>}
        {onRemove && <button className="mini danger" onClick={onRemove} aria-label="Remove"><Icon name="x" /></button>}
      </div>
    </div>
  );
}

export function Viewer({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const url = useObjectUrl(a.blob);
  return (
    <div className="viewer" role="dialog" onClick={onClose}>
      <button className="icon-btn viewer-close" aria-label="Close"><Icon name="x" /></button>
      {a.mime === 'application/pdf'
        ? <iframe title={a.name} src={url} onClick={(e) => e.stopPropagation()} />
        : <img src={url} alt={a.name} onClick={(e) => e.stopPropagation()} />}
    </div>
  );
}

/** Hidden file input triggered by a button. `capture` opens the camera directly on phones. */
export function FilePick({ children, accept, capture, multiple, onFiles, className }: { children: ReactNode; accept: string; capture?: boolean; multiple?: boolean; onFiles: (f: File[]) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>{children}</button>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        {...(capture ? { capture: 'environment' } : {})}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

export function Confirm({ text, onYes, children, className }: { text: string; onYes: () => void; children: ReactNode; className?: string }) {
  return <button type="button" className={className} onClick={() => window.confirm(text) && onYes()}>{children}</button>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data?: T; error?: Error; loading: boolean } {
  const [s, set] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    set((x) => ({ ...x, loading: true }));
    fn().then((data) => live && set({ data, loading: false }), (error) => live && set({ error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

const PATHS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  x: 'M18 6L6 18M6 6l12 12',
  camera: 'M3 8h3l2-3h8l2 3h3v12H3zM12 17a4 4 0 100-8 4 4 0 000 8z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  car: 'M5 16h14M6 16l1.5-5h9L18 16M5 16v3h2v-2h10v2h2v-3M8 13.5h.01M16 13.5h.01',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  rotate: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 1114 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  share: 'M4 12v8h16v-8M12 3v13M7 8l5-5 5 5',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  check: 'M5 12l5 5L20 7',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
