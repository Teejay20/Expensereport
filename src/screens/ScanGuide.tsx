// How to use the phone's built-in document scanner and hand the result to the app.
import { useState } from 'react';
import { Header, Icon } from '../components/ui';
import { back } from '../state';

const ua = navigator.userAgent;
export const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isSamsung = /samsung|SM-[A-Z]\d/i.test(ua);

function AndroidSteps() {
  return (
    <>
      {isSamsung && (
        <>
          <h3>Samsung camera (built in)</h3>
          <ol>
            <li>Open <b>Camera</b> and point at the receipt – a yellow frame and a <b>Scan</b> button (“T”) appear.</li>
            <li>Tap <b>Scan</b>, adjust the corners, tap <b>Save</b>.</li>
            <li>Open it in <b>Gallery</b> → <b>Share</b> → <b>Expenses</b>.</li>
          </ol>
        </>
      )}
      <h3>Google Drive scanner (every Android phone)</h3>
      <ol>
        <li>Open <b>Google Drive</b> → tap <b>+</b> (or the camera icon) → <b>Scan</b>.</li>
        <li>Take the photo – Drive finds the edges, flattens and cleans it. Add more pages with <b>+</b> if needed.</li>
        <li>Tap <b>Save</b> (a PDF goes to your Drive).</li>
        <li>In Drive, tap <b>⋮</b> on the file → <b>Send a copy</b> → <b>Expenses</b>.</li>
      </ol>
      <h3>Receipt in an email</h3>
      <ol>
        <li>In Gmail, open the attachment → <b>Share</b> → <b>Expenses</b>.</li>
      </ol>
      <p className="small muted">Don't see “Expenses” in the share menu? Install the app first (Chrome ⋮ → Install app).</p>
    </>
  );
}

function IOSSteps() {
  return (
    <>
      <h3>Files app (built in)</h3>
      <ol>
        <li>Open <b>Files</b> → <b>Browse</b> → tap <b>⋯</b> (top right) → <b>Scan Documents</b>.</li>
        <li>Hold over the receipt – it captures automatically, flattens and cleans it. Tap <b>Save</b>.</li>
        <li>In Expenses tap <b>Upload</b> → <b>Browse</b> → pick the scan.</li>
      </ol>
      <h3>Notes app</h3>
      <ol>
        <li>New note → camera icon → <b>Scan Documents</b> → <b>Save</b>.</li>
        <li>Tap the scan → <b>Share</b> → <b>Save to Files</b>, then <b>Upload</b> it in Expenses.</li>
      </ol>
      <h3>Receipt in an email</h3>
      <ol>
        <li>Long-press the attachment → <b>Save to Files</b>, then <b>Upload</b> it in Expenses.</li>
      </ol>
    </>
  );
}

export function ScanGuide() {
  const [os, setOs] = useState<'android' | 'ios'>(isIOS ? 'ios' : 'android');
  return (
    <>
      <Header title="Scan with your phone's scanner" onBack={() => back()} />
      <div className="page">
        <div className="card guide">
          <p style={{ marginTop: 0 }}>
            Your phone's scanner straightens the receipt, crops the table away and boosts contrast. The text is then much easier to read:
            on your own receipts, scanned pages were read with <b>~87% confidence</b> versus <b>40–60%</b> for normal photos of crumpled paper.
          </p>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={os === 'android' ? 'on' : ''} onClick={() => setOs('android')}>Android</button>
            <button className={os === 'ios' ? 'on' : ''} onClick={() => setOs('ios')}>iPhone</button>
          </div>
          {os === 'android' ? <AndroidSteps /> : <IOSSteps />}
        </div>
        <div className="card guide">
          <h3 style={{ marginTop: 0 }}>Tips for any photo</h3>
          <ul className="steps-list">
            <li>Flatten the receipt; put it on a plain surface that's darker than the paper.</li>
            <li>Good light, no shadow of your phone across the text.</li>
            <li>Fill the screen with the receipt; long receipts can be 2 photos (use <b>Add page</b>).</li>
          </ul>
          <p className="small muted">Why not open the scanner from inside the app? Phones only let native store apps start their document scanner. This app is a free web app, so the scan is done first and then shared in – it takes the same few taps.</p>
        </div>
      </div>
    </>
  );
}

/** Small dismissible tip on the home screen. */
export function ScanTip({ onOpen }: { onOpen: () => void }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('hideScanTip') === '1'; } catch { return false; } });
  if (hidden) return null;
  return (
    <div className="notice info tip">
      <Icon name="scan" size={18} />
      <div style={{ flex: 1 }}>
        Crumpled paper receipt? Your phone's scanner gives much better results. <button className="link" onClick={onOpen}>How to</button>
      </div>
      <button className="mini x" aria-label="Hide tip" style={{ background: 'transparent', color: 'inherit' }} onClick={() => { setHidden(true); try { localStorage.setItem('hideScanTip', '1'); } catch { /* ignore */ } }}><Icon name="x" /></button>
    </div>
  );
}
