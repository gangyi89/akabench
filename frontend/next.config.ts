import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained /.next/standalone bundle so the production Docker
  // image can copy just /standalone + /static and run `node server.js` with
  // no node_modules. Drops the runtime image from ~1 GB to ~200 MB.
  output: "standalone",
};

export default nextConfig;
