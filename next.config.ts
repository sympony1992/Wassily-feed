import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Optional separate build folder, e.g. to verify a build without touching a running server's .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Type-checking runs as its own step (`tsc --noEmit` in the build script).
  typescript: { ignoreBuildErrors: true },
  // Built-in gzip can hold back Server-Sent Events; let the host's proxy compress instead.
  compress: false,
  poweredByHeader: false,
};

export default nextConfig;
