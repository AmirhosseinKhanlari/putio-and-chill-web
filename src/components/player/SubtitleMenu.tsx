/** The one subtitles menu (the iPhone app's SubtitleSheet): off, put.io's tracks grouped by where they come from, an
 * OpenSubtitles search, and timing for what's showing. */
import { Link } from "react-router-dom";
import { OpenSubtitlesError, type SubtitleResult } from "../../api/opensubtitles";
import type { SubtitleStyle } from "../../lib/settings";
import { CheckIcon } from "../Icons";
import { languageName, SEARCH_LANGUAGES } from "./subtitles";
import type { Subtitles } from "./useSubtitles";
import "../../styles/player.css";

const SIZE_NAMES: Record<SubtitleStyle["size"], string> = { small: "Small", medium: "Medium", large: "Large", extraLarge: "Extra large" };
const BACKGROUND_NAMES: Record<SubtitleStyle["background"], string> = { none: "no box", translucent: "see-through box", solid: "solid box" };

const timing = (offset: number) => (offset === 0 ? "In sync" : `${offset > 0 ? "+" : "−"}${Math.abs(offset).toFixed(1)} s`);
const downloads = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count));

function Spinner() {
  return <span className="panel-spinner" role="status" aria-label="Loading" />;
}

interface Props {
  subtitles: Subtitles;
  style: SubtitleStyle;
  /** After a pick that worked. */
  onPicked: () => void;
}

