/** Building blocks for Settings' pages: grouped cards of rows, like the iPhone app's Settings. Every control has a
 * visible label; switches are real checkboxes. */
import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "../Icons";
import "../../styles/settings.css";

export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={title ? id : undefined}>
      {title && <h2 id={id}>{title}</h2>}
      <div className="settings-card">{children}</div>
      {footer && <p className="settings-footer muted small">{footer}</p>}
    </section>
  );
}

function Text({ label, description, htmlFor }: { label: ReactNode; description?: ReactNode; htmlFor?: string }) {
  return (
    <span className="settings-text">
      {htmlFor ? <label className="strong" htmlFor={htmlFor}>{label}</label> : <span className="strong">{label}</span>}
      {description && <span className="muted small">{description}</span>}
    </span>
  );
}

/** A plain row: label (and description) on the left, anything on the right. */
export function Row({ label, description, children }: { label: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="settings-item">
      <Text label={label} description={description} />
      {children && <div className="settings-control">{children}</div>}
    </div>
  );
}

export function ToggleRow({ label, description, checked, onChange, disabled }: {
  label: string; description?: ReactNode; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="settings-item">
      <Text label={label} description={description} htmlFor={id} />
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export interface Option<T> { value: T; label: string }

/** A select whose values can be null or numbers (stored by position). */
export function SelectRow<T>({ label, description, value, options, onChange, disabled }: {
  label: string; description?: ReactNode; value: T; options: Option<T>[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  const id = useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="settings-item">
      <Text label={label} description={description} htmlFor={id} />
      <select id={id} className="select" value={index} disabled={disabled} onChange={(e) => onChange(options[Number(e.target.value)].value)}>
        {options.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** A hub row that opens a page. */
export function NavRow({ page, icon, color, label, value }: { page: string; icon: ReactNode; color: string; label: string; value?: string }) {
  return (
    <Link className="settings-item settings-nav" to={`/settings?page=${page}`}>
      <span className="settings-icon" style={{ background: color }} aria-hidden="true">{icon}</span>
      <span className="strong settings-nav-label">{label}</span>
      {value && <span className="muted settings-nav-value">{value}</span>}
      <ChevronRight size={16} />
    </Link>
  );
}

/** A secret or a link typed into a field, saved with a button. */
export function SaveField({ label, placeholder, type = "text", onSave, autoComplete = "off" }: {
  label: string; placeholder?: string; type?: "text" | "password" | "url"; /** Return false to keep the text (it wasn't accepted). */
  onSave: (value: string) => boolean | void; autoComplete?: string;
}) {
  const id = useId();
  return (
    <form className="settings-item settings-field" onSubmit={(e) => {
      e.preventDefault();
      const input = e.currentTarget.elements.namedItem("value") as HTMLInputElement;
      if (input.value.trim() && onSave(input.value.trim()) !== false) input.value = "";
    }}>
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <input id={id} name="value" className="text-field" type={type} autoComplete={autoComplete} spellCheck={false} placeholder={placeholder ?? label} />
      <button type="submit" className="pill pill-small">Save</button>
    </form>
  );
}

/** Small white glyphs for the hub's colored squares. */
const glyph = (d: string) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const glyphs = {
  play: glyph("M7 4.5v15l12.5-7.5z"),
  captions: glyph("M4 5h16v14H4zM7 13h4M13 13h4M7 16h7"),
  bolt: glyph("M13 2L4 14h7l-1 8 9-12h-7z"),
  antenna: glyph("M12 12v9M8.5 8.5a5 5 0 0 1 7 0M5.6 5.6a9 9 0 0 1 12.8 0M12 12h.01"),
  stack: glyph("M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"),
  folder: glyph("M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
  link: glyph("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  info: glyph("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5"),
};
