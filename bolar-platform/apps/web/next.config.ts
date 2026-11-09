import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@bolar/shared', '@bolar/contracts'],
  typedRoutes: false,
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
