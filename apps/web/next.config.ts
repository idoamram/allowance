import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output — Next compiles them.
  transpilePackages: ['@planbound/core', '@planbound/chains'],
}

export default nextConfig
