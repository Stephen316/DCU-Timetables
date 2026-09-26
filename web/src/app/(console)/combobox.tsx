"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ComboOption = {
  value: string;
  label: string;
  /// Shown dimmed after the label — a semester, the programmes an entry covers.
  hint?: string;
  /// Matched by the search but not shown.
  keywords?: string;
  /// Shown in the code column and the box in place of `value`, for options whose value is a
  /// key nobody should have to read.
  code?: string;
};

/// A select with a search box in its list. Clicking the box opens the list — it used to turn
/// the box itself into the search field, so clicking a module already chosen wiped it from
/// view and left a text cursor where a list was expected. Now the choice stays shown, and the
/// search lives at the top of the list.
///
/// Every word typed must appear somewhere in the option — its code, its title, its hint or
/// its keywords — so "maths 2" finds Engineering Mathematics II, and "1017" or "basic" finds
/// Basic Sciences.
///
/// Keyboard first, like the rest of the console: ↓, Enter or Space opens; ↓/↑ move, Enter
/// picks, Escape backs out to the box.
export function Combobox({
  id, label, options, value, onChange, placeholder, disabled,
}: {
  id: string;
  label: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  /// The search box's prompt.
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);
  const codeOf = (o: ComboOption) => o.code ?? o.value;

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const haystack = `${codeOf(o)} ${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [query, options]);

  // Keep the highlighted row in view when arrowing through a list longer than the panel.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function show() {
    setQuery("");
    // Opens on the current choice, so the list shows where you are.
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  }

  function choose(o: ComboOption) {
    onChange(o.value);
    close(true);
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
  }

  return (
    <div
      className="field combo"
      ref={root}
      // Focus leaving the whole control — a click elsewhere, or Tab — closes the list. Moving
      // between the box and the search inside it does not.
      onBlur={(e) => { if (open && !root.current?.contains(e.relatedTarget as Node | null)) close(false); }}
    >
      <label htmlFor={id}>{label}</label>
      <button
        id={id}
        ref={trigger}
        type="button"
        className="combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (open ? close(true) : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); show(); }
        }}
      >
        {selected ? (
          <span className="combo-value">
            <span className="mono">{codeOf(selected)}</span> <span className="dim">—</span> {selected.label}
          </span>
        ) : (
          <span className="combo-value dim">Choose {label.toLowerCase()}…</span>
        )}
        <span className={open ? "combo-caret open" : "combo-caret"} aria-hidden="true" />
      </button>

      {open && (
        <div className="combo-pop">
          <div className="combo-search">
            <svg className="combo-search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={placeholder}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onSearchKey}
            />
          </div>
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
                // mousedown rather than click: a click would blur the search first, closing
                // the list before the choice lands.
                onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="mono">{codeOf(o)}</span>
                <span className="combo-label">{o.label}</span>
                {o.hint && <span className="combo-hint">{o.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
