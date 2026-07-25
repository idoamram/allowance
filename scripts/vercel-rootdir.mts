/**
 * Set the Vercel project's Root Directory to apps/web.
 *
 * Vercel's Next.js detector looks in the project's root directory; in a pnpm workspace
 * the app lives in apps/web while the lockfile lives at the repo root. Root Directory
 * is a project setting (not expressible in vercel.json), so it goes through the API.
 * Reads the CLI's stored token — never prints it.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const { projectId, orgId } = JSON.parse(readFileSync('.vercel/project.json', 'utf8'))
const authPath = `${homedir()}/Library/Application Support/com.vercel.cli/auth.json`
const token = JSON.parse(readFileSync(authPath, 'utf8')).token as string
if (!token) {
  console.error('blocked: no Vercel CLI token found — run `npx vercel login`')
  process.exit(1)
}

const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}?teamId=${orgId}`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ rootDirectory: 'apps/web' }),
})
const body = (await res.json()) as { rootDirectory?: string; error?: { message?: string } }
console.log(
  res.ok
    ? `rootDirectory set to: ${body.rootDirectory}`
    : `failed (HTTP ${res.status}): ${body.error?.message ?? 'unknown'}`,
)
process.exit(res.ok ? 0 : 1)
