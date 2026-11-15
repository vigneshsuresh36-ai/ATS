"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

/** Small "⋯" menu for the secondary actions on a table row. The list is fixed to the window so a scrolling table cannot clip it. */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const scroll = (event: Event) => { if (!list.current?.contains(event.target as Node)) setOpen(false); };
    const resize = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !root.current || !list.current) { setPos(null); return; }
    const button = root.current.getBoundingClientRect();
    const box = list.current.getBoundingClientRect();
    const margin = 12;
    const left = Math.max(margin, Math.min(button.right - box.width, window.innerWidth - box.width - margin));
    const below = button.bottom + 4;
    const top = below + box.height > window.innerHeight - margin ? Math.max(margin, button.top - box.height - 4) : below;
    setPos({ top, left });
  }, [open]);

  if (!items.length) return null;
  return (
    <div className="ats-row-menu" ref={root}>
      <button type="button" className="ats-row-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}>⋯</button>
      {open && (
        <div className="ats-row-menu-list" role="menu" ref={list} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
          {items.map((item) => (
            <button type="button" role="menuitem" key={item.label} className={item.danger ? "is-danger" : ""} disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
