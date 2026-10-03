import { code128Svg } from "@/server/barcode";

/** Server component: renders a Code 128 barcode as inline SVG. */
export function Barcode({ value, className }: { value: string; className?: string }) {
  let svg = "";
  try {
    svg = code128Svg(value);
  } catch {
    return <p className="text-sm text-destructive">This barcode cannot be drawn.</p>;
  }
  return (
    <div
      role="img"
      aria-label={`Barcode ${value}`}
      className={className ?? "w-full max-w-xs rounded-lg bg-white p-3 [&_svg]:h-auto [&_svg]:w-full"}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
