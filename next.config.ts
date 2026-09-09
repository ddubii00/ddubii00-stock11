import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  webpack(config) {
    // Opt-in for space-constrained local builds; deployment caching stays unchanged.
    if (process.env.STOCK11_LOW_DISK_BUILD === '1') config.cache = false;
    return config;
  },
};

export default nextConfig;
