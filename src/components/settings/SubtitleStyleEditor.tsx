/** Subtitle look (size, box, color, typeface) with a live preview, as in the iPhone app's SubtitleStyleEditor. */
import { subtitleStyleCSS, type SubtitleStyle } from "../../lib/settings";
import { Group, SelectRow } from "./Controls";

const sizes: { value: SubtitleStyle["size"]; label: string }[] = [
  { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }, { value: "extraLarge", label: "Extra large" },
];
const backgrounds: { value: SubtitleStyle["background"]; label: string }[] = [
  { value: "none", label: "None (outline)" }, { value: "translucent", label: "Translucent box" }, { value: "solid", label: "Solid box" },
];
const colors: { value: SubtitleStyle["color"]; label: string }[] = [
  { value: "white", label: "White" }, { value: "yellow", label: "Yellow" }, { value: "cyan", label: "Cyan" }, { value: "green", label: "Green" },
];
const typefaces: { value: SubtitleStyle["typeface"]; label: string }[] = [
  { value: "standard", label: "Standard" }, { value: "rounded", label: "Rounded" }, { value: "serif", label: "Serif" }, { value: "monospaced", label: "Monospaced" },
];

export const subtitleSummary = (s: SubtitleStyle) =>
  [sizes.find((x) => x.value === s.size)?.label, colors.find((x) => x.value === s.color)?.label].join(", ");

export function SubtitleStyleEditor({ style, onChange }: { style: SubtitleStyle; onChange: (style: SubtitleStyle) => void }) {
  return (
    <>
      <div className="subtitle-preview" aria-label="Subtitle preview" role="img">
        <span className="subtitle-preview-text" style={subtitleStyleCSS(style)}>Every new beginning comes<br />from some other beginning's end.</span>
      </div>
      <Group title="Style">
        <SelectRow label="Size" value={style.size} options={sizes} onChange={(size) => onChange({ ...style, size })} />
        <SelectRow label="Background" value={style.background} options={backgrounds} onChange={(background) => onChange({ ...style, background })} />
        <SelectRow label="Color" value={style.color} options={colors} onChange={(color) => onChange({ ...style, color })} />
        <SelectRow label="Typeface" value={style.typeface} options={typefaces} onChange={(typeface) => onChange({ ...style, typeface })} />
      </Group>
    </>
  );
}
