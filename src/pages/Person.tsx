import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { personDetail, personMeta, type Credit, type PersonDetail } from "../api/people";
import { image, type MediaKind } from "../api/tmdb";
import { PosterCard } from "../components/Cards";
import { TopBar } from "../components/TopBar";
import { CatalogShelf, useInPutio } from "./Home";
import "../styles/person.css";

/** Everything one actor or filmmaker worked on: Known For row, then the full filmography, newest first. */
export function Person() {
  const { id } = useParams<{ id: string }>();
  const personID = Number(id);
  const person = useQuery({
    queryKey: ["person", personID], queryFn: () => personDetail(personID),
    enabled: Number.isInteger(personID) && personID > 0, staleTime: 60 * 60_000,
  });
  useEffect(() => { window.scrollTo(0, 0); }, [personID]);

  return (
    <div className="page">
      <TopBar back />
      <div className="page-body narrow person-page">
        {person.data ? <PersonView key={personID} person={person.data} />
          : person.isError || !Number.isInteger(personID) ? <p className="error-text">Couldn't load this person.</p>
          : <p className="muted">Loading…</p>}
      </div>
    </div>
  );
}

function PersonView({ person }: { person: PersonDetail }) {
  const meta = personMeta(person);
  return (
    <>
      <header className="person-head">
        <PersonPhoto path={person.profilePath} name={person.name} />
        <div className="person-title">
          <h1 className="person-name">{person.name}</h1>
          {meta && <p className="person-meta">{meta}</p>}
        </div>
      </header>
      {person.biography && <Biography text={person.biography} />}
      <CatalogShelf title="Known For" items={person.knownFor} />
      {person.credits.length > 0 && <Filmography credits={person.credits} />}
    </>
  );
}

function PersonPhoto({ path, name }: { path?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = image(path, "w342");
  if (!src || failed) return <div className="person-photo person-photo-fallback" aria-hidden="true">{initials(name)}</div>;
  return <img className="person-photo" src={src} alt="" onError={() => setFailed(true)} />;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");

/** Four lines, with More only when the text is longer than that. */
function Biography({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);

  return (
    <section className="person-bio" aria-label="Biography">
      <p id="person-bio-text" ref={ref} className={open ? "person-bio-text" : "person-bio-text person-bio-clamped"}>{text}</p>
      {(overflows || open) && (
        <button type="button" className="text-button" aria-expanded={open} aria-controls="person-bio-text" onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </section>
  );
}

type Filter = "all" | MediaKind;

function Filmography({ credits }: { credits: Credit[] }) {
  const inPutio = useInPutio();
  const [filter, setFilter] = useState<Filter>("all");
  const counts = { all: credits.length, movie: credits.filter((c) => c.item.kind === "movie").length, tv: credits.filter((c) => c.item.kind === "tv").length };
  const shown = filter === "all" ? credits : credits.filter((c) => c.item.kind === filter);
  const options: [Filter, string][] = [["all", "All"], ["movie", "Movies"], ["tv", "Shows"]];

  return (
    <section className="shelf" aria-labelledby="filmography-heading">
      <div className="section-head">
        <h2 id="filmography-heading">Filmography</h2>
        {counts.movie > 0 && counts.tv > 0 && (
          <div className="segmented" role="group" aria-label="Show">
            {options.map(([value, label]) => (
              <button key={value} type="button" className={filter === value ? "segment segment-on" : "segment"} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label} <span className="person-count">{counts[value]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid">
        {shown.map((c) => (
          <div key={`${c.item.kind}-${c.item.tmdbID}`} className="credit">
            <PosterCard item={c.item} inPutio={inPutio(c.item)} />
            <div className="credit-meta">
              <span>{c.item.year ?? "Upcoming"}{c.item.kind === "tv" ? " · Series" : ""}</span>
              {c.roles.length > 0 && <span className="credit-role">{c.roles.join(", ")}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
