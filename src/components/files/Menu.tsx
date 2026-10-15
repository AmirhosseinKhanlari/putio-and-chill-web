import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Set for a choice among several (sort order): shown and read out as checked or not. */
  checked?: boolean;
  disabled?: boolean;
}

/** Where a menu opens: under a ⋯ button (lined up with its right edge) or at the pointer for a right-click. */
export interface MenuPlace {
  x: number;
  y: number;
  /** The button that opened it: gets focus back, and clicking it again closes the menu instead of reopening it. */
  trigger?: HTMLElement | null;
  alignRight?: boolean;
}

/** Places a menu for a ⋯ button. */
export function placeUnder(button: HTMLElement): MenuPlace {
  const rect = button.getBoundingClientRect();
  return { x: rect.right, y: rect.bottom + 6, trigger: button, alignRight: true };
}

/** Places a menu at a right-click, or under the row when the keyboard's menu key opened it (no pointer position). */
export function placeAtPointer(event: React.MouseEvent): MenuPlace {
  if (event.clientX === 0 && event.clientY === 0) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: rect.left + 24, y: rect.bottom, trigger: event.currentTarget as HTMLElement };
  }
  return { x: event.clientX, y: event.clientY };
}

/** A pop-up menu kept on screen (fixed, so lists and dialogs don't clip it). Arrow keys move, Escape and Tab close,
 * a click elsewhere or scrolling the page closes it. */
export function Menu({ label, items, place, onClose }: { label: string; items: MenuItem[]; place: MenuPlace; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onClose);
  done.current = onClose;

  // Measured before paint, so it never flashes off the edge of a phone screen.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const margin = 8;
    let left = place.alignRight ? place.x - width : place.x;
    let top = place.y;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, (place.trigger && place.alignRight ? place.trigger.getBoundingClientRect().top - 6 : place.y) - height);
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [place]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || place.trigger?.contains(target)) return;
      done.current();
    };
    const away = () => done.current();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("blur", away);
    };
  }, [place]);

  function close(restoreFocus: boolean) {
    if (restoreFocus && place.trigger?.isConnected) place.trigger.focus();
    done.current();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const entries = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { event.preventDefault(); entries[(i + entries.length) % entries.length]?.focus(); };
    switch (event.key) {
      case "ArrowDown": return go(index + 1);
      case "ArrowUp": return go(index - 1);
      case "Home": return go(0);
      case "End": return go(entries.length - 1);
      case "Escape": event.preventDefault(); event.stopPropagation(); return close(true);
      case "Tab": return close(false);
    }
  }

  return (
    <div ref={ref} className="menu files-menu" role="menu" aria-label={label} onKeyDown={onKeyDown}
      style={{ left: place.x, top: place.y }}>
      {items.map((item) => (
        <button key={item.label} type="button" role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked}
          className={item.danger ? "files-menu-danger" : undefined} disabled={item.disabled}
          onClick={() => {
            // Focus goes back first, so a dialog opened next returns there when it closes.
            close(true);
            item.onSelect();
          }}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
