import { Link, NavLink, useNavigate } from "react-router-dom";
import { bytes } from "../lib/format";
import { useAccount } from "../state/hooks";
import { ChevronLeft, GearIcon, Logo } from "./Icons";

const tabs = [
  { to: "/", label: "Home", end: true },
  { to: "/movies", label: "Movies" },
  { to: "/tv", label: "TV" },
  { to: "/coming-up", label: "Coming Up" },
  { to: "/search", label: "Search" },
  { to: "/library", label: "Library" },
];

/** The app's floating tab bar; pushed pages show Back where the name is. */
export function TopBar({ back = false, overlay = false }: { back?: boolean; overlay?: boolean }) {
  const navigate = useNavigate();
  const account = useAccount().data;
  const name = account?.username ?? "";
  return (
    <header className={overlay ? "topbar topbar-overlay" : "topbar"}>
      {back ? (
        <button type="button" className="icon-button" aria-label="Back" onClick={() => navigate(-1)}><ChevronLeft /></button>
      ) : (
        <Link to="/" className="brand"><Logo />Putio &amp; Chill</Link>
      )}
      <nav aria-label="Sections" className="tabs">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "tab tab-active" : "tab")}>{t.label}</NavLink>
        ))}
      </nav>
      <div className="topbar-end">
        <Link to="/settings" className="icon-button" aria-label="Settings"><GearIcon /></Link>
        <Link to="/settings" className="avatar" aria-label={account ? `${name} · ${bytes(account.disk?.avail)} free on put.io` : "Account"}>
          {(name[0] ?? "·").toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
