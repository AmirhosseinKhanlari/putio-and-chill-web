/** put.io API v2 (port of the iPhone app's PutioClient). The token is sent as a header; only the HLS URL carries it
 * in the address, because the video element can't send headers. */
const BASE = "https://api.put.io/v2";

export interface PutioFile {
  id: number;
  name: string;
  file_type?: string;
  content_type?: string;
  size?: number;
  parent_id?: number;
  created_at?: string;
  updated_at?: string;
  start_from?: number;
  screenshot?: string;
  need_convert?: boolean;
  is_mp4_available?: boolean;
}

export interface PutioAccount {
  username: string;
  user_id?: number;
  mail?: string;
  disk?: { avail: number; size: number; used: number };
  trash_size?: number;
}

/** A deleted file waiting in put.io's Trash until it's emptied or expires. Dates are UTC without a zone. */
export interface PutioTrashFile {
  id: number;
  name: string;
  file_type?: string;
  size?: number;
  deleted_at?: string;
  expiration_date?: string;
}

export interface PutioTrash {
  files: PutioTrashFile[];
  trash_size?: number;
}

export interface PutioTransfer {
  id: number;
  name?: string;
  status?: string;
  percent_done?: number;
  down_speed?: number;
  peers_connected?: number;
  estimated_time?: number;
  size?: number;
  file_id?: number;
  save_parent_id?: number;
  error_message?: string;
  /** The torrent's info-hash. */
  hash?: string;
}

export interface PutioSubtitle {
  key: string;
  language?: string;
  language_code?: string;
  name?: string;
  source?: string;
}

export class PutioError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const isVideo = (file: PutioFile) =>
  file.file_type === "VIDEO" || /\.(mkv|mp4|m4v|avi|mov|wmv|ts|webm)$/i.test(file.name);
export const isFolder = (file: PutioFile) => file.file_type === "FOLDER";

