import { config } from 'dotenv'
import type { NextConfig } from 'next'

// Next reads .env.local from the app directory; this repo keeps one gitignored
// secrets file at the monorepo root so scripts and the app can't drift apart.
config({ path: '../../.env.local' })

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output — Next compiles them.
  transpilePackages: ['@planbound/core', '@planbound/chains'],
}

export default nextConfig
