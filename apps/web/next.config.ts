import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: load it (and the db layer that owns
  // it) with plain Node require at runtime instead of bundling it.
  serverExternalPackages: ['@races/db', 'better-sqlite3'],
};

export default nextConfig;
