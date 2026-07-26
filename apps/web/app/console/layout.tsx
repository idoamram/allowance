import { AppNav } from '@/app/(components)/app-nav'
import { requireUser } from '@/lib/supabase/server'

/**
 * The signed-in app's shell.
 *
 * The nav mounts here rather than in the root layout because the root layout also renders
 * the approval page and the consent screen, and neither may carry app chrome — see the
 * note on `AppNav`. Mounting at the segment gives the operator surface and anything nested
 * under it a persistent header, and gives those two routes nothing, without a client-side
 * pathname check deciding it at runtime.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  return (
    <>
      <AppNav email={user.email} />
      {children}
    </>
  )
}
