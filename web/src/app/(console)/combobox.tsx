"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ComboOption = {
  value: string;
  label: string;
  /// Shown dimmed after the label — a semester, the programmes an entry covers.
  hint?: string;
  /// Matched by the search but not shown.
  keywords?: string;
};

/// A select you can type into. Every word typed must appear somewhere in the option — its
/// code, its title, its hint or its keywords — so "maths 2" finds Engineering Mathematics
/// II, and "1017" or "basic" finds Basic Sciences.
///
/// Keyboard first, like the rest of the console: ↓/↑ move, Enter picks, Escape backs out.
/// While open, the box holds the search and the placeholder shows what is chosen, so you
/// can start typing without clearing anything first.
export function Combobox({
  id, label, options, value, onChange, placeholder, disabled,
}: {
  id: string;
  label: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);
  const describe = (o: ComboOption) => `${o.value} — ${o.label}`;

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const haystack = `${o.value} ${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [query, options]);

  // Keep the highlighted row in view when arrowing through a list longer than the panel.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(o: ComboOption) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="field combo">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={open ? query : selected ? describe(selected) : ""}
        placeholder={selected ? describe(selected) : placeholder}
        onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
        onBlur={() => { setOpen(false); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="combo-list" ref={listRef}>
          {matches.length === 0 && <li className="combo-empty">Nothing matches “{query}”.</li>}
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? "combo-opt active" : "combo-opt"}
              // mousedown rather than click: a click would blur the input first, closing the
              // list before the choice lands.
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="mono">{o.value}</span>
              <span className="combo-label">{o.label}</span>
              {o.hint && <span className="combo-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
