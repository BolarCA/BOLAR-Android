import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@bolar/shared', '@bolar/contracts'],
  typedRoutes: false,
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
