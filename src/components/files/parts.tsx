import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PutioClient } from "../../api/putio";
import { bytes } from "../../lib/format";
import { useAccount } from "../../state/hooks";
import { ChevronRight, TrashIcon } from "../Icons";

/** put.io's space, as on the Library page; red when nearly full. */
export function StorageMeter() {
  const account = useAccount().data;
  const disk = account?.disk;
  if (!disk || disk.size <= 0) return null;
  const used = Math.min(1, disk.used / disk.size);
  return (
    <div className="files-storage">
      <div className="meter" role="img" aria-label={`${Math.round(used * 100)}% of put.io storage used`}>
        <div className={`meter-fill${used > 0.9 ? " files-meter-full" : ""}`} style={{ width: `${used * 100}%` }} />
      </div>
      <div className="small muted">
        put.io: {bytes(disk.used)} of {bytes(disk.size)} used · {bytes(disk.avail)} free{account?.trash_size ? ` · ${bytes(account.trash_size)} in Trash` : ""}
      </div>
    </div>
  );
}

/** The way into put.io's Trash, with how much it holds. */
export function TrashLink() {
  const size = useAccount().data?.trash_size ?? 0;
  return (
    <Link to="/trash" className="files-trash-link" aria-label={size > 0 ? `Trash, ${bytes(size)}` : "Trash"}>
      <TrashIcon />
      <span className="strong">Trash</span>
      <span className="files-spacer" />
      {size > 0 && <span className="small muted">{bytes(size)}</span>}
      <ChevronRight size={14} />
    </Link>
  );
}

export interface BarAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/** The floating bar in select mode: how many are picked and what to do with them. */
export function SelectionBar({ count, total, actions, onSelectAll, onDone, busy }: {
  count: number;
  total: number;
  actions: BarAction[];
  onSelectAll: () => void;
  onDone: () => void;
  busy: boolean;
}) {
  return (
    <div className="files-bar" role="toolbar" aria-label="Selected items">
      <span className="files-bar-count" aria-live="polite">{count ? `${count} selected` : "Select items"}</span>
      <button type="button" className="files-bar-text" onClick={onSelectAll} disabled={busy || !total}>
        {count === total && total > 0 ? "Select None" : "Select All"}
      </button>
      {actions.map((a) => (
        <button key={a.label} type="button" className={`files-bar-button${a.danger ? " files-danger" : ""}`} disabled={busy || !count}
          aria-label={count ? `${a.label} ${count} selected` : a.label} title={a.label} onClick={a.onClick}>
          {a.icon}<span className="files-bar-label">{a.label}</span>
        </button>
      ))}
      <button type="button" className="files-bar-text strong" onClick={onDone}>Done</button>
    </div>
  );
}

/** Opens the original file. The tab opens during the click (browsers block pop-ups opened later), then goes to
 * put.io's short-lived link once it arrives: downloads start there, files a browser can show open there. */
export async function openOriginal(putio: PutioClient, fileID: number): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const url = await putio.originalURL(fileID);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
