import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // The assistant was renamed from JARVIS to Vega; keep old links working.
  async redirects() {
    return [{ source: "/jarvis", destination: "/vega", permanent: true }];
  },
};

export default nextConfig;
