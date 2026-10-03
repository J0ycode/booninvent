import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

/** PWA / home-screen icons drawn from the text logo (swap for a real logo in src/config/brand.ts). */
const ICONS: Record<string, { size: number; maskable?: boolean }> = {
  "icon-192.png": { size: 192 },
  "icon-512.png": { size: 512 },
  "icon-maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true },
};

export const dynamic = "force-static";
export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: RouteContext<"/icons/[name]">) {
  const { name } = await params;
  const icon = ICONS[name];
  if (!icon) return new Response("Not found", { status: 404 });
  const { size, maskable } = icon;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: maskable ? brand.themeColor : "transparent",
        }}
      >
        <div
          style={{
            width: maskable ? "100%" : "88%",
            height: maskable ? "100%" : "88%",
            borderRadius: maskable ? 0 : size * 0.22,
            background: brand.themeColor,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * (maskable ? 0.34 : 0.4),
            fontWeight: 700,
            letterSpacing: -size * 0.01,
          }}
        >
          {brand.logoText}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
