import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@healthmate/shared-types"],
  poweredByHeader: false,
};

export default nextConfig;
