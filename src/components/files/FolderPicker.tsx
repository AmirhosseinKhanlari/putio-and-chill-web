import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { isFolder, type PutioClient } from "../../api/putio";
import { ChevronRight, FolderIcon } from "../Icons";
import { Dialog } from "./Dialog";
import { canDropInto, cleanName, sortFiles, type Transfer } from "./fileLogic";
import { FolderPlusIcon } from "./icons";

export interface PickRequest {
  action: Transfer;
  ids: number[];
  /** The folders they're in now (a move there would do nothing). */
  sources: number[];
  /** What the title calls them: a name for one item, "3 items" for more. */
  label: string;
}

interface Level { id: number; name: string }

const root: Level = { id: 0, name: "Your put.io" };

/** Where to move or copy: browse put.io's folders (breadcrumbs go back up), make a new one, then Move Here or Copy
 * Here. Like the iPhone app, it starts at the top of put.io. */
export function FolderPicker({ putio, request, onPick, onClose, busy = false }: {
  putio: PutioClient;
  request: PickRequest;
  onPick: (folder: Level) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const client = useQueryClient();
  const [trail, setTrail] = useState<Level[]>([root]);
  const here = trail[trail.length - 1];
  // Shares the file manager's cache: folders already open there show at once.
  const list = useQuery({ queryKey: ["files", here.id], queryFn: () => putio.list(here.id) });
  const folders = sortFiles((list.data?.files ?? []).filter(isFolder), "name");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldID = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const verb = request.action === "move" ? "Move" : "Copy";
  const canPick = canDropInto(request.action, here.id, request.ids, request.sources);

  function open(level: Level, depth?: number) {
    setTrail((t) => (depth === undefined ? [...t, level] : t.slice(0, depth + 1)));
    setNaming(false);
    setError(null);
    // Keyboard users land on the new level's first folder.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus());
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const clean = cleanName(name);
    if (!clean) return;
    setCreating(true);
    setError(null);
    try {
      const folder = await putio.createFolder(clean, here.id);
      await client.invalidateQueries({ queryKey: ["files", here.id] });
      setName("");
      open({ id: folder.id, name: folder.name });
    } catch {
      setError("put.io didn't make the folder. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog title={`${verb} ${request.label}`} onClose={onClose} wide busy={busy}>
      <nav aria-label="Folder path">
        <ol className="files-crumbs">
          {trail.map((level, depth) => (
            <li key={level.id}>
              {depth < trail.length - 1
                ? <button type="button" className="files-crumb" onClick={() => open(level, depth)}>{level.name}</button>
                : <span className="files-crumb files-crumb-here" aria-current="location">{level.name}</span>}
            </li>
          ))}
        </ol>
      </nav>

      <div className="files-picker" aria-busy={list.isLoading}>
        {list.isLoading && <p className="muted small files-picker-note">Reading put.io…</p>}
        {list.isError && <p className="error-text small files-picker-note">Couldn't read this folder from put.io.</p>}
        {list.isSuccess && !folders.length && <p className="muted small files-picker-note">No folders here.</p>}
        <ul ref={listRef} className="files-picker-list">
          {folders.map((f) => {
            // A folder can't go inside itself.
            const moving = request.ids.includes(f.id);
            return (
              <li key={f.id}>
                <button type="button" className="files-picker-row" disabled={moving || busy} onClick={() => open({ id: f.id, name: f.name })}>
                  <FolderIcon size={20} />
                  <span className="files-picker-name">{f.name}</span>
                  {moving ? <span className="muted small">Being {request.action === "move" ? "moved" : "copied"}</span> : <ChevronRight size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {naming ? (
        <form className="files-picker-new" onSubmit={(e) => void create(e)}>
          <label htmlFor={fieldID} className="visually-hidden">New folder name</label>
          <input id={fieldID} className="text-field" autoFocus autoComplete="off" placeholder={`New folder in ${here.name}`}
            value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setNaming(false); } }} />
          <button type="submit" className="pill pill-small" disabled={creating || !name.trim()}>{creating ? "Creating…" : "Create"}</button>
        </form>
      ) : null}
      {error && <p className="error-text small" role="alert">{error}</p>}

      <div className="files-picker-foot">
        <button type="button" className="pill pill-small" aria-expanded={naming} disabled={busy} onClick={() => { setNaming(!naming); setError(null); }}>
          <FolderPlusIcon />New Folder
        </button>
        <span className="files-spacer" />
        <button type="button" className="pill pill-small" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="pill pill-small pill-primary" disabled={!canPick || busy || !list.isSuccess} onClick={() => onPick(here)}>
          {busy ? "Working…" : `${verb} Here`}
        </button>
      </div>
    </Dialog>
  );
}
