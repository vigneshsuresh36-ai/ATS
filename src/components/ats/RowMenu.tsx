"use client";
import { useEffect, useRef, useState } from "react";

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

/** Small "⋯" menu for the secondary actions on a table row. */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="ats-row-menu" ref={root}>
      <button type="button" className="ats-row-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}>⋯</button>
      {open && (
        <div className="ats-row-menu-list" role="menu">
          {items.map((item) => (
            <button type="button" role="menuitem" key={item.label} className={item.danger ? "is-danger" : ""} disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
