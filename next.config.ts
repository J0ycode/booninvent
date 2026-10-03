import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CSV import sends up to 5,000 rows to a server action.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  serverExternalPackages: ["bwip-js", "pdf-lib"],
  poweredByHeader: false,
};

export default nextConfig;
