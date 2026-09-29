import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@healthmate/shared-types", "@healthmate/sample-data"],
  poweredByHeader: false,
};

export default nextConfig;
