/** Browse put.io's folders and pick one for movies or shows (the iPhone app's PutioFolderPicker). The picked folder
 * is kept by id, so renaming or moving it in put.io doesn't break Get & Watch. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { isFolder, type PutioFile } from "../../api/putio";
import type { PutioFolderRef } from "../../lib/settings";
import { useSession } from "../../state/session";
import { FolderIcon } from "../Icons";
import { Group } from "./Controls";

export function FolderPicker({ title, defaultPath, selection, onPick, onDone }: {
  title: string; defaultPath: string; selection: PutioFolderRef | null; onPick: (folder: PutioFolderRef | null) => void; onDone: () => void;
}) {
  const { putio } = useSession();
  const queryClient = useQueryClient();
  /** The folders opened so far, from the root down. */
  const [trail, setTrail] = useState<{ id: number; name: string }[]>([]);
  const [newName, setNewName] = useState("");
  const [problem, setProblem] = useState<string>();
  const newID = useId();
  const current = trail.at(-1)?.id ?? 0;
  const path = trail.map((t) => t.name).join("/");

  const folders = useQuery({
    queryKey: ["putio-folders", current],
    queryFn: async () => (await putio!.list(current)).files.filter(isFolder).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    enabled: Boolean(putio),
    staleTime: 30_000,
  });

  const pick = (folder: PutioFolderRef | null) => { onPick(folder); onDone(); };

  async function create() {
    const name = newName.trim().replace(/\//g, "-");
    if (!name || !putio) return;
    setProblem(undefined);
    try {
      const folder = await putio.createFolder(name, current);
      queryClient.setQueryData<PutioFile[]>(["putio-folders", current], (list) => [...(list ?? []), folder].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      setNewName("");
    } catch {
      setProblem("put.io couldn't create that folder.");
    }
  }

  return (
    <div className="stack">
      <div className="settings-picker-head">
        <button type="button" className="pill pill-small" onClick={onDone}>Cancel</button>
        <h2 className="settings-picker-title">{title}</h2>
      </div>

      <Group footer="At the top of your put.io; Putio & Chill creates it if it isn't there. Or pick any folder below.">
        <button type="button" className="settings-item settings-choice" aria-pressed={selection === null} onClick={() => pick(null)}>
          <span className="settings-text"><span className="strong">Default</span><span className="muted small">{defaultPath}</span></span>
          {selection === null && <span className="settings-check" aria-hidden="true">✓</span>}
        </button>
      </Group>

      <nav aria-label="Folder path" className="settings-breadcrumbs">
        <button type="button" className="link-button" onClick={() => setTrail([])} aria-current={trail.length === 0 ? "page" : undefined}>Your put.io</button>
        {trail.map((t, i) => (
          <span key={t.id}> / <button type="button" className="link-button" onClick={() => setTrail(trail.slice(0, i + 1))} aria-current={i === trail.length - 1 ? "page" : undefined}>{t.name}</button></span>
        ))}
      </nav>

      <Group>
        {folders.isLoading && <div className="settings-item muted">Loading…</div>}
        {folders.isError && <div className="settings-item error-text">Couldn't load folders from put.io.</div>}
        {folders.data && !folders.data.length && <div className="settings-item muted">No folders here.</div>}
        {folders.data?.map((f) => (
          <button key={f.id} type="button" className="settings-item settings-choice" onClick={() => setTrail([...trail, { id: f.id, name: f.name }])}>
            <span className="settings-folder"><FolderIcon size={18} />{f.name}</span>
            {selection?.id === f.id && <span className="settings-check" aria-label="Picked">✓</span>}
          </button>
        ))}
      </Group>

      <form className="settings-field-row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <label className="visually-hidden" htmlFor={newID}>New folder name</label>
        <input id={newID} className="text-field" placeholder={`New folder in ${path || "your put.io"}`} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="pill pill-small" disabled={!newName.trim()}>Create</button>
      </form>
      {problem && <p className="error-text small">{problem}</p>}

      {trail.length > 0 && (
        <button type="button" className="pill pill-primary settings-use" onClick={() => pick({ id: current, path })}>
          Use “{trail.at(-1)!.name}”
        </button>
      )}
    </div>
  );
}
