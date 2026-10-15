import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isFolder, isVideo, type PutioFile } from "../api/putio";
import { playPath } from "../components/Cards";
import { FilmIcon, FolderIcon, PlayIcon, TrashIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { bytes, clock } from "../lib/format";
import { library } from "../lib/library";
import { useAccount, useToast } from "../state/hooks";
import { usePutio } from "../state/session";

/** Your whole put.io: folders open, videos play, anything can be deleted (to put.io's Trash). */
export function Files() {
  const { folderID } = useParams();
  const parent = Number(folderID ?? 0);
  const putio = usePutio();
  const toast = useToast();
  const client = useQueryClient();
  const account = useAccount();
  const list = useQuery({ queryKey: ["files", parent], queryFn: () => putio.list(parent) });
  const [query, setQuery] = useState("");
  const search = useQuery({ queryKey: ["files-search", query], queryFn: () => putio.search(query), enabled: query.trim().length > 1 });
  const [confirming, setConfirming] = useState<PutioFile | null>(null);
  const files = query.trim().length > 1 ? search.data ?? [] : list.data?.files ?? [];
  const sorted = [...files].sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || a.name.localeCompare(b.name));

  async function remove(file: PutioFile) {
    setConfirming(null);
    try {
      await putio.deleteFiles([file.id]);
      library.forget([file.id]);
      toast(`Moved ${file.name} to put.io's Trash`);
      await Promise.all([client.invalidateQueries({ queryKey: ["files"] }), account.refetch()]);
    } catch {
      toast("Couldn't delete it right now.");
    }
  }

  return (
    <div className="page">
      <TopBar back />
      <div className="page-body narrow">
        <div className="stack-small">
          <div className="eyebrow">PUT.IO</div>
          <h1 className="display-small">{parent === 0 ? "Files" : list.data?.parent?.name ?? "Files"}</h1>
          <div className="muted small">{files.length} items · {bytes(files.reduce((sum, f) => sum + (f.size ?? 0), 0))}</div>
        </div>
        <label className="visually-hidden" htmlFor="files-search">Search all of put.io</label>
        <input id="files-search" className="text-field" type="search" placeholder="Search all of put.io" value={query} onChange={(e) => setQuery(e.target.value)} />
        {list.isLoading && <p className="muted">Loading…</p>}
        {list.isError && <p className="error-text">Couldn't read this folder.</p>}
        <ul className="file-list">
          {sorted.map((f) => (
            <li key={f.id} className="file-row">
              {isFolder(f) ? (
                <Link to={`/files/${f.id}`} className="file-main"><FolderIcon size={22} /><FileText file={f} /></Link>
              ) : isVideo(f) ? (
                <Link to={playPath(f.id)} className="file-main"><FilmIcon size={22} /><FileText file={f} /></Link>
              ) : (
                <div className="file-main"><span className="file-icon-blank" aria-hidden="true" /><FileText file={f} /></div>
              )}
              {isVideo(f) && <Link to={playPath(f.id)} className="round-button round-quiet" aria-label={`Play ${f.name}`}><PlayIcon size={16} /></Link>}
              <button type="button" className="round-button round-quiet" aria-label={`Delete ${f.name}`} onClick={() => setConfirming(f)}><TrashIcon /></button>
            </li>
          ))}
        </ul>
      </div>
      {confirming && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setConfirming(null)}>
          <div className="dialog dialog-small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title">Delete “{confirming.name}”?</h2>
            <p className="muted">It goes to put.io's Trash, where you can restore it for a while.</p>
            <div className="actions">
              <button type="button" className="pill pill-danger" onClick={() => void remove(confirming)}>Delete</button>
              <button type="button" className="pill" autoFocus onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FileText({ file }: { file: PutioFile }) {
  const watched = file.start_from && file.start_from >= 30 ? ` · ${clock(file.start_from)} watched` : "";
  return (
    <span className="file-text">
      <span className="file-name">{file.name}</span>
      <span className="muted small">{[bytes(file.size), file.created_at?.slice(0, 10)].filter(Boolean).join(" · ")}{watched}</span>
    </span>
  );
}
