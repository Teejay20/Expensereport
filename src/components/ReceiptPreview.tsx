// Shows receipt images and PDF pages inside the app so the user can check what was read.
import { useEffect, useState } from 'react';
import type { Attachment } from '../lib/types';
import { Icon } from './ui';

/** Object URLs for every page of an attachment (images: 1 page, PDFs: rendered pages). */
export function usePages(a?: Attachment): { urls: string[]; loading: boolean; error?: string } {
  const [state, set] = useState<{ urls: string[]; loading: boolean; error?: string }>({ urls: [], loading: !!a });
  useEffect(() => {
    if (!a) { set({ urls: [], loading: false }); return; }
    let live = true;
    let urls: string[] = [];
    set({ urls: [], loading: true });
    (async () => {
      try {
        if (a.mime === 'application/pdf') {
          const { pdfToImages } = await import('../lib/pdfText');
          const blobs = await pdfToImages(a.blob);
          urls = blobs.map((b) => URL.createObjectURL(b));
        } else {
          urls = [URL.createObjectURL(a.blob)];
        }
        if (live) set({ urls, loading: false });
      } catch (e) {
        if (live) set({ urls: [], loading: false, error: (e as Error).message });
      }
    })();
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [a]);
  return state;
}

/** Inline panel in the expense editor: scrollable pages + full-screen button. */
export function ReceiptPreview({ a, onFullScreen }: { a?: Attachment; onFullScreen: () => void }) {
  const { urls, loading, error } = usePages(a);
  const [tall, setTall] = useState(false);
  if (!a) return null;
  return (
    <div className="preview">
      <div className={`preview-scroll${tall ? ' tall' : ''}`}>
        {loading && <div className="preview-msg">Loading {a.mime === 'application/pdf' ? 'PDF pages' : 'image'}…</div>}
        {error && <div className="preview-msg">Can't show this file: {error}</div>}
        {urls.map((u, i) => (
          <div key={u} className="preview-page">
            {urls.length > 1 && <span className="page-tag">Page {i + 1}/{urls.length}</span>}
            <img src={u} alt={`Receipt page ${i + 1}`} onClick={onFullScreen} />
          </div>
        ))}
      </div>
      <div className="preview-bar">
        <button className="btn sm ghost" onClick={() => setTall((t) => !t)}>{tall ? 'Smaller' : 'Taller'}</button>
        <span className="spacer" />
        <button className="btn sm" onClick={onFullScreen}><Icon name="expand" size={16} />Full screen</button>
      </div>
    </div>
  );
}

/** Full-screen viewer with zoom; works for images and PDFs on every phone. */
export function ReceiptViewer({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const { urls, loading, error } = usePages(a);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Android back button closes the viewer instead of leaving the screen
    history.pushState({ viewer: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop); };
  }, [onClose]);
  const close = () => { if (history.state?.viewer) history.back(); else onClose(); };
  return (
    <div className="viewer2" role="dialog" aria-label={a.name}>
      <div className="viewer2-bar">
        <span className="viewer2-title">{a.name}{urls.length > 1 ? ` · ${urls.length} pages` : ''}</span>
        <button className="icon-btn light" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}><Icon name="minus" /></button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn light" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}><Icon name="plus" /></button>
        <button className="icon-btn light" aria-label="Close" onClick={close}><Icon name="x" /></button>
      </div>
      <div className="viewer2-body">
        {loading && <div className="preview-msg light">Loading…</div>}
        {error && <div className="preview-msg light">Can't show this file: {error}</div>}
        {urls.map((u, i) => (
          <img key={u} src={u} alt={`Page ${i + 1}`} style={{ width: `${zoom * 100}%` }} onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))} />
        ))}
      </div>
    </div>
  );
}
