import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // The dev-mode indicator overlay sits over the mobile bottom navigation and intercepts taps in e2e runs.
  devIndicators: false,
  transpilePackages: ['@bolar/shared', '@bolar/contracts'],
  typedRoutes: false,
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
