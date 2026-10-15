import { describe, expect, it } from "vitest";
import { parseChillRSS, fromChillMovie, fromChillShow } from "./chillCatalog";
import { isShowType, parseIMDbRef, parseListPage } from "./imdb";
import { parseMyMoviz } from "./mymoviz";
import { combine, decodeEntities, imdbIDIn, splitYear, type ListTitle } from "./titles";
import { curatedFor, curatedQuery, dayLabel, groupByDay, shortDate, tmdbListSpec, upcomingOnly, yourShows, type UpcomingEpisode } from "./tmdbLists";
import { parseBoxOffice, parseListItems, revenueText } from "./trakt";

const t = (title: string, extra: Partial<ListTitle> = {}): ListTitle => ({ kind: "movie", title, source: "test", ...extra });

describe("combine", () => {
  it("keeps each title once and puts the newest first", () => {
    const chill = [t("Old", { imdbID: "tt0000001", releaseDate: "2020-01-01", source: "chill" }), t("New", { imdbID: "tt0000002", releaseDate: "2026-05-01", source: "chill" })];
    const mymoviz = [t("New", { imdbID: "tt0000002", year: 2026, source: "MYMOVIZ" }), t("Mid", { year: 2024, source: "MYMOVIZ" })];
    const merged = combine([chill, mymoviz]);
    expect(merged.map((x) => x.title)).toEqual(["New", "Mid", "Old"]);
    // Round-robin: MyMoviz's top pick is seen before chill's second.
    expect(merged[0].source).toBe("MYMOVIZ");
  });

  it("keeps undated titles after dated ones, in list order", () => {
    expect(combine([[t("A"), t("B", { year: 2001 })], [t("C")]]).map((x) => x.title)).toEqual(["B", "A", "C"]);
  });

  it("merges by title and year when there is no IMDb id", () => {
    expect(combine([[t("Dune", { year: 2021 })], [t("dune", { year: 2021 })]])).toHaveLength(1);
  });
});

describe("small parsers", () => {
  it("splits a trailing year", () => {
    expect(splitYear("Unit 23 Reloaded 2024")).toEqual(["Unit 23 Reloaded", 2024]);
    expect(splitYear("Blade Runner 2049")).toEqual(["Blade Runner", 2049]);
    expect(splitYear("Heat")).toEqual(["Heat", undefined]);
  });

  it("finds IMDb ids in ids and links", () => {
    expect(imdbIDIn(undefined, "https://imdb.com/title/tt9000001/")).toBe("tt9000001");
    expect(imdbIDIn("movie-1")).toBeUndefined();
  });

  it("decodes HTML entities", () => {
    expect(decodeEntities("Tom &amp; Jerry&#039;s &quot;Day&quot; &#x26;")).toBe("Tom & Jerry's \"Day\" &");
  });
});

describe("MyMoviz", () => {
  const html = `
    <a class="mv-card" href="/movies/225628/siccin-9-2026" data-guid="225628" title="Sicc&#238;n 9 2026">
      <div class="mv-card__poster"><img class="mv-card__img" src="https://imgsources.cc/./images/cover/42/tt42006709.jpg"></div></a>
    <a class="mv-card" href="/movies/1/tom-jerry-2025" title="Tom &amp; Jerry 2025"><div>no poster</div></a>
    <a class="mv-card" href="/movies/2/x" title="Heat 1995"><img src="/cover/tt0113277.jpg"></a>`;

  it("reads each card's title, year and the IMDb id from its own poster", () => {
    expect(parseMyMoviz(html, "movie")).toEqual([
      { kind: "movie", title: "Siccîn 9", year: 2026, imdbID: "tt42006709", source: "MYMOVIZ" },
      { kind: "movie", title: "Tom & Jerry", year: 2025, imdbID: undefined, source: "MYMOVIZ" },
      { kind: "movie", title: "Heat", year: 1995, imdbID: "tt0113277", source: "MYMOVIZ" },
    ]);
  });
});

