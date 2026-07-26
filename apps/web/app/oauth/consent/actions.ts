'use server'

import { redirect } from 'next/navigation'
import { currentUser, supabaseServer } from '@/lib/supabase/server'
import { canonicalResource } from '@/lib/oauth/config'
import { recordGrant } from '@/lib/oauth/grants'

/**
 * The human's decision, and the only place a consent record is ever written.
 *
 * Two orderings matter here:
 *
 *  1. **Our grant is written before Supabase approves.** Supabase issues the token; we hold
 *     the record that binds it to this MCP server. Writing ours second would leave a window
 *     where a valid token exists with nothing tying it to this resource — the resource
 *     server would refuse it, and the operator would see a connection that "approved" and
 *     then failed. Writing it first can only leave a grant with no token, which grants
 *     nothing.
 *  2. **The details are re-read from Supabase, not taken from the form.** The client id and
 *     the scopes decide what is granted; a hidden input is attacker-controlled. The only
 *     thing trusted from the form is the human's own choice — approve, deny, and which
 *     agent.
 */
export async function decide(formData: FormData): Promise<void> {
  const authorizationId = String(formData.get('authorization_id') ?? '')
  const approved = formData.get('decision') === 'approve'
  const agentId = String(formData.get('agent_id') ?? '') || null

  if (!authorizationId) throw new Error('missing authorization_id')

  const user = await currentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(consentPath(authorizationId))}`)

  const supabase = await supabaseServer()

  if (!approved) {
    const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId, {
      skipBrowserRedirect: true,
    })
    if (error || !data) throw new Error(error?.message ?? 'could not record the refusal')
    redirect(data.redirect_url)
  }

  const { data: details, error: detailsError } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
  if (detailsError || !details) {
    throw new Error(detailsError?.message ?? 'this authorization request is no longer valid')
  }
  if (!('authorization_id' in details)) {
    // Supabase already holds a consent for this client, so there is nothing to approve.
    redirect(details.redirect_url)
  }

  await recordGrant({
    userId: user.id,
    clientId: details.client.id,
    // This deployment protects exactly one MCP resource, so the grant is for that URI.
    // Stored rather than derived at check time: moving the deployment must not silently
    // widen a consent the human gave for a different origin.
    resource: canonicalResource(),
    scope: details.scope ?? '',
    agentId,
  })

  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId, {
    skipBrowserRedirect: true,
  })
  if (error || !data) throw new Error(error?.message ?? 'could not complete the approval')
  redirect(data.redirect_url)
}

const consentPath = (id: string) => `/oauth/consent?authorization_id=${encodeURIComponent(id)}`
