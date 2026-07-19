import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import "./PathAutocomplete.css";

interface PathAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  root?: string;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

function splitPath(value: string): { parent: string; prefix: string } {
  const lastSlash = value.lastIndexOf("/");
  if (lastSlash < 0) return { parent: "/", prefix: value };
  const parent = value.slice(0, lastSlash) || "/";
  const prefix = value.slice(lastSlash + 1);
  return { parent, prefix };
}

function joinPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

/**
 * Shell-style tab completion for a server-side path, backed by the same
 * /files/list endpoint the File Manager uses. Suggestions are a hint, not a
 * constraint - any text can still be typed and submitted freely.
 */
export default function PathAutocomplete({ value, onChange, placeholder, root = "apps" }: PathAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { parent, prefix } = splitPath(value);
      apiFetch(`/files/list?root=${root}&path=${encodeURIComponent(parent)}`)
        .then((data) => {
          const names = (data.entries as DirEntry[])
            .filter((e) => e.isDirectory && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
            .map((e) => joinPath(parent, e.name));
          setSuggestions(names);
          setHighlight(0);
        })
        .catch(() => setSuggestions([]));
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [value, root]);

  function accept(suggestion: string) {
    // Trailing slash mimics shell tab-complete: next keystroke/reopen lists
    // *inside* the folder just accepted, rather than re-matching its name.
    onChange(`${suggestion}/`);
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      accept(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="path-autocomplete">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {open && suggestions.length > 0 && (
        <ul className="path-suggestions">
          {suggestions.map((s, i) => (
            <li key={s}>
              <button type="button" className={i === highlight ? "active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => accept(s)}>
                📁 {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
