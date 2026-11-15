"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

export function IndianCityPicker({ id, label, value, onChange, initialQuery = "", inputStyle }: {
  id?: string;
  label?: string;
  value: string;
  onChange: (city: string) => void;
  initialQuery?: string;
  inputStyle?: CSSProperties;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [results, setResults] = useState<{ query: string; suggestions: string[]; failed?: boolean }>();
  const search = query.trim();
  const searching = focused && !dismissed && !value && search.length >= 2;
  const current = searching && results?.query === search ? results : undefined;
  const suggestions = current?.suggestions ?? [];
  const open = suggestions.length > 0;

  useEffect(() => {
    input.current?.setCustomValidity(!value && query.trim() ? "Choose a city from the suggestions." : "");
  }, [value, query]);

  useEffect(() => {
    if (!searching) return;
    const request = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/public/india-cities?q=" + encodeURIComponent(search), { signal: request.signal });
        if (!response.ok) throw new Error();
        const data: { suggestions: string[] } = await response.json();
        if (!request.signal.aborted) setResults({ query: search, suggestions: data.suggestions.slice(0, 3) });
      } catch {
        if (!request.signal.aborted) setResults({ query: search, suggestions: [], failed: true });
      }
    }, 150);
    return () => { window.clearTimeout(timer); request.abort(); };
  }, [search, searching]);

  function choose(city: string) {
    onChange(city);
    setQuery("");
    setHighlight(-1);
    setDismissed(true);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && searching) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setHighlight(-1);
    } else if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const move = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((index) => index < 0 && move < 0 ? suggestions.length - 1 : (index + move + suggestions.length) % suggestions.length);
    } else if (open && event.key === "Enter" && highlight >= 0 && suggestions[highlight]) {
      event.preventDefault();
      choose(suggestions[highlight]);
    }
  }

  return (
    <div className="ats-indian-city-picker">
      <input
        ref={input}
        id={id}
        aria-label={label}
        style={inputStyle}
        value={value || query}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && highlight >= 0 ? listId + "-" + highlight : undefined}
        autoComplete="off"
        placeholder="Search and select a city"
        maxLength={120}
        required
        onChange={(event) => {
          setQuery(event.target.value);
          onChange("");
          setDismissed(false);
          setHighlight(-1);
          event.currentTarget.setCustomValidity(event.target.value.trim() ? "Choose a city from the suggestions." : "");
        }}
        onFocus={() => { setFocused(true); setDismissed(false); setHighlight(-1); }}
        onBlur={() => {
          setFocused(false);
          setHighlight(-1);
          setQuery("");
        }}
        onKeyDown={handleKey}
      />
      <ul id={listId} className="ats-indian-city-options" role="listbox" aria-label="City suggestions" hidden={!open}>
        {suggestions.map((city, index) => (
          <li key={city} id={listId + "-" + index} role="option" aria-selected={highlight === index}
            onPointerDown={(event) => event.preventDefault()} onClick={() => choose(city)}>
            {city}
          </li>
        ))}
      </ul>
      {searching && current && !open && <span className="ats-indian-city-message" role="status">
        {current.failed ? "City search is unavailable. Edit the search to try again." : "No matching city. Try another spelling."}
      </span>}
    </div>
  );
}
