/**
 * Configure the Vercel project for this pnpm monorepo.
 *
 * Root Directory is a project setting (not expressible in vercel.json), and Vercel's
 * Next.js detector runs inside it — in a workspace the app lives in apps/web while the
 * lockfile lives at the repo root. Framework and the build/output overrides are set
 * explicitly here so a stale override can't silently turn the app into a static build.
 *
 * Reads the CLI's stored token; never prints it.
 * Usage: pnpm vercel:config [--show]
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

const api = `https://api.vercel.com/v9/projects/${projectId}?teamId=${orgId}`
const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }

const show = async (label: string) => {
  const p = (await (await fetch(api, { headers })).json()) as Record<string, unknown>
  console.log(
    `${label}: rootDirectory=${p.rootDirectory} framework=${p.framework} ` +
      `build=${JSON.stringify(p.buildCommand)} install=${JSON.stringify(p.installCommand)} ` +
      `output=${JSON.stringify(p.outputDirectory)}`,
  )
}

await show('before')

if (!process.argv.includes('--show')) {
  const res = await fetch(api, {
    method: 'PATCH',
    headers,
    // null clears an override and restores Vercel's framework default.
    body: JSON.stringify({
      rootDirectory: 'apps/web',
      framework: 'nextjs',
      buildCommand: null,
      installCommand: null,
      outputDirectory: null,
    }),
  })
  if (!res.ok) {
    const body = (await res.json()) as { error?: { message?: string } }
    console.error(`failed (HTTP ${res.status}): ${body.error?.message ?? 'unknown'}`)
    process.exit(1)
  }
  await show('after ')
}

// Deployment Protection puts an SSO wall in front of every URL. An approval link has to
// open on a phone with no Vercel account, so production must be public.
const proj = (await (await fetch(api, { headers })).json()) as Record<string, any>
console.log('ssoProtection:', JSON.stringify(proj.ssoProtection), '| passwordProtection:', JSON.stringify(proj.passwordProtection))
if (!process.argv.includes('--show') && proj.ssoProtection !== null) {
  const r = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify({ ssoProtection: null }) })
  console.log(r.ok ? 'ssoProtection: disabled' : `ssoProtection: failed (HTTP ${r.status})`)
}