describe("chill.institute", () => {
  it("reads RSS items, collapsing several releases of one movie", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>chill</title>
      <item><title><![CDATA[Dune.Part.Two.2024.1080p.WEB-DL.H264-GRP]]></title><link>https://www.imdb.com/title/tt15239678/</link></item>
      <item><title>Dune Part Two 2024 2160p BluRay</title><description>tt15239678</description></item>
      <item><title>Heat (1995)</title></item>
    </channel></rss>`;
    const titles = parseChillRSS(xml, "MOVIES_SOURCE_YTS");
    expect(titles.map((x) => [x.title, x.year, x.imdbID])).toEqual([["Dune Part Two", 2024, "tt15239678"], ["Heat", 1995, undefined]]);
  });

  it("maps API movies and shows", () => {
    expect(fromChillMovie({ id: "movie-1", title: "aurora protocol", titlePretty: "Aurora Protocol", year: 2010, externalUrl: "https://imdb.com/title/tt9000001" }, "S"))
      .toMatchObject({ kind: "movie", title: "Aurora Protocol", year: 2010, imdbID: "tt9000001" });
    expect(fromChillShow({ imdbId: "tt9000003", title: "Harbor Ward", year: 0, firstAirDate: "2025-02-01" }))
      .toMatchObject({ kind: "tv", title: "Harbor Ward", year: undefined, imdbID: "tt9000003", releaseDate: "2025-02-01" });
  });
});

describe("IMDb", () => {
  it("reads watchlist and list links", () => {
    expect(parseIMDbRef("https://www.imdb.com/user/ur12345678/watchlist")).toEqual({ type: "watchlist", userID: "ur12345678" });
    expect(parseIMDbRef("https://www.imdb.com/list/ls055592025/")).toEqual({ type: "list", id: "ls055592025" });
    expect(parseIMDbRef("imdb.com/user/p.E4i6abcd12/watchlist")).toEqual({ type: "profileWatchlist", profileID: "p.e4i6abcd12" });
    expect(parseIMDbRef("https://example.com")).toBeUndefined();
    expect(parseIMDbRef(null)).toBeUndefined();
  });

  it("reads a page of list items", () => {
    const page = parseListPage({ list: { titleListItemSearch: { pageInfo: { hasNextPage: true, endCursor: "abc" }, edges: [
      { listItem: { id: "tt0068646", titleText: { text: "The Godfather" }, titleType: { id: "movie" }, releaseYear: { year: 1972 } } },
      { listItem: { id: "tt0903747", titleText: { text: "Breaking Bad" }, titleType: { id: "tvSeries" }, releaseYear: { year: 2008 } } },
    ] } } });
    expect(page?.next).toBe("abc");
    expect(page?.titles.map((x) => [x.kind, x.title, x.imdbID])).toEqual([["movie", "The Godfather", "tt0068646"], ["tv", "Breaking Bad", "tt0903747"]]);
    expect(parseListPage({ list: null })).toBeUndefined();
  });

  it("counts series as shows and TV movies as movies", () => {
    expect(isShowType("tvMiniSeries")).toBe(true);
    expect(isShowType("tvMovie")).toBe(false);
    expect(isShowType("short")).toBe(false);
  });
});

describe("Trakt", () => {
  it("reads list items in rank order", () => {
    const titles = parseListItems([
      { rank: 1, type: "movie", movie: { title: "The Shawshank Redemption", year: 1994, ids: { imdb: "tt0111161", tmdb: 278 } } },
      { rank: 2, type: "show", show: { title: "Breaking Bad", year: 2008, ids: { imdb: "tt0903747", tmdb: 1396 } } },
      { rank: 3, type: "person" },
    ]);
    expect(titles).toEqual([
      { kind: "movie", title: "The Shawshank Redemption", year: 1994, rank: 1, source: "trakt", imdbID: "tt0111161", tmdbID: 278 },
      { kind: "tv", title: "Breaking Bad", year: 2008, rank: 2, source: "trakt", imdbID: "tt0903747", tmdbID: 1396 },
    ]);
  });

  it("ranks the box office with weekend gross", () => {
    const chart = parseBoxOffice([{ revenue: 28_000_000, movie: { title: "Other Mommy", year: 2026, ids: { imdb: "tt36586020", tmdb: 1400837 } } }, { revenue: null, movie: { title: "Verity", year: 2026, ids: {} } }]);
    expect(chart.map((e) => [e.rank, e.title, e.revenue, e.tmdbID])).toEqual([[1, "Other Mommy", 28_000_000, 1400837], [2, "Verity", undefined, undefined]]);
    expect(revenueText(42_100_000)).toBe("$42.1M");
    expect(revenueText(850_000)).toBe("$850K");
    expect(revenueText(0)).toBeUndefined();
  });
});

describe("TMDB lists", () => {
  const today = new Date("2026-10-15T15:00:00Z");

  it("has the iPhone app's themed lists for each kind", () => {
    expect(curatedFor("movie")).toEqual(["netflix", "disney", "acclaimed"]);
    expect(curatedFor("tv")).toEqual(["netflix", "disney", "new-series", "returning", "acclaimed"]);
  });

  it("builds discover filters", () => {
    expect(curatedQuery("netflix", "movie", today)).toMatchObject({ with_watch_providers: "8", watch_region: "US", "primary_release_date.gte": "2026-06-17", "primary_release_date.lte": "2026-10-15" });
    expect(curatedQuery("netflix", "tv", today)).toMatchObject({ with_networks: "213", "air_date.gte": "2026-09-15" });
    expect(curatedQuery("returning", "tv", today)).toMatchObject({ "air_date.lte": "2026-10-22", "first_air_date.lte": "2026-07-17", "vote_count.gte": "50" });
    expect(curatedQuery("acclaimed", "movie", today)).toMatchObject({ sort_by: "vote_average.desc", "vote_average.gte": "7.5" });
  });

  it("knows every See all address and rejects others", () => {
    expect(tmdbListSpec("movie-popular")).toMatchObject({ kind: "movie", path: "movie/popular" });
    expect(tmdbListSpec("tv-genre-80")).toMatchObject({ title: "Crime Shows", path: "discover/tv", query: { with_genres: "80" } });
    expect(tmdbListSpec("tv-new-series")?.title).toBe("New Series");
    expect(tmdbListSpec("movie-new-series")).toBeUndefined();
    expect(tmdbListSpec("trending-all")).toMatchObject({ kind: undefined, path: "trending/all/week" });
    expect(tmdbListSpec("movie-like-603")?.path).toBe("movie/603/recommendations");
    expect(tmdbListSpec("movie-upcoming")).toMatchObject({ dated: true, query: { region: "US" } });
    expect(tmdbListSpec("nonsense")).toBeUndefined();
  });
});

describe("Coming Up", () => {
  const today = new Date(2026, 9, 15, 10); // Thursday 15 October 2026, local time
  const show = (title: string, tmdbID: number) => ({ tmdbID, kind: "tv" as const, title });
  const ep = (title: string, airDate: string): UpcomingEpisode => ({ show: show(title, title.length), season: 1, episode: 2, name: "Next", airDate });

  it("labels days like the iPhone app", () => {
    expect(dayLabel("2026-10-15", today)).toBe("Today");
    expect(dayLabel("2026-10-16", today)).toBe("Tomorrow");
    expect(dayLabel("2026-10-19", today)).toBe("Monday");
    expect(dayLabel("2026-10-24", today)).toBe("Oct 24");
    expect(shortDate("2026-12-03")).toBe("Dec 3");
    expect(shortDate(undefined)).toBeUndefined();
  });

  it("groups the next 30 days of episodes by day, shows A to Z", () => {
    const days = groupByDay([ep("Severance", "2026-10-16"), ep("Andor", "2026-10-16"), ep("Past", "2026-10-01"), ep("Far", "2026-12-30"), ep("Now", "2026-10-15")], today);
    expect(days.map((d) => [d.label, d.episodes.map((e) => e.show.title)])).toEqual([["Today", ["Now"]], ["Tomorrow", ["Andor", "Severance"]]]);
  });

  it("keeps only future releases, soonest first", () => {
    const item = (id: number) => ({ tmdbID: id, kind: "movie" as const, title: String(id) });
    const list = [{ item: item(1), date: "2026-11-01" }, { item: item(2), date: "2026-10-15" }, { item: item(3) }, { item: item(4), date: "2026-10-20" }];
    expect(upcomingOnly(list, "2026-10-15").map((d) => d.item.tmdbID)).toEqual([4, 1]);
    expect(upcomingOnly(list, "2026-10-15", true).map((d) => d.item.tmdbID)).toEqual([2, 4, 1]);
  });

  it("lists put.io shows first, then My List, each once", () => {
    expect(yourShows([3, undefined, 1, 3], [1, 7])).toEqual([3, 1, 7]);
  });
});
