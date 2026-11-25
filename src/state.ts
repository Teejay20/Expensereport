// Tiny app-level state: hash routing, selected month, files waiting to be processed.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { todayISO, monthKey } from './lib/dates';

// ---------- Router (hash based: works on GitHub Pages and with the Android back button)
export function useRoute(): string[] {
  const get = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
let navDepth = 0;
export const go = (path: string) => { navDepth++; location.hash = `#/${path.replace(/^\//, '')}`; };
/** Go back if we navigated inside the app, otherwise to `fallback` (e.g. after a share-target launch). */
export const back = (fallback = '') => {
  if (navDepth > 0) { navDepth--; history.back(); } else { location.replace(`#/${fallback}`); }
};

// ---------- Selected month (persisted per device)
type Listener = () => void;
const listeners = new Set<Listener>();
let month = (() => {
  try { return localStorage.getItem('month') || monthKey(todayISO()); } catch { return monthKey(todayISO()); }
})();
export function setMonth(m: string) {
  month = m;
  try { localStorage.setItem('month', m); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useMonth(): [string, (m: string) => void] {
  const m = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => month);
  return [m, setMonth];
}
export function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------- Files handed from one screen to the next (camera capture, share target)
let pending: File[] = [];
export const setPendingFiles = (f: File[]) => { pending = f; };
export const takePendingFiles = () => { const f = pending; pending = []; return f; };

// ---------- Toasts
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
let toasts: Toast[] = [];
const toastListeners = new Set<Listener>();
export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  const t = { id: Date.now() + Math.random(), text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); toastListeners.forEach((l) => l()); }, 3500);
}
export function useToasts(): Toast[] {
  return useSyncExternalStore((l) => (toastListeners.add(l), () => toastListeners.delete(l)), () => toasts);
}
