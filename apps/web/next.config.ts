import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source (via the `default`
  // export condition), so Next must transpile them.
  transpilePackages: ['@redline/ui', '@redline/contracts', '@redline/engine', '@redline/reasoning'],
  eslint: {
    // Lint runs in its own CI step; don't fail the production build on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
