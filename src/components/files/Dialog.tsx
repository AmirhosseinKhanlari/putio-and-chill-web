import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { cleanName, renameSelection } from "./fileLogic";

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal on the app's dialog styles: Escape and the backdrop close it, Tab stays inside, and focus goes back to
 * whatever opened it. */
export function Dialog({ title, onClose, children, alert = false, wide = false, busy = false }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Asks to confirm something (read out as an alert). */
  alert?: boolean;
  wide?: boolean;
  /** Ignores Escape and the backdrop while put.io is working. */
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleID = useId();
  const close = useRef(onClose);
  close.current = busy ? () => {} : onClose;
  // Read during the first render: by the time effects run, an autoFocus child already has focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const box = ref.current;
    // Start at the control marked data-autofocus (or the dialog itself) unless a child already took focus.
    if (box && !box.contains(document.activeElement)) (box.querySelector<HTMLElement>("[data-autofocus]") ?? box).focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [opener]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close.current();
    } else if (event.key === "Tab" && ref.current) {
      const items = [...ref.current.querySelectorAll<HTMLElement>(focusable)];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close.current(); }}>
      <div ref={ref} className={`dialog ${wide ? "files-dialog-wide" : "dialog-small"}`} role={alert ? "alertdialog" : "dialog"} aria-modal="true"
        aria-labelledby={titleID} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleID} className="files-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** "Delete 3 items?" with the destructive choice in red and Cancel focused, so Enter never destroys by accident. */
export function ConfirmDialog({ title, message, confirm, onConfirm, onClose, busy = false }: {
  title: string;
  message: ReactNode;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog title={title} onClose={onClose} alert busy={busy}>
      <p className="muted files-dialog-text">{message}</p>
      <div className="actions">
        <button type="button" className="pill pill-danger" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirm}</button>
        <button type="button" className="pill" data-autofocus disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

/** Asks for a name (Rename, New Folder). The name, minus its extension, starts selected. */
export function NameDialog({ title, note, initial = "", folder = true, submit, onSubmit, onClose, busy = false }: {
  title: string;
  note?: string;
  initial?: string;
  folder?: boolean;
  submit: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const fieldID = useId();

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(...renameSelection(initial, folder));
  }, [initial, folder]);

  function send(event: FormEvent) {
    event.preventDefault();
    const clean = cleanName(name, initial);
    if (clean) onSubmit(clean);
    else onClose();
  }

  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      {note && <p className="muted files-dialog-text">{note}</p>}
      <form className="stack-small" onSubmit={send}>
        <label htmlFor={fieldID} className="visually-hidden">Name</label>
        <input ref={input} id={fieldID} className="text-field" value={name} onChange={(e) => setName(e.target.value)}
          autoComplete="off" spellCheck={false} placeholder="Name" />
        <div className="actions">
          <button type="submit" className="pill pill-primary" disabled={busy || !name.trim()}>{busy ? "Working…" : submit}</button>
          <button type="button" className="pill" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
