import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PutioTrashFile } from "../api/putio";
import { ConfirmDialog } from "../components/files/Dialog";
import { itemsLabel, sortTrash, trashDetail } from "../components/files/fileLogic";
import { FileIcon, RestoreIcon } from "../components/files/icons";
import { Menu, placeAtPointer, placeUnder, type MenuPlace } from "../components/files/Menu";
import { SelectionBar } from "../components/files/parts";
import { FilmIcon, FolderIcon, MoreIcon, TrashIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { bytes } from "../lib/format";
import { refreshLibrary, useToast } from "../state/hooks";
import { usePutio } from "../state/session";
import "../styles/files.css";

const FAILED = "put.io didn't accept that. Check your connection and try again.";

type Confirming = { kind: "forever"; files: PutioTrashFile[] } | { kind: "empty" };

/** put.io's Trash: deleted files wait here until put.io removes them for good. Restore them, delete them for good,
 * or empty the trash to free the space now. */
export function Trash() {
  const putio = usePutio();
  const toast = useToast();
  const client = useQueryClient();
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => putio.trash() });
  const files = sortTrash(trash.data?.files ?? []);
  const size = trash.data?.trash_size ?? files.reduce((sum, f) => sum + (f.size ?? 0), 0);

  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ file: PutioTrashFile; place: MenuPlace } | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = files.filter((f) => selection.has(f.id));

  function endSelecting() {
    setSelecting(false);
    setSelection(new Set());
  }

  useEffect(() => {
    if (!selecting || confirming || menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") endSelecting(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, confirming, menu]);

  function toggle(id: number) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const describe = (items: PutioTrashFile[]) => (items.length === 1 ? `“${items[0].name}”` : itemsLabel(items.length));

  /** Takes them off the list at once; the refetch that follows confirms it. */
  function removeFromView(ids: number[] | "all") {
    client.setQueryData<{ files: PutioTrashFile[]; trash_size?: number }>(["trash"], (old) => {
      if (!old) return old;
      const left = ids === "all" ? [] : old.files.filter((f) => !ids.includes(f.id));
      return { files: left, trash_size: left.reduce((sum, f) => sum + (f.size ?? 0), 0) };
    });
  }

  async function run(work: () => Promise<void>, restored = false) {
    setBusy(true);
    try {
      await work();
      setConfirming(null);
      endSelecting();
    } catch {
      toast(FAILED);
    } finally {
      setBusy(false);
      // Restored videos come back to the library; free space and trash size change either way.
      if (restored) void refreshLibrary(putio);
      void Promise.all(["trash", "account", ...(restored ? ["files", "files-search"] : [])].map((key) => client.invalidateQueries({ queryKey: [key] })));
    }
  }

  function restore(items: PutioTrashFile[]) {
    const ids = items.map((f) => f.id);
    void run(async () => {
      await putio.restoreFromTrash(ids);
      removeFromView(ids);
      toast(`Restored ${describe(items)}`);
    }, true);
  }

  function deleteForever(items: PutioTrashFile[]) {
    const ids = items.map((f) => f.id);
    void run(async () => {
      await putio.deleteFromTrash(ids);
      removeFromView(ids);
      toast(`Deleted ${describe(items)} for good`);
    });
  }

  function empty() {
    void run(async () => {
      await putio.emptyTrash();
      removeFromView("all");
      toast("Trash emptied");
    });
  }

  function openMenu(file: PutioTrashFile, place: MenuPlace) {
    setMenu((open) => (open?.file.id === file.id && open.place.trigger && open.place.trigger === place.trigger ? null : { file, place }));
  }

  return (
    <div className={`page${selecting ? " files-selecting" : ""}`}>
      <TopBar back />
      <div className="page-body narrow files-body">
        <header className="stack-small files-head">
          <div className="eyebrow">PUT.IO</div>
          <h1 className="files-title">Trash</h1>
          {trash.isSuccess && <div className="muted small">{files.length ? `${itemsLabel(files.length)} · ${bytes(size)}` : "Empty"}</div>}
          <p className="muted small files-note">Deleted files wait here before put.io removes them for good. Empty the trash to free the space now.</p>
        </header>

        {files.length > 0 && (
          <div className="files-tools">
            <button type="button" className="pill pill-small pill-danger" disabled={busy} onClick={() => setConfirming({ kind: "empty" })}>
              <TrashIcon />Empty Trash
            </button>
            <button type="button" className="pill pill-small" aria-pressed={selecting} onClick={() => (selecting ? endSelecting() : setSelecting(true))}>
              {selecting ? "Done" : "Select"}
            </button>
          </div>
        )}

        <section aria-label="Deleted files" aria-busy={trash.isLoading}>
          {trash.isLoading && <p className="muted">Reading put.io's Trash…</p>}
          {trash.isError && <p className="error-text">Couldn't read the trash from put.io.</p>}
          {trash.isSuccess && !files.length && <p className="muted">Nothing in the trash.</p>}
          <ul className="file-list files-list">
            {files.map((f) => {
              const icon = f.file_type === "FOLDER" ? <FolderIcon size={22} className="files-folder-icon" /> : f.file_type === "VIDEO" ? <FilmIcon size={22} /> : <FileIcon size={22} />;
              const text = (
                <span className="file-text">
                  <span className="file-name">{f.name}</span>
                  <span className="muted small">{trashDetail(f)}</span>
                </span>
              );
              const isSelected = selection.has(f.id);
              return (
                <li key={f.id} className={`file-row files-row${isSelected ? " files-row-selected" : ""}`}
                  onContextMenu={selecting ? undefined : (e) => { e.preventDefault(); openMenu(f, placeAtPointer(e)); }}>
                  {selecting ? (
                    <label className="file-main files-select">
                      <input type="checkbox" className="files-check" checked={isSelected} onChange={() => toggle(f.id)} />
                      {icon}{text}
                    </label>
                  ) : (
                    <div className="file-main">{icon}{text}</div>
                  )}
                  {!selecting && (
                    <>
                      <button type="button" className="pill pill-small files-restore" disabled={busy} onClick={() => restore([f])} aria-label={`Restore ${f.name}`}>
                        <RestoreIcon size={16} /><span className="files-bar-label">Restore</span>
                      </button>
                      <button type="button" className="round-button round-quiet" aria-label={`More for ${f.name}`} aria-haspopup="menu" aria-expanded={menu?.file.id === f.id}
                        onClick={(e) => openMenu(f, placeUnder(e.currentTarget))}>
                        <MoreIcon />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {selecting && (
        <SelectionBar count={selected.length} total={files.length} busy={busy}
          onSelectAll={() => setSelection(selected.length === files.length ? new Set() : new Set(files.map((f) => f.id)))}
          onDone={endSelecting}
          actions={[
            { label: "Restore", icon: <RestoreIcon />, onClick: () => restore(selected) },
            { label: "Delete Forever", icon: <TrashIcon />, danger: true, onClick: () => setConfirming({ kind: "forever", files: selected }) },
          ]} />
      )}

      {menu && (
        <Menu label={`Actions for ${menu.file.name}`} place={menu.place} onClose={() => setMenu(null)}
          items={[
            { label: "Restore", icon: <RestoreIcon size={16} />, onSelect: () => restore([menu.file]) },
            { label: "Delete Forever…", icon: <TrashIcon size={16} />, danger: true, onSelect: () => setConfirming({ kind: "forever", files: [menu.file] }) },
          ]} />
      )}

      {confirming?.kind === "forever" && (
        <ConfirmDialog busy={busy} confirm="Delete Forever" onConfirm={() => deleteForever(confirming.files)} onClose={() => setConfirming(null)}
          title={`Delete ${describe(confirming.files)} forever?`} message="This can't be undone." />
      )}
      {confirming?.kind === "empty" && (
        <ConfirmDialog busy={busy} confirm="Empty Trash" onConfirm={empty} onClose={() => setConfirming(null)}
          title="Empty the trash?" message={`Everything in it is deleted for good (${bytes(size)}). This can't be undone.`} />
      )}
    </div>
  );
}
