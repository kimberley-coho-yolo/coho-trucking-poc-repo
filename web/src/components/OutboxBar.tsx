// Tells people what is happening with their changes: no signal, waiting to send, or not sent.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { outboxApi } from '../lib/backend';
import type { OutboxItem } from '../lib/outbox';

export function useOutbox() {
  const api = outboxApi();
  const [items, setItems] = useState<OutboxItem[]>(() => api?.outbox() ?? []);
  const [online, setOnline] = useState(() => api?.isOnline() ?? true);
  useEffect(() => {
    if (!api) return;
    const update = () => { setItems(api.outbox()); setOnline(api.isOnline()); };
    const stop = api.onOutbox(update);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    update();
    return () => { stop(); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [api]);
  return { api, items, online };
}

export default function OutboxBar() {
  const { api, items, online } = useOutbox();
  const failed = items.filter(i => i.status === 'failed' || i.status === 'sign_in');
  const waiting = items.filter(i => i.status === 'queued' || i.status === 'sending');
  const prevFailed = useRef(failed.length);

  // a change that did not go through: show it in the tab title and, if allowed, as a phone notification
  useEffect(() => {
    const base = document.title.replace(/^\(\d+ not sent\) /, '');
    document.title = failed.length ? `(${failed.length} not sent) ${base}` : base;
    if (failed.length > prevFailed.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Coho Drive: a change was not sent', { body: 'Open Coho Drive and check Not sent.', tag: 'coho-outbox' }); } catch { /* not supported */ }
    }
    prevFailed.current = failed.length;
  }, [failed.length]);

  if (!api) return null;
  if (failed.length) return (
    <div className="outbox-bar fail" role="alert">
      <b>{failed.length} change{failed.length > 1 ? 's' : ''} not sent.</b> {failed[0].status === 'sign_in' ? 'Sign in again to send them.' : 'They need you to check them.'}
      <Link className="button small" to="/outbox">Review</Link>
    </div>);
  if (!online) return (
    <div className="outbox-bar offline" role="status">
      <b>No signal.</b> Keep working: changes are saved on this device{waiting.length ? ` (${waiting.length} waiting)` : ''} and send by themselves when signal is back.
    </div>);
  if (waiting.length) return (
    <div className="outbox-bar waiting" role="status">
      {waiting.some(w => w.status === 'sending') ? 'Sending' : 'Waiting to send'} {waiting.length} change{waiting.length > 1 ? 's' : ''}...
      <button className="small" onClick={() => api.flush()}>Send now</button> <Link to="/outbox">Details</Link>
    </div>);
  return null;
}
