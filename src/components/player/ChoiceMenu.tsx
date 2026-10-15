/** A small pick-one menu for the player's top bar (audio track, playback speed). */
import { CheckIcon } from "../Icons";
import "../../styles/player.css";

interface Props<T> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChoose: (value: T) => void;
}

export function ChoiceMenu<T extends string | number>({ label, options, value, onChoose }: Props<T>) {
  return (
    <div className="menu menu-right player-choice" role="menu" aria-label={label}>
      <div className="panel-heading" aria-hidden="true">{label}</div>
      {options.map((o) => (
        <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === value} className="panel-option" onClick={() => onChoose(o.value)}>
          <span className="panel-option-main"><span className="panel-option-title">{o.label}</span></span>
          {o.value === value && <CheckIcon size={16} />}
        </button>
      ))}
    </div>
  );
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const speedText = (rate: number) => `${rate}×`;

/** Decorative icons for the top bar's buttons (they carry their own labels). */
export const AudioIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);
