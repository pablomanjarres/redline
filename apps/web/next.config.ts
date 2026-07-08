import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source (via the `default`
  // export condition), so Next must transpile them.
  transpilePackages: ['@redline/ui', '@redline/contracts', '@redline/engine', '@redline/reasoning'],
};

export default nextConfig;
