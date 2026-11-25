import { lazy, Suspense, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, requestPersistence } from './lib/db';
import { DEFAULT_SETTINGS } from './lib/types';
import { takeSharedFiles } from './lib/share';
import { preloadOcr } from './lib/ocr';
import { Home } from './screens/Home';
import { SettingsScreen } from './screens/Settings';
import { ScanGuide } from './screens/ScanGuide';

const ExpenseEditor = lazy(() => import('./screens/ExpenseEditor').then((m) => ({ default: m.ExpenseEditor })));
const TripEditor = lazy(() => import('./screens/TripEditor').then((m) => ({ default: m.TripEditor })));
const MonthEnd = lazy(() => import('./screens/MonthEnd').then((m) => ({ default: m.MonthEnd })));
const BatchImport = lazy(() => import('./screens/BatchImport').then((m) => ({ default: m.BatchImport })));
import { Icon, Toasts } from './components/ui';
import { go, setPendingFiles, useRoute } from './state';

export default function App() {
  const route = useRoute();
  const settings = useLiveQuery(getSettings, [], undefined);

  useEffect(() => {
    requestPersistence();
    // Warm up OCR when idle so the first scan is fast
    const t = setTimeout(preloadOcr, 2500);
    return () => clearTimeout(t);
  }, []);

  // Files shared from another app (Android share sheet → service worker → here)
  useEffect(() => {
    if (route[0] !== 'inbox') return;
    takeSharedFiles().then((files) => {
      setPendingFiles(files);
      location.replace(files.length > 1 ? '#/import' : files.length ? '#/expense/new' : '#/');
    });
  }, [route]);

  // First run → settings
  useEffect(() => {
    if (settings && !settings.fullName && route.length === 0) {
      db.settings.get('me').then((s) => { if (!s) go('settings'); });
    }
  }, [settings, route]);

  if (!settings) return null;
  const s = settings ?? DEFAULT_SETTINGS;
  const [page, id] = route;

  let screen;
  switch (page) {
    case 'expense': screen = <ExpenseEditor key={id} id={id} settings={s} />; break;
    case 'trip': screen = <TripEditor key={id} id={id} settings={s} />; break;
    case 'report': screen = <MonthEnd settings={s} />; break;
    case 'settings': screen = <SettingsScreen settings={s} />; break;
    case 'import': screen = <BatchImport settings={s} />; break;
    case 'scan-help': screen = <ScanGuide />; break;
    case 'inbox': screen = null; break;
    default: screen = <Home settings={s} />;
  }

  const tab = (name: string, path: string, icon: string, label: string) => (
    <a href={`#/${path}`} className={(page ?? '') === name ? 'active' : ''}><Icon name={icon} />{label}</a>
  );
  return (
    <div className="app">
      <Suspense fallback={<div className="empty">Loading…</div>}>{screen}</Suspense>
      <nav className="bottom-nav">
        {tab('', '', 'list', 'Expenses')}
        {tab('trip', 'trip/new', 'car', 'Trip')}
        {tab('report', 'report', 'report', 'Month-end')}
        {tab('settings', 'settings', 'settings', 'Settings')}
      </nav>
      <Toasts />
    </div>
  );
}
