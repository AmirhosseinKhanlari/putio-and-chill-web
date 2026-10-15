/** Subtitles drawn over the picture in the user's style (the iPhone app's SubtitleOverlayView). The <track> stays
 * "hidden" so the browser keeps timing the cues; this draws them, sized to the picture and clear of the controls. */
import { type RefObject, useEffect, useState } from "react";
import type { SubtitleStyle } from "../../lib/settings";
import { decodeCueText } from "./subtitles";
import "../../styles/player.css";

/** Where the picture sits inside the player (object-fit: contain leaves bars above and below). */
export interface VideoFrame {
  width: number;
  height: number;
  /** Height of the bar under the picture. */
  bottomGap: number;
}

export function useVideoFrame(stage: RefObject<HTMLElement>, video: RefObject<HTMLVideoElement>): VideoFrame {
  const [frame, setFrame] = useState<VideoFrame>({ width: 0, height: 0, bottomGap: 0 });
  useEffect(() => {
    const box = stage.current, el = video.current;
    if (!box || !el) return;
    const measure = () => {
      const w = box.clientWidth, h = box.clientHeight;
      const vw = el.videoWidth, vh = el.videoHeight;
      const scale = vw && vh ? Math.min(w / vw, h / vh) : 0;
      const next = scale ? { width: vw * scale, height: vh * scale, bottomGap: (h - vh * scale) / 2 } : { width: w, height: h, bottomGap: 0 };
      setFrame((old) => (Math.abs(old.width - next.width) < 1 && Math.abs(old.height - next.height) < 1 ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    el.addEventListener("loadedmetadata", measure);
    el.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      el.removeEventListener("loadedmetadata", measure);
      el.removeEventListener("resize", measure);
    };
  }, [stage, video]);
  return frame;
}

const SCALE: Record<SubtitleStyle["size"], number> = { small: 0.8, medium: 1, large: 1.25, extraLarge: 1.5 };
const COLORS: Record<SubtitleStyle["color"], string> = { white: "#ffffff", yellow: "#ffe033", cyan: "#66e6ff", green: "#73f280" };

/** Medium is about 2.7% of the picture's width (50 px on a 1080p screen, never under 16 px), like TV subtitles. */
export function subtitleFontSize(frame: VideoFrame, size: SubtitleStyle["size"]): number {
  const base = Math.max(16, Math.min(frame.width * 0.027, frame.height * 0.06));
  return Math.round(base * SCALE[size]);
}

interface Props {
  track: TextTrack | null;
  style: SubtitleStyle;
  frame: VideoFrame;
  /** Distance from the player's bottom edge to keep clear for the controls; 0 while they're hidden. */
  lift: number;
}

export function SubtitleOverlay({ track, style, frame, lift }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!track) { setLines([]); return; }
    const update = () => {
      const active = track.activeCues;
      const cues: VTTCue[] = [];
      for (let i = 0; active && i < active.length; i++) cues.push(active[i] as VTTCue);
      cues.sort((a, b) => a.startTime - b.startTime);
      setLines(cues.flatMap((c) => decodeCueText(c.text ?? "").split("\n")).filter((l) => l.trim()));
    };
    update();
    track.addEventListener("cuechange", update);
    return () => track.removeEventListener("cuechange", update);
  }, [track]);

  if (!lines.length) return null;
  const bottom = Math.max(frame.bottomGap + frame.height * 0.06, lift);
  return (
    <div className="subtitle-overlay" style={{ bottom }} aria-hidden="true">
      <div
        className={`subtitle-text subtitle-bg-${style.background} subtitle-face-${style.typeface}`}
        style={{ fontSize: subtitleFontSize(frame, style.size), color: COLORS[style.color], maxWidth: Math.max(280, frame.width * 0.86) }}
      >
        {lines.map((line, i) => <span key={i} className="subtitle-line">{line}</span>)}
      </div>
    </div>
  );
}
