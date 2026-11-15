"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type Props = {
  type: "date" | "datetime-local";
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  id?: string;
  style?: CSSProperties;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  placeholder?: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

type Parts = { y: number; m: number; d: number; h: number; min: number };
function parse(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value || "");
  if (!match) return null;
  return { y: +match[1], m: +match[2] - 1, d: +match[3], h: match[4] ? +match[4] : 9, min: match[5] ? +match[5] : 0 };
}
function format(parts: Parts, withTime: boolean) {
  const base = `${parts.d} ${MONTHS[parts.m].slice(0, 3)} ${parts.y}`;
  if (!withTime) return base;
  const hour12 = parts.h % 12 === 0 ? 12 : parts.h % 12;
  return `${base}, ${hour12}:${pad(parts.min)} ${parts.h >= 12 ? "PM" : "AM"}`;
}

/** Drop-in replacement for date and datetime-local inputs, styled to the ATS black, grey and white theme. */
export function DateTimeField({ type, value, onChange, id, style, className, required, disabled, placeholder, ...rest }: Props) {
  const withTime = type === "datetime-local";
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const parsed = useMemo(() => parse(value), [value]);
  const today = new Date();
  const [view, setView] = useState({ y: (parsed ?? { y: today.getFullYear() }).y, m: (parsed ?? { m: today.getMonth() }).m });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const resize = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", resize); };
  }, [open]);

  /** Keeps the panel fully inside the window: shifts left near the right edge and opens upward near the bottom. */
  useLayoutEffect(() => {
    if (!open || !root.current || !panel.current) { setPos(null); return; }
    const trigger = root.current.getBoundingClientRect();
    const box = panel.current.getBoundingClientRect();
    const margin = 12;
    const left = Math.max(margin, Math.min(trigger.left, window.innerWidth - box.width - margin));
    const below = trigger.bottom + 6;
    const top = below + box.height > window.innerHeight - margin ? Math.max(margin, trigger.top - box.height - 6) : below;
    setPos({ top, left });
  }, [open, view.m, view.y, withTime, value]);

  function emit(parts: Parts) { onChange({ target: { value: withTime ? `${dateKey(parts.y, parts.m, parts.d)}T${pad(parts.h)}:${pad(parts.min)}` : dateKey(parts.y, parts.m, parts.d) } }); }
  function openPanel() {
    if (disabled) return;
    const base = parsed ?? { y: today.getFullYear(), m: today.getMonth() };
    setView({ y: base.y, m: base.m });
    setOpen((current) => !current);
  }
  function pickDay(d: number, y = view.y, m = view.m) { emit({ y, m, d, h: parsed?.h ?? 9, min: parsed?.min ?? 0 }); if (!withTime) setOpen(false); }
  function setTime(patch: Partial<Pick<Parts, "h" | "min">>) {
    const base = parsed ?? { y: today.getFullYear(), m: today.getMonth(), d: today.getDate(), h: 9, min: 0 };
    emit({ ...base, ...patch });
  }
  function shift(delta: number) {
    const next = new Date(view.y, view.m + delta, 1);
    setView({ y: next.getFullYear(), m: next.getMonth() });
  }

  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: { y: number; m: number; d: number; muted: boolean }[] = [];
  const prevDays = new Date(view.y, view.m, 0).getDate();
  for (let i = first - 1; i >= 0; i--) { const dt = new Date(view.y, view.m - 1, prevDays - i); cells.push({ y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), muted: true }); }
  for (let d = 1; d <= days; d++) cells.push({ y: view.y, m: view.m, d, muted: false });
  while (cells.length % 7 !== 0 || cells.length < 42) { const dt = new Date(view.y, view.m + 1, cells.length - first - days + 1); cells.push({ y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), muted: true }); }

  const hour12 = parsed ? (parsed.h % 12 === 0 ? 12 : parsed.h % 12) : 9;
  const isPm = parsed ? parsed.h >= 12 : false;
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), ...(parsed ? [parsed.min] : [])])].sort((a, b) => a - b);
  const to24 = (h12: number, pm: boolean) => (h12 % 12) + (pm ? 12 : 0);
  const selectedKey = parsed ? dateKey(parsed.y, parsed.m, parsed.d) : "";
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className={`ats-dt ${className || ""}`} ref={root}>
      <button type="button" id={id} className="ats-dt-trigger" style={style} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={rest["aria-label"]} onClick={openPanel}>
        <span className={parsed ? "" : "is-placeholder"}>{parsed ? format(parsed, withTime) : placeholder || (withTime ? "Select date and time" : "Select date")}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
      </button>
      {required && <input className="ats-dt-required" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => undefined} />}
      {open && (
        <div className="ats-dt-panel" ref={panel} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }} id={panelId} role="dialog" aria-label={withTime ? "Choose date and time" : "Choose date"}>
          <div className="ats-dt-cal">
            <div className="ats-dt-head">
              <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
              <strong>{MONTHS[view.m]} {view.y}</strong>
              <button type="button" aria-label="Next month" onClick={() => shift(1)}>›</button>
            </div>
            <div className="ats-dt-grid" role="grid">
              {WEEKDAYS.map((w) => <span key={w} className="ats-dt-dow">{w}</span>)}
              {cells.map((cell) => {
                const key = dateKey(cell.y, cell.m, cell.d);
                return <button type="button" key={key} className={`ats-dt-day${cell.muted ? " is-muted" : ""}${key === selectedKey ? " is-selected" : ""}${key === todayKey ? " is-today" : ""}`} aria-label={`${cell.d} ${MONTHS[cell.m]} ${cell.y}`} aria-pressed={key === selectedKey} onClick={() => { setView({ y: cell.y, m: cell.m }); pickDay(cell.d, cell.y, cell.m); }}>{cell.d}</button>;
              })}
            </div>
          </div>
          {withTime && (
            <div className="ats-dt-time">
              <span className="ats-dt-label">Time</span>
              <div className="ats-dt-time-row">
                <select aria-label="Hour" value={hour12} onChange={(event) => setTime({ h: to24(+event.target.value, isPm) })}>{Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{pad(h)}</option>)}</select>
                <span aria-hidden="true">:</span>
                <select aria-label="Minute" value={parsed?.min ?? 0} onChange={(event) => setTime({ min: +event.target.value })}>{minutes.map((m) => <option key={m} value={m}>{pad(m)}</option>)}</select>
                <div className="ats-dt-ampm" role="group" aria-label="AM or PM">
                  <button type="button" className={!isPm ? "is-on" : ""} aria-pressed={!isPm} onClick={() => setTime({ h: to24(hour12, false) })}>AM</button>
                  <button type="button" className={isPm ? "is-on" : ""} aria-pressed={isPm} onClick={() => setTime({ h: to24(hour12, true) })}>PM</button>
                </div>
              </div>
            </div>
          )}
          <div className="ats-dt-foot">
            {!required && <button type="button" onClick={() => { onChange({ target: { value: "" } }); setOpen(false); }}>Clear</button>}
            <button type="button" onClick={() => { setView({ y: today.getFullYear(), m: today.getMonth() }); pickDay(today.getDate(), today.getFullYear(), today.getMonth()); }}>Today</button>
            {withTime && <button type="button" className="is-primary" onClick={() => setOpen(false)}>Done</button>}
          </div>
        </div>
      )}
    </div>
  );
}
