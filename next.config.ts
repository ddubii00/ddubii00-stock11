import type { NextConfig } from 'next';

const basePath = (process.env.STOCK11_BASE_PATH ?? '').replace(/\/+$/, '');
const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  output: 'standalone',
  poweredByHeader: false,
  webpack(config) {
    // Opt-in for space-constrained local builds; deployment caching stays unchanged.
    if (process.env.STOCK11_LOW_DISK_BUILD === '1') config.cache = false;
    return config;
  },
};

export default nextConfig;