export function SubtitleMenu({ subtitles: s, style, onPicked }: Props) {
  const { choice, showing, loading, groups, openSubtitles: os } = s;
  const pickedPutio = (key: string) => showing && choice?.source === "putio" && choice.key === key;
  const pickedOS = (id: number) => showing && choice?.source === "opensubtitles" && choice.fileID === id;
  const results = os.results.data ?? [];
  // A preferred language outside the usual list still gets an entry.
  const languages = SEARCH_LANGUAGES.some((l) => l.code === os.language)
    ? SEARCH_LANGUAGES
    : [{ code: os.language, name: languageName(os.language) || os.language }, ...SEARCH_LANGUAGES];

  const pickResult = async (result: SubtitleResult) => { if (await s.chooseOpenSubtitles(result)) onPicked(); };

  return (
    <div className="menu menu-right player-panel" role="dialog" aria-label="Subtitles">
      {showing && choice && choice.source !== "off" && (
        <section className="panel-section" aria-label="Showing">
          <div className="panel-heading">Showing</div>
          <div className="panel-now">
            <div className="strong clamp-1" title={choice.label}>{choice.label}</div>
            <div className="muted small">
              {[languageName(choice.language) || choice.language, choice.source === "putio" ? "put.io" : "OpenSubtitles"].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="panel-timing">
            <button type="button" className="round-button round-quiet" aria-label="Show subtitles earlier (half a second)" onClick={() => s.shiftTiming(-0.5)}>−</button>
            <div className="panel-timing-value">
              <span className="strong tabular" aria-live="polite">{timing(choice.offset)}</span>
              <span className="muted small">Timing</span>
            </div>
            <button type="button" className="round-button round-quiet" aria-label="Show subtitles later (half a second)" onClick={() => s.shiftTiming(0.5)}>+</button>
          </div>
        </section>
      )}

      <div role="radiogroup" aria-label="Subtitles off" className="panel-section">
        <button type="button" role="radio" aria-checked={!showing} className="panel-option" onClick={() => { s.turnOff(); onPicked(); }}>
          <span className="panel-option-main"><span className="panel-option-title">Off</span></span>
          {!showing && <CheckIcon size={16} />}
        </button>
      </div>

      <section className="panel-section" aria-label="On put.io">
        <div className="panel-heading">On put.io</div>
        {s.tracks.isPending && <div className="menu-note"><Spinner /> Loading put.io's subtitles…</div>}
        {s.tracks.isError && <div className="menu-note">Couldn't load put.io's subtitles.</div>}
        {s.tracks.isSuccess && !groups.length && <div className="menu-note">put.io has no subtitles for this video. Search OpenSubtitles below.</div>}
        {groups.map((group) => (
          <div key={group.origin} role="radiogroup" aria-label={group.title}>
            <div className="panel-subheading">{group.title}</div>
            {group.rows.map((row) => (
              <button key={row.track.key} type="button" role="radio" aria-checked={pickedPutio(row.track.key)} className="panel-option"
                disabled={loading !== null} onClick={async () => { if (await s.choosePutio(row.track)) onPicked(); }}>
                <span className="panel-option-main">
                  <span className="panel-option-title">{row.title}</span>
                  {(row.detail || row.tags.length > 0) && (
                    <span className="panel-option-detail">
                      {row.tags.map((t) => <span key={t} className="panel-tag">{t}</span>)}
                      {row.detail && <span className="clamp-1" title={row.detail}>{row.detail}</span>}
                    </span>
                  )}
                </span>
                {loading === `putio:${row.track.key}` ? <Spinner /> : pickedPutio(row.track.key) && <CheckIcon size={16} />}
              </button>
            ))}
          </div>
        ))}
      </section>

      <section className="panel-section" aria-label="OpenSubtitles">
        <div className="panel-heading panel-heading-row">
          <span>OpenSubtitles</span>
          {os.enabled && (
            <label className="panel-language">
              <span className="visually-hidden">Language</span>
              <select className="select" value={os.language} onChange={(e) => os.setLanguage(e.target.value)}>
                {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {!os.enabled ? (
          <p className="menu-note">Add an OpenSubtitles API key in <Link to="/settings">Settings</Link> to search OpenSubtitles.</p>
        ) : (
          <>
            {os.results.isFetching && !results.length && <div className="menu-note"><Spinner /> Searching OpenSubtitles…</div>}
            {os.results.isError && (
              <div className="menu-note error-text">
                {os.results.error instanceof OpenSubtitlesError ? os.results.error.message : "Couldn't search OpenSubtitles. Try again in a moment."}
              </div>
            )}
            {os.results.isSuccess && !results.length && (
              <div className="menu-note">No {languages.find((l) => l.code === os.language)?.name ?? ""} subtitles found for this video.</div>
            )}
            {results.length > 0 && (
              <div role="radiogroup" aria-label="OpenSubtitles results">
                {results.slice(0, 40).map((r) => (
                  <button key={r.fileID} type="button" role="radio" aria-checked={pickedOS(r.fileID)} className="panel-option"
                    disabled={loading !== null} onClick={() => void pickResult(r)}>
                    <span className="panel-option-main">
                      <span className="panel-option-title panel-option-release">{r.release}</span>
                      <span className="panel-option-detail">
                        {r.trusted && <span className="panel-tag panel-tag-good">Trusted</span>}
                        {r.hearingImpaired && <span className="panel-tag">SDH</span>}
                        {r.machineTranslated && <span className="panel-tag panel-tag-warn">Machine translated</span>}
                        <span>{downloads(r.downloads)} downloads</span>
                      </span>
                    </span>
                    {loading === `os:${r.fileID}` ? <Spinner /> : pickedOS(r.fileID) && <CheckIcon size={16} />}
                  </button>
                ))}
              </div>
            )}
            {os.remaining !== undefined && (
              <div className="menu-note">{os.remaining} OpenSubtitles downloads left today. Subtitles you've picked before don't count again.</div>
            )}
          </>
        )}
      </section>

      {s.message && <div className="menu-note error-text" role="alert">{s.message}</div>}

      <div className="menu-note panel-style">
        Style: {SIZE_NAMES[style.size]}, {BACKGROUND_NAMES[style.background]} · <Link to="/settings">Change in Settings</Link>
      </div>
    </div>
  );
}
