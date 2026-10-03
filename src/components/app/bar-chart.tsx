import { qtyFmt } from "@/lib/format";

/**
 * Single-series horizontal bar chart (one hue, no legend; the title names it).
 * Values are direct-labelled; each bar has a tooltip and the numbers are also in a screen-reader table.
 */
export function BarChart({ title, data, unit = "pieces" }: { title: string; data: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <ul className="flex flex-col gap-2.5" aria-hidden>
        {data.map((d) => (
          <li key={d.label} className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,9rem)_1fr]">
            <span className="truncate text-muted-foreground">{d.label}</span>
            <span className="group relative flex items-center gap-2" title={`${d.label}: ${qtyFmt(d.value)} ${unit}`}>
              <span
                className="h-5 rounded-r-[4px] bg-chart-1 transition-opacity group-hover:opacity-80"
                style={{ width: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%`, maxWidth: "calc(100% - 4.5rem)" }}
              />
              <span className="num shrink-0 text-xs font-semibold">{qtyFmt(d.value)}</span>
            </span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Location</th>
            <th scope="col">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
