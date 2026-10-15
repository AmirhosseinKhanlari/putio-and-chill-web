/** Stroke icons in the app's style (decorative: buttons carry their own labels). */
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, fill = "none", ...rest }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={fill === "none" ? "currentColor" : "none"}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const PlayIcon = (p: Props) => <Icon fill="currentColor" {...p}><path d="M7 4.5v15l12.5-7.5z" /></Icon>;
export const PauseIcon = (p: Props) => <Icon fill="currentColor" {...p}><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></Icon>;
export const PlusIcon = (p: Props) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const CheckIcon = (p: Props) => <Icon strokeWidth={2.6} {...p}><path d="M5 12l5 5L20 7" /></Icon>;
export const InfoIcon = (p: Props) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></Icon>;
export const ChevronLeft = (p: Props) => <Icon strokeWidth={2.4} {...p}><path d="M15 5l-7 7 7 7" /></Icon>;
export const ChevronRight = (p: Props) => <Icon strokeWidth={2.4} {...p}><path d="M9 5l7 7-7 7" /></Icon>;
export const ChevronDown = (p: Props) => <Icon strokeWidth={2.4} {...p}><path d="M6 9l6 6 6-6" /></Icon>;
export const CloseIcon = (p: Props) => <Icon strokeWidth={2.4} {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const SearchIcon = (p: Props) => <Icon strokeWidth={2.2} {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>;
export const CloudDown = (p: Props) => <Icon {...p}><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9" /><path d="M12 12v8M9 17l3 3 3-3" /></Icon>;
export const LayersIcon = (p: Props) => <Icon {...p}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></Icon>;
export const BellIcon = (p: Props) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></Icon>;
export const TrailerIcon = (p: Props) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" /></Icon>;
export const FolderIcon = (p: Props) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>;
export const FilmIcon = (p: Props) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></Icon>;
export const TrashIcon = (p: Props) => <Icon {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Icon>;
export const GearIcon = (p: Props) => <Icon strokeWidth={1.8} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>;
export const SparkIcon = (p: Props) => <Icon {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></Icon>;
export const DiceIcon = (p: Props) => <Icon strokeWidth={1.6} {...p}><rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="9" cy="9" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></Icon>;
export const SubtitlesIcon = (p: Props) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 13h4M13 13h4M7 16h7" /></Icon>;
export const FullscreenIcon = (p: Props) => <Icon {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Icon>;
export const PipIcon = (p: Props) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><rect x="12" y="11" width="7" height="6" rx="1.2" fill="currentColor" /></Icon>;
export const RefreshIcon = (p: Props) => <Icon {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Icon>;
export const MoreIcon = (p: Props) => <Icon fill="currentColor" {...p}><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></Icon>;
export const Back10 = (p: Props) => (
  <Icon strokeWidth={1.8} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /><text x="12" y="15.2" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text></Icon>
);
export const Forward10 = (p: Props) => (
  <Icon strokeWidth={1.8} {...p}><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v4h-4" /><text x="12" y="15.2" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text></Icon>
);
/** The iPhone app's icon (public/icon-192.png, made from its AppIcon), with the iOS corner rounding. */
export const Logo = ({ size = 32 }: { size?: number }) => (
  <img src="/icon-192.png" width={size} height={size} alt="" style={{ borderRadius: size * 0.225, flex: "none" }} />
);