export class PutioClient {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init?: { query?: Record<string, string>; form?: Record<string, string>; signal?: AbortSignal }): Promise<T> {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(init?.query ?? {})) url.searchParams.set(k, v);
    const response = await fetch(url, {
      method: init?.form ? "POST" : "GET",
      headers: { Authorization: `token ${this.token}`, ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: init?.form ? new URLSearchParams(init.form) : undefined,
      cache: "no-store",
      signal: init?.signal,
    });
    if (!response.ok) {
      let message = `put.io ${response.status}`;
      try { message = (await response.json()).error_message ?? message; } catch { /* not JSON */ }
      throw new PutioError(response.status, message);
    }
    return (await response.json()) as T;
  }

  async account(): Promise<PutioAccount> {
    return (await this.request<{ info: PutioAccount }>("account/info")).info;
  }

  async list(parentID: number): Promise<{ parent?: PutioFile; files: PutioFile[] }> {
    return this.request("files/list", { query: { parent_id: String(parentID), per_page: "1000" } });
  }

  async file(id: number): Promise<PutioFile> {
    return (await this.request<{ file: PutioFile }>(`files/${id}`, { query: { mp4_status: "1" } })).file;
  }

  async search(query: string): Promise<PutioFile[]> {
    return (await this.request<{ files: PutioFile[] }>("files/search", { query: { query, per_page: "200" } })).files;
  }

  async createFolder(name: string, parentID: number): Promise<PutioFile> {
    return (await this.request<{ file: PutioFile }>("files/create-folder", { form: { name, parent_id: String(parentID) } })).file;
  }

  async deleteFiles(ids: number[]): Promise<void> {
    await this.request("files/delete", { form: { file_ids: ids.join(",") } });
  }

  async rename(id: number, name: string): Promise<void> {
    await this.request("files/rename", { form: { file_id: String(id), name } });
  }

  /** Moves files or folders into `parentID`. */
  async moveFiles(ids: number[], parentID: number): Promise<void> {
    await this.request("files/move", { form: { file_ids: ids.join(","), parent_id: String(parentID) } });
  }

  /** Copies one file or folder into `parentID` (put.io copies one item per call); returns the copy. */
  async copyFile(id: number, parentID: number): Promise<PutioFile> {
    return (await this.request<{ file: PutioFile }>("files/copy", { form: { file_id: String(id), parent_id: String(parentID) } })).file;
  }

  /** A short-lived link to download the original file. */
  async originalURL(fileID: number): Promise<string> {
    return (await this.request<{ url: string }>(`files/${fileID}/url`)).url;
  }

  /** The folders from the top of put.io down to `folderID`, itself included (empty for the root). put.io has no
   * path endpoint, so this walks up one folder per request; stops after 32 levels. */
  async folderPath(folderID: number): Promise<PutioFile[]> {
    const path: PutioFile[] = [];
    let id = folderID;
    while (id !== 0 && path.length < 32) {
      const folder = (await this.request<{ file: PutioFile }>(`files/${id}`)).file;
      path.unshift(folder);
      id = folder.parent_id ?? 0;
    }
    return path;
  }

  // Trash: deleted files stay here until it's emptied or they expire.

  async trash(): Promise<PutioTrash> {
    return this.request("trash/list", { query: { per_page: "1000" } });
  }

  async restoreFromTrash(ids: number[]): Promise<void> {
    await this.request("trash/restore", { form: { file_ids: ids.join(",") } });
  }

  async deleteFromTrash(ids: number[]): Promise<void> {
    await this.request("trash/delete", { form: { file_ids: ids.join(",") } });
  }

  async emptyTrash(): Promise<void> {
    await this.request("trash/empty", { form: {} });
  }

  // Watch positions, through put.io's documented start-from endpoints (the native apps use the same ones).

  async getStartFrom(fileID: number, signal?: AbortSignal): Promise<number> {
    return (await this.request<{ start_from?: number }>(`files/${fileID}/start-from`, { signal })).start_from ?? 0;
  }

  async setStartFrom(fileID: number, seconds: number): Promise<void> {
    await this.request(`files/${fileID}/start-from`, { form: { time: String(Math.floor(seconds)) } });
  }

  /** Watched to the end: put.io forgets the position. */
  async resetStartFrom(fileID: number): Promise<void> {
    await this.request(`files/${fileID}/start-from/delete`, { form: {} });
  }

  async subtitles(fileID: number): Promise<PutioSubtitle[]> {
    return (await this.request<{ subtitles: PutioSubtitle[] }>(`files/${fileID}/subtitles`)).subtitles;
  }

  /** One subtitle track as WebVTT text, for the video element's <track>. */
  async subtitleVTT(fileID: number, key: string): Promise<string> {
    const response = await fetch(`${BASE}/files/${fileID}/subtitles/${encodeURIComponent(key)}?format=webvtt`, {
      headers: { Authorization: `token ${this.token}` },
    });
    if (!response.ok) throw new PutioError(response.status, "subtitle");
    return response.text();
  }

  async mp4Status(fileID: number): Promise<{ status: string; percent_done?: number }> {
    return (await this.request<{ mp4: { status: string; percent_done?: number } }>(`files/${fileID}/mp4`)).mp4;
  }

  async convertToMp4(fileID: number): Promise<void> {
    await this.request(`files/${fileID}/mp4`, { form: {} });
  }

  async transfers(): Promise<PutioTransfer[]> {
    return (await this.request<{ transfers: PutioTransfer[] }>("transfers/list")).transfers;
  }

  async addTransfer(url: string, saveParentID?: number): Promise<PutioTransfer> {
    const form: Record<string, string> = { url };
    if (saveParentID !== undefined) form.save_parent_id = String(saveParentID);
    return (await this.request<{ transfer: PutioTransfer }>("transfers/add", { form })).transfer;
  }

  async cancelTransfers(ids: number[]): Promise<void> {
    await this.request("transfers/cancel", { form: { transfer_ids: ids.join(",") } });
  }

  async cleanTransfers(ids: number[]): Promise<void> {
    await this.request("transfers/clean", { form: { transfer_ids: ids.join(",") } });
  }

  /** The adaptive stream; put.io converts on the fly, so every video plays in the browser. */
  hlsURL(fileID: number): string {
    return `${BASE}/files/${fileID}/hls/media.m3u8?oauth_token=${encodeURIComponent(this.token)}`;
  }

  /** Makes sure "A/B/C" exists from the root and returns the last folder's id. */
  async ensurePath(path: string[]): Promise<number> {
    let parent = 0;
    for (const name of path) {
      const { files } = await this.list(parent);
      const existing = files.find((f) => isFolder(f) && f.name === name);
      parent = existing ? existing.id : (await this.createFolder(name, parent)).id;
    }
    return parent;
  }
}

// Sign-in with a short code entered at put.io/link: works from any website, no redirect address needed.
export async function requestDeviceCode(appID: string): Promise<{ code: string; qr_code_url?: string }> {
  const response = await fetch(`${BASE}/oauth2/oob/code?app_id=${encodeURIComponent(appID)}`);
  if (!response.ok) throw new PutioError(response.status, "Couldn't get a sign-in code from put.io.");
  return response.json();
}

export async function pollDeviceCode(code: string): Promise<string | null> {
  const response = await fetch(`${BASE}/oauth2/oob/code/${encodeURIComponent(code)}`);
  if (!response.ok) throw new PutioError(response.status, "put.io sign-in failed.");
  const body = (await response.json()) as { oauth_token?: string | null };
  return body.oauth_token || null;
}
