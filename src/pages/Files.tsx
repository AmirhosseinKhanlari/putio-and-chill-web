import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isFolder, isVideo, type PutioFile } from "../api/putio";
import { playPath } from "../components/Cards";
import { ConfirmDialog, NameDialog } from "../components/files/Dialog";
import { fileDetail, idsToForget, isFileSort, itemsLabel, sortFiles, summary, fileSorts, type FileSort } from "../components/files/fileLogic";
import { FolderPicker, type PickRequest } from "../components/files/FolderPicker";
import { FixMatchDialog } from "../components/FixMatch";
import { CopyIcon, DownloadIcon, FileIcon, FolderPlusIcon, MoveIcon, OpenIcon, PencilIcon, SortIcon } from "../components/files/icons";
import { Menu, placeAtPointer, placeUnder, type MenuItem, type MenuPlace } from "../components/files/Menu";
import { openOriginal, SelectionBar, StorageMeter, TrashLink } from "../components/files/parts";
import { ChevronRight, CloseIcon, FilmIcon, FolderIcon, MoreIcon, PlayIcon, SearchIcon, TrashIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { clock } from "../lib/format";
import { library } from "../lib/library";
import { folderRequest, videoRequest, type FixMatchRequest } from "../lib/matchOverrides";
import { readString, writeString } from "../lib/storage";
import { refreshLibrary, useToast } from "../state/hooks";
import { usePutio } from "../state/session";
import "../styles/files.css";

const SORT_KEY = "pc.files.sort.v1";
const FAILED = "put.io didn't accept that. Check your connection and try again.";

type Dialogs =
  | { kind: "rename"; file: PutioFile }
  | { kind: "new-folder" }
  | { kind: "delete"; files: PutioFile[] }
  | { kind: "pick"; request: PickRequest }
  | { kind: "fix-match"; request: FixMatchRequest };

/** Your whole put.io, like the iPhone app's Files: folders open, videos play, other files download, and anything can
 * be renamed, moved, copied or deleted (to put.io's Trash), one at a time or as a selection. */
export function Files() {
  const { folderID } = useParams();
  const parent = Number(folderID ?? 0);
  // A fresh page per folder: selection, search and menus don't follow you into another folder.
  return <Folder key={parent} parent={Number.isSafeInteger(parent) && parent > 0 ? parent : 0} />;
}

function Folder({ parent }: { parent: number }) {
  const putio = usePutio();
  const toast = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ["files", parent], queryFn: () => putio.list(parent) });
  const path = useQuery({ queryKey: ["files-path", parent], queryFn: () => putio.folderPath(parent), enabled: parent !== 0, staleTime: 5 * 60_000 });

  const [sort, setSortState] = useState<FileSort>(() => {
    const saved = readString(SORT_KEY);
    return isFileSort(saved) ? saved : "name";
  });
  const setSort = (next: FileSort) => { setSortState(next); writeString(SORT_KEY, next); };

  const [query, setQuery] = useState("");
  const typed = useDebounced(query.trim(), 300);
  const searching = typed.length > 1;
  const search = useQuery({ queryKey: ["files-search", typed], queryFn: () => putio.search(typed), enabled: searching });

  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [rowMenu, setRowMenu] = useState<{ file: PutioFile; place: MenuPlace } | null>(null);
  const [sortMenu, setSortMenu] = useState<MenuPlace | null>(null);
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [busy, setBusy] = useState(false);

  const files = searching ? sortFiles(search.data ?? [], "name") : sortFiles(list.data?.files ?? [], sort);
  const selected = files.filter((f) => selection.has(f.id));
  const name = parent === 0 ? "Files" : list.data?.parent?.name ?? path.data?.at(-1)?.name ?? "";
  const crumbs = parent === 0 ? [] : [{ id: 0, name: "Files" }, ...(path.data ?? []).slice(0, -1)];

  function endSelecting() {
    setSelecting(false);
    setSelection(new Set());
  }

  // Escape leaves select mode (dialogs and menus handle their own Escape first).
  useEffect(() => {
    if (!selecting || dialog || rowMenu || sortMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") endSelecting(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, dialog, rowMenu, sortMenu]);

  function toggle(id: number) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // MARK: Keeping the app in step with put.io

  /** Drops items from the folder on screen at once; the refetch that follows confirms it. */
  function removeFromView(ids: number[]) {
    const gone = new Set(ids);
    client.setQueryData<{ parent?: PutioFile; files: PutioFile[] }>(["files", parent], (old) => old && { ...old, files: old.files.filter((f) => !gone.has(f.id)) });
  }

  /** After a change: Home and Library drop deleted videos now, a library refresh picks up moves and renames, and every
   * folder, search, path, the trash and free space are read again. */
  function settle({ forget, refresh }: { forget?: number[]; refresh?: boolean }) {
    if (forget?.length) library.forget(idsToForget(forget, library.entries));
    if (refresh) void refreshLibrary(putio);
    return Promise.all(["files", "files-path", "files-search", "trash", "account"].map((key) => client.invalidateQueries({ queryKey: [key] })));
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch {
      toast(FAILED);
      void settle({});
    } finally {
      setBusy(false);
    }
  }

  const describe = (items: PutioFile[]) => (items.length === 1 ? `“${items[0].name}”` : itemsLabel(items.length));

  function remove(items: PutioFile[]) {
    const ids = items.map((f) => f.id);
    void run(async () => {
      await putio.deleteFiles(ids);
      removeFromView(ids);
      setDialog(null);
      endSelecting();
      toast(`Moved ${describe(items)} to put.io's Trash`);
      // Videos deeper inside a deleted folder leave the library with a refresh.
      await settle({ forget: ids, refresh: items.some(isFolder) });
    });
  }

  function transfer(request: PickRequest, folder: { id: number; name: string }) {
    void run(async () => {
      if (request.action === "move") {
        await putio.moveFiles(request.ids, folder.id);
        if (folder.id !== parent) removeFromView(request.ids);
      } else {
        // put.io copies one item per call; a failure part-way still refreshes what did get copied.
        let copied = 0;
        try {
          for (const id of request.ids) { await putio.copyFile(id, folder.id); copied++; }
        } catch (error) {
          if (copied > 0) toast(`Copied ${copied} of ${request.ids.length}, then put.io stopped. Check your connection and try again.`);
          await settle({ refresh: true });
          if (copied > 0) { setDialog(null); endSelecting(); return; }
          throw error;
        }
      }
      setDialog(null);
      endSelecting();
      toast(`${request.action === "move" ? "Moved" : "Copied"} ${request.label} to ${folder.id === 0 ? "your put.io" : folder.name}`);
      await settle({ refresh: true });
    });
  }

  function rename(file: PutioFile, newName: string) {
    void run(async () => {
      await putio.rename(file.id, newName);
      client.setQueryData<{ parent?: PutioFile; files: PutioFile[] }>(["files", parent], (old) => old && { ...old, files: old.files.map((f) => (f.id === file.id ? { ...f, name: newName } : f)) });
      setDialog(null);
      toast(`Renamed to “${newName}”`);
      await settle({ refresh: true });
    });
  }

  function createFolder(folderName: string) {
    void run(async () => {
      await putio.createFolder(folderName, parent);
      setDialog(null);
      toast(`Made “${folderName}”`);
      await client.invalidateQueries({ queryKey: ["files", parent] });
    });
  }

  function download(file: PutioFile) {
    openOriginal(putio, file.id).catch(() => toast("Couldn't get a link to this file from put.io."));
  }

  function pick(action: PickRequest["action"], items: PutioFile[]) {
    setDialog({
      kind: "pick",
      request: { action, ids: items.map((f) => f.id), sources: items.map((f) => f.parent_id ?? parent), label: describe(items) },
    });
  }

  // MARK: Menus

  function itemsFor(file: PutioFile): MenuItem[] {
    const items: MenuItem[] = [];
    if (isFolder(file)) items.push({ label: "Open", icon: <FolderIcon size={16} />, onSelect: () => navigate(`/files/${file.id}`) });
    if (isVideo(file)) items.push({ label: "Play", icon: <PlayIcon size={14} />, onSelect: () => navigate(playPath(file.id)) });
    if (!isFolder(file)) items.push({ label: isVideo(file) ? "Download Original" : "Download", icon: <DownloadIcon size={16} />, onSelect: () => download(file) });
    // Fix Match: a video alone (or its folder, or every file named like it), or everything in a folder.
    if (isVideo(file) || isFolder(file)) {
      const request = isFolder(file)
        ? folderRequest(file)
        : videoRequest({ id: file.id, name: file.name, parentID: file.parent_id ?? parent }, (file.parent_id ?? parent) === parent && parent !== 0 ? name : undefined);
      items.push({ label: "Fix Match…", icon: <FilmIcon size={16} />, onSelect: () => setDialog({ kind: "fix-match", request }) });
    }
    items.push(
      { label: "Rename…", icon: <PencilIcon size={16} />, onSelect: () => setDialog({ kind: "rename", file }) },
      { label: "Move to…", icon: <MoveIcon size={16} />, onSelect: () => pick("move", [file]) },
      { label: "Copy to…", icon: <CopyIcon size={16} />, onSelect: () => pick("copy", [file]) },
      { label: "Delete…", icon: <TrashIcon size={16} />, danger: true, onSelect: () => setDialog({ kind: "delete", files: [file] }) },
    );
    return items;
  }

  function openRowMenu(file: PutioFile, place: MenuPlace) {
    setSortMenu(null);
    setRowMenu((open) => (open?.file.id === file.id && open.place.trigger && open.place.trigger === place.trigger ? null : { file, place }));
  }

  const sortLabel = fileSorts.find((s) => s.value === sort)?.label ?? "Name";

  return (
    <div className={`page${selecting ? " files-selecting" : ""}`}>
      <TopBar back />
      <div className="page-body narrow files-body">
        <header className="stack-small files-head">
          {crumbs.length > 0 && (
            <nav aria-label="Folder path">
              <ol className="files-crumbs">
                {crumbs.map((c) => (
                  <li key={c.id}><Link className="files-crumb" to={c.id === 0 ? "/files" : `/files/${c.id}`}>{c.name}</Link></li>
                ))}
              </ol>
            </nav>
          )}
          <div className="eyebrow">PUT.IO</div>
          {/* Release names are long and unbroken: smaller, at most two lines, the whole name on hover. */}
          <h1 className={`files-title${name.length > 32 ? " files-title-long" : ""}`} title={name}>{name || "…"}</h1>
          {list.isSuccess && !searching && <div className="muted small">{summary(list.data.files)}</div>}
        </header>

        {parent === 0 && (
          <div className="files-root-tools">
            <StorageMeter />
            <TrashLink />
          </div>
        )}

        <div className="files-toolbar">
          <div className="files-search">
            <SearchIcon />
            <label className="visually-hidden" htmlFor="files-search">Search all of put.io</label>
            <input id="files-search" type="search" placeholder="Search all of put.io" value={query} autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); if (selecting) endSelecting(); }} />
            {query && <button type="button" className="files-search-clear" aria-label="Clear search" onClick={() => setQuery("")}><CloseIcon size={14} /></button>}
          </div>
          <div className="files-tools">
            <button type="button" className="pill pill-small" aria-haspopup="menu" aria-expanded={Boolean(sortMenu)} disabled={searching}
              aria-label={`Sort by ${sortLabel}`}
              onClick={(e) => { const button = e.currentTarget; setRowMenu(null); setSortMenu((open) => (open ? null : placeUnder(button))); }}>
              <SortIcon />{sortLabel}
            </button>
            <button type="button" className="pill pill-small" disabled={searching} onClick={() => setDialog({ kind: "new-folder" })}>
              <FolderPlusIcon />New Folder
            </button>
            <button type="button" className="pill pill-small" aria-pressed={selecting} disabled={searching || (!selecting && !files.length)}
              onClick={() => (selecting ? endSelecting() : setSelecting(true))}>
              {selecting ? "Done" : "Select"}
            </button>
          </div>
        </div>

        <section aria-label={searching ? `Search results for ${typed}` : "Files in this folder"} aria-busy={searching ? search.isFetching : list.isLoading}>
          {searching ? (
            <>
              {search.isLoading && <p className="muted">Searching…</p>}
              {search.isError && <p className="error-text">Couldn't search put.io right now.</p>}
              {search.isSuccess && !files.length && <p className="muted">Nothing in your put.io matches “{typed}”.</p>}
            </>
          ) : (
            <>
              {list.isLoading && <p className="muted">Reading put.io…</p>}
              {list.isError && <p className="error-text">Couldn't read this folder from put.io.</p>}
              {list.isSuccess && !files.length && <p className="muted">This folder is empty.</p>}
            </>
          )}
          <ul className="file-list files-list">
            {files.map((f) => (
              <Row key={f.id} file={f} selecting={selecting} selected={selection.has(f.id)} menuOpen={rowMenu?.file.id === f.id}
                onToggle={() => toggle(f.id)} onDownload={() => download(f)}
                onMenu={(place) => openRowMenu(f, place)} />
            ))}
          </ul>
        </section>
      </div>

      {selecting && (
        <SelectionBar count={selected.length} total={files.length} busy={busy}
          onSelectAll={() => setSelection(selected.length === files.length ? new Set() : new Set(files.map((f) => f.id)))}
          onDone={endSelecting}
          actions={[
            { label: "Move", icon: <MoveIcon />, onClick: () => pick("move", selected) },
            { label: "Copy", icon: <CopyIcon />, onClick: () => pick("copy", selected) },
            { label: "Delete", icon: <TrashIcon />, danger: true, onClick: () => setDialog({ kind: "delete", files: selected }) },
          ]} />
      )}

      {rowMenu && <Menu label={`Actions for ${rowMenu.file.name}`} items={itemsFor(rowMenu.file)} place={rowMenu.place} onClose={() => setRowMenu(null)} />}
      {sortMenu && (
        <Menu label="Sort by" place={sortMenu} onClose={() => setSortMenu(null)}
          items={fileSorts.map((s) => ({ label: s.label, checked: s.value === sort, onSelect: () => setSort(s.value) }))} />
      )}

      {dialog?.kind === "rename" && (
        <NameDialog title={`Rename “${dialog.file.name}”`} initial={dialog.file.name} folder={isFolder(dialog.file)} submit="Rename" busy={busy}
          onSubmit={(newName) => rename(dialog.file, newName)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "new-folder" && (
        <NameDialog title="New Folder" note={`In ${parent === 0 ? "your put.io" : name}.`} submit="Create" busy={busy}
          onSubmit={createFolder} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog busy={busy} confirm="Move to Trash" onConfirm={() => remove(dialog.files)} onClose={() => setDialog(null)}
          title={`Delete ${describe(dialog.files)}?`}
          message={dialog.files.length === 1
            ? "It stays in put.io's Trash until the trash is emptied, so you can still restore it."
            : "They stay in put.io's Trash until the trash is emptied, so you can still restore them."} />
      )}
      {dialog?.kind === "fix-match" && <FixMatchDialog request={dialog.request} onClose={() => setDialog(null)} />}
      {dialog?.kind === "pick" && (
        <FolderPicker putio={putio} request={dialog.request} busy={busy} onClose={() => setDialog(null)}
          onPick={(folder) => transfer(dialog.request, folder)} />
      )}
    </div>
  );
}

/** One file or folder. Folders open, videos play, other files download; ⋯ or a right-click shows everything else.
 * In select mode the whole row is its checkbox. */
function Row({ file, selecting, selected, menuOpen, onToggle, onDownload, onMenu }: {
  file: PutioFile;
  selecting: boolean;
  selected: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onMenu: (place: MenuPlace) => void;
}) {
  const icon = isFolder(file) ? <FolderIcon size={22} className="files-folder-icon" /> : isVideo(file) ? <FilmIcon size={22} /> : <FileIcon size={22} />;
  const body = <>{icon}<FileText file={file} /></>;
  return (
    <li className={`file-row files-row${selected ? " files-row-selected" : ""}`}
      onContextMenu={selecting ? undefined : (e) => { e.preventDefault(); onMenu(placeAtPointer(e)); }}>
      {selecting ? (
        <label className="file-main files-select">
          <input type="checkbox" className="files-check" checked={selected} onChange={onToggle} />
          {body}
        </label>
      ) : isFolder(file) ? (
        <Link to={`/files/${file.id}`} className="file-main">{body}<ChevronRight size={14} className="files-chevron" /></Link>
      ) : isVideo(file) ? (
        <Link to={playPath(file.id)} className="file-main">{body}</Link>
      ) : (
        <button type="button" className="file-main files-main-button" onClick={onDownload} aria-describedby={`dl-${file.id}`}>
          {body}<span id={`dl-${file.id}`} className="visually-hidden">Downloads the file</span><OpenIcon size={14} className="files-chevron" />
        </button>
      )}
      {!selecting && isVideo(file) && (
        <Link to={playPath(file.id)} className="round-button round-quiet files-play" aria-label={`Play ${file.name}`}><PlayIcon size={16} /></Link>
      )}
      {!selecting && (
        <button type="button" className="round-button round-quiet" aria-label={`More for ${file.name}`} aria-haspopup="menu" aria-expanded={menuOpen}
          onClick={(e) => onMenu(placeUnder(e.currentTarget))}>
          <MoreIcon />
        </button>
      )}
    </li>
  );
}

function FileText({ file }: { file: PutioFile }) {
  // The newest position known here wins over the list's (which put.io doesn't document).
  const position = library.position(file.id)?.seconds ?? file.start_from ?? 0;
  const watched = isVideo(file) && position >= 30 ? ` · ${clock(position)} watched` : "";
  return (
    <span className="file-text">
      <span className="file-name">{file.name}</span>
      <span className="muted small">{fileDetail(file)}{watched}</span>
    </span>
  );
}

/** The value once it has stopped changing for `ms` (search waits for a pause in typing). */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
