/** File manager icons, drawn like the ones in components/Icons (decorative: controls carry their own labels). */
import type { ReactNode, SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: Props & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const PencilIcon = (p: Props) => <Icon {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Icon>;
export const MoveIcon = (p: Props) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 13h6M13 10.5l2.5 2.5-2.5 2.5" /></Icon>;
export const CopyIcon = (p: Props) => <Icon {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>;
export const DownloadIcon = (p: Props) => <Icon {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Icon>;
export const FolderPlusIcon = (p: Props) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 10.5v5M9.5 13h5" /></Icon>;
export const RestoreIcon = (p: Props) => <Icon {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Icon>;
export const SortIcon = (p: Props) => <Icon {...p}><path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M13 6h8M13 11h6M13 16h4" /></Icon>;
export const FileIcon = (p: Props) => <Icon {...p}><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /></Icon>;
export const OpenIcon = (p: Props) => <Icon {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Icon>;
