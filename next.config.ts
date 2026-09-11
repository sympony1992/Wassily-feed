import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Type-checking runs as its own step (`tsc --noEmit` in the build script).
  typescript: { ignoreBuildErrors: true },
  // Built-in gzip can hold back Server-Sent Events; let the host's proxy compress instead.
  compress: false,
  poweredByHeader: false,
};

export default nextConfig;
