import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, BellOff } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { takeNewCriticalAlerts, titleWithCriticalCount } from '../../lib/criticalAlerts';
import type { Incident } from '../../types';

/** Per-viewer preference (this browser only) */
const PREF_KEY = 'scholario.criticalAlerts';
const readPref = () => { try { return localStorage.getItem(PREF_KEY) === 'on'; } catch { return false; } };
const writePref = (on: boolean) => { try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };
const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

// One AudioContext per page. Browsers only let it play after a user gesture: it is created on the
// toggle click, and resumed on the next click / key press after a reload.
let audio: AudioContext | null = null;
function audioContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio ??= new Ctor();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    return audio;
  } catch { return null; }
}
/** Two-tone chime generated in the browser (no audio file to load) */
function chime() {
  const ctx = audioContext();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  [880, 660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + i * 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.17);
  });
}

/**
 * Top-bar toggle + watcher: when on, every new unacknowledged CRITICAL / EMERGENCY incident plays a
 * chime and shows a browser notification (click → opens the incident). Incidents already open when
 * the page loads are not announced. The tab title always shows the open critical count.
 */
export const CriticalAlerts: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const { incidents, isLoading, setSelectedIncidentId } = useOps();
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(readPref);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (notificationsSupported() ? Notification.permission : 'unsupported'));
  const seen = useRef<Set<string> | null>(null);
  const baseTitle = useRef(typeof document !== 'undefined' ? document.title : 'Scholario Ops');

  // Re-arm audio after a reload on the first interaction (browser autoplay rules)
  useEffect(() => {
    if (!enabled) return;
    const arm = () => { audioContext(); };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => { window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm); };
  }, [enabled]);

  useEffect(() => {
    if (isLoading) return;
    // First load: everything already open is the baseline, not news
    if (!seen.current) { seen.current = new Set(); takeNewCriticalAlerts(incidents, seen.current); return; }
    const fresh = takeNewCriticalAlerts(incidents, seen.current);
    if (!enabled || fresh.length === 0) return;
    chime();
    if (permission === 'granted') for (const inc of fresh.slice(0, 3)) show(inc);
  }, [incidents, isLoading]);

  useEffect(() => { document.title = titleWithCriticalCount(baseTitle.current, incidents); }, [incidents]);
  useEffect(() => () => { document.title = baseTitle.current; }, []);

  function show(inc: Incident) {
    try {
      const n = new Notification(`${inc.severity}: ${inc.title}`, {
        body: `${inc.id} · ${inc.environment}${inc.rootCause ? ` — ${inc.rootCause.slice(0, 160)}` : ''}`,
        tag: inc.id, // one notification per incident, even with several tabs open
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); setSelectedIncidentId(inc.id); navigate('/incidents'); n.close(); };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    writePref(next);
    if (!next) return;
    audioContext(); // created inside the click: allowed to play from now on
    if (notificationsSupported() && Notification.permission === 'default') {
      try { setPermission(await Notification.requestPermission()); } catch { /* ignored */ }
    }
    chime(); // confirms the sound works
  };

  const hint = !enabled
    ? 'Critical alerts are off — click to get a sound and a browser notification for every new critical incident'
    : permission === 'granted' ? 'Critical alerts on: sound + browser notification'
      : permission === 'denied' ? 'Critical alerts on: sound only — notifications are blocked for this site in the browser settings'
        : 'Critical alerts on: sound only (browser notifications unavailable)';

  return (
    <button
      onClick={() => void toggle()}
      title={hint}
      aria-label={hint}
      aria-pressed={enabled}
      className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono rounded transition-colors border cursor-pointer ${
        enabled
          ? isDark ? 'bg-rose-950/40 hover:bg-rose-950/70 text-rose-300 border-rose-900/60' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300'
          : isDark ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-400 border-[#23334E]' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-300 shadow-2xs'
      }`}
    >
      {enabled ? <BellRing className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
      <span className="hidden xl:inline">{enabled ? 'ALERTS ON' : 'ALERTS OFF'}</span>
    </button>
  );
};
