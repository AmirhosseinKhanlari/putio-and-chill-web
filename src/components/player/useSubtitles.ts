/** Every subtitle option for one video in one place (the iPhone app's SubtitleFinder): put.io's tracks plus an
 * OpenSubtitles search. A pick is remembered per file with its timing; otherwise put.io's track in the preferred
 * language from Settings is shown at the start. */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { download, findSubtitles, OpenSubtitlesError, openSubtitlesCode, type SubtitleResult } from "../../api/opensubtitles";
import type { PutioClient, PutioSubtitle } from "../../api/putio";
import type { LibraryEntry } from "../../lib/library";
import { parseReleaseName } from "../../lib/releaseName";
import type { AppSettings } from "../../lib/settings";
import { bestTrack, cachedSubtitle, cacheSubtitle, type Cue, groupTracks, parseSubtitles, savedChoice, saveChoice, type SubtitleChoice, toWebVTT } from "./subtitles";

interface Options {
  fileID: number;
  fileName?: string;
  entry?: LibraryEntry;
  putio: PutioClient;
  settings: AppSettings;
  /** The menu is open: search OpenSubtitles then, not on every play. */
  searching: boolean;
}

export function useSubtitles({ fileID, fileName, entry, putio, settings, searching }: Options) {
  const tracks = useQuery({ queryKey: ["subtitles", fileID], queryFn: () => putio.subtitles(fileID), staleTime: 60 * 60_000 });
  const [choice, setChoice] = useState<SubtitleChoice | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | undefined>();
  const [language, setLanguage] = useState(() => openSubtitlesCode(settings.subtitleLanguage));
  const putioTexts = useRef(new Map<string, string>());
  /** The user picked something: what's restored at the start no longer applies. */
  const touched = useRef(false);
  const groups = useMemo(() => groupTracks(tracks.data ?? []), [tracks.data]);
  const putioChoice = useCallback((track: PutioSubtitle): SubtitleChoice => {
    const row = groups.flatMap((g) => g.rows).find((r) => r.track.key === track.key);
    return {
      source: "putio", key: track.key, language: track.language_code ?? track.language ?? "", offset: 0,
      label: row ? [row.title, row.detail].filter(Boolean).join(" · ") : track.name ?? "put.io subtitle",
    };
  }, [groups]);

  const putioText = useCallback(async (key: string) => {
    const known = putioTexts.current.get(key);
    if (known) return known;
    const text = await putio.subtitleVTT(fileID, key);
    putioTexts.current.set(key, text);
    return text;
  }, [fileID, putio]);

  const show = useCallback((text: string, picked: SubtitleChoice): boolean => {
    const parsed = parseSubtitles(text);
    if (!parsed.length) return false;
    setCues(parsed);
    setChoice(picked);
    return true;
  }, []);

  // At the start: last time's pick for this file, else the preferred language (not saved, so changing it in
  // Settings later still applies here).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || tracks.isPending) return;
    restored.current = true;
    const list = tracks.data ?? [];
    const saved = savedChoice(fileID);
    const restore = (text: string, picked: SubtitleChoice) => !touched.current && show(text, picked);
    const apply = async () => {
      if (saved?.source === "off") { setChoice(saved); return; }
      if (saved?.source === "putio" && list.some((t) => t.key === saved.key)) {
        restore(await putioText(saved.key), saved);
        return;
      }
      if (saved?.source === "opensubtitles") {
        const text = cachedSubtitle(saved.fileID);
        if (text && restore(text, saved)) return;
      }
      const preferred = settings.subtitleLanguage ? bestTrack(list, settings.subtitleLanguage) : undefined;
      if (preferred) restore(await putioText(preferred.key), putioChoice(preferred));
    };
    apply().catch(() => { /* No subtitles is fine; the menu still lists them. */ });
  }, [tracks.isPending, tracks.data, fileID, settings.subtitleLanguage, putioText, show, putioChoice]);

  const choosePutio = useCallback(async (track: PutioSubtitle) => {
    if (loading) return;
    touched.current = true;
    setLoading(`putio:${track.key}`);
    setMessage(null);
    try {
      const keepOffset = choice?.source === "putio" && choice.key === track.key ? choice.offset : 0;
      const picked = { ...putioChoice(track), offset: keepOffset };
      if (!show(await putioText(track.key), picked)) throw new Error("empty");
      saveChoice(fileID, picked);
      return true;
    } catch {
      setMessage("Couldn't load that subtitle from put.io.");
      return false;
    } finally {
      setLoading(null);
    }
  }, [loading, choice, show, putioText, fileID, putioChoice]);

  const apiKey = settings.openSubtitlesKey?.trim() || null;
  const parsedName = useMemo(() => (fileName ? parseReleaseName(fileName) : undefined), [fileName]);
  const match = entry?.match;
  const video = {
    tmdbID: match?.tmdbID,
    kind: match?.kind ?? (parsedName?.season !== undefined ? "tv" as const : "movie" as const),
    season: match?.season ?? parsedName?.season,
    episode: match?.episode ?? parsedName?.episode,
    title: parsedName?.title || match?.title,
  };
  const results = useQuery({
    queryKey: ["opensubtitles", video.tmdbID, video.kind, video.season, video.episode, video.title, language, Boolean(apiKey)],
    queryFn: () => findSubtitles(apiKey!, { ...video, language }),
    enabled: searching && Boolean(apiKey),
    staleTime: 30 * 60_000,
    retry: (count, error) => !(error instanceof OpenSubtitlesError && error.problem === "key") && count < 1,
  });

  const chooseOpenSubtitles = useCallback(async (result: SubtitleResult) => {
    if (loading || !apiKey) return false;
    touched.current = true;
    setLoading(`os:${result.fileID}`);
    setMessage(null);
    try {
      let text = cachedSubtitle(result.fileID);
      if (!text) {
        const downloaded = await download(apiKey, result.fileID);
        text = downloaded.text;
        setRemaining(downloaded.remaining);
        cacheSubtitle(result.fileID, text);
      }
      const picked: SubtitleChoice = { source: "opensubtitles", fileID: result.fileID, label: result.release, language: result.language, offset: 0 };
      if (!show(text, picked)) {
        setMessage("That subtitle file couldn't be read. Try another one.");
        return false;
      }
      saveChoice(fileID, picked);
      return true;
    } catch (error) {
      setMessage(error instanceof OpenSubtitlesError ? error.message : "Couldn't download that subtitle. Try again or pick another.");
      return false;
    } finally {
      setLoading(null);
    }
  }, [loading, apiKey, show, fileID]);

  const turnOff = useCallback(() => {
    touched.current = true;
    const off: SubtitleChoice = { source: "off" };
    setChoice(off);
    setCues(null);
    setMessage(null);
    saveChoice(fileID, off);
  }, [fileID]);

  /** Positive shows subtitles later. */
  const shiftTiming = useCallback((delta: number) => {
    if (!choice || choice.source === "off") return;
    const next = { ...choice, offset: Math.round((choice.offset + delta) * 10) / 10 };
    setChoice(next);
    saveChoice(fileID, next);
  }, [choice, fileID]);

  // The <track>'s file: the cues as WebVTT with the timing shift applied.
  const offset = choice && choice.source !== "off" ? choice.offset : 0;
  const [trackURL, setTrackURL] = useState<string | null>(null);
  useEffect(() => {
    if (!cues) { setTrackURL(null); return; }
    const url = URL.createObjectURL(new Blob([toWebVTT(cues, offset)], { type: "text/vtt" }));
    setTrackURL(url);
    return () => URL.revokeObjectURL(url);
  }, [cues, offset]);

  return {
    tracks, groups, choice, showing: Boolean(cues && choice && choice.source !== "off"), trackURL, loading, message,
    choosePutio, chooseOpenSubtitles, turnOff, shiftTiming,
    openSubtitles: { enabled: Boolean(apiKey), results, language, setLanguage, remaining },
  };
}

export type Subtitles = ReturnType<typeof useSubtitles>;
