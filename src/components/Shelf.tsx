import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "./Icons";

/** A titled horizontal row that pages with ‹ › arrows at its edges (a mouse wheel can't scroll sideways). */
export function Shelf({ title, seeAll, children }: { title: string; seeAll?: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ back: false, forward: false });

  const update = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdges({ back: el.scrollLeft > 4, forward: el.scrollLeft < el.scrollWidth - el.clientWidth - 4 });
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener("scroll", update); };
  }, [update, children]);

  const page = (direction: number) => row.current?.scrollBy({ left: direction * row.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        {seeAll && <Link to={seeAll} className="see-all">See all</Link>}
      </div>
      <div className="shelf-body">
        <div className="shelf-row" ref={row}>{children}</div>
        {edges.back && <button type="button" className="shelf-arrow shelf-arrow-back" aria-label={`Scroll ${title} back`} onClick={() => page(-1)}><ChevronLeft /></button>}
        {edges.forward && <button type="button" className="shelf-arrow shelf-arrow-forward" aria-label={`Scroll ${title} forward`} onClick={() => page(1)}><ChevronRight /></button>}
      </div>
    </section>
  );
}
