import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { currentUser, supabaseServer } from '@/lib/supabase/server'
import { canonicalResource } from '@/lib/oauth/config'
import { decide } from './actions'
import styles from './consent.module.css'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A consent screen has no business in a search index or a link preview. */
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * The authorization endpoint — the screen Supabase sends a human to before it will mint a
 * token for an agent.
 *
 * Supabase issues the token; the approval is ours to ask for. That split is why this page
 * exists at all, and it is the only place in the product where a person reads what an agent
 * is about to be allowed to do. So it says the true thing rather than the generic one: this
 * grant lets an agent *ask*, and lets it spend only from envelopes the same human approves
 * one at a time. It is not a funded wallet, and it is not permission to approve its own
 * plans.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams

  if (!authorizationId) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>Nothing to approve</h1>
          <p className={styles.body}>
            This page is the last step of an app connecting to PlanBound. Open it from that
            app rather than directly — on its own it carries no request.
          </p>
        </section>
      </main>
    )
  }

  const user = await currentUser()
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`,
    )
  }

  const supabase = await supabaseServer()
  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(
    authorizationId,
  )

  if (error || !details) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>This request expired</h1>
          <p className={styles.body}>
            {error?.message ??
              'The connection request is no longer valid. Start the connection again from the app.'}
          </p>
        </section>
      </main>
    )
  }

  // Already consented: Supabase hands back the finished redirect and there is nothing to ask.
  if (!('authorization_id' in details)) redirect(details.redirect_url)

  // Read through the cookie-bound client, so the ownership policies from migration 0004 —
  // not a `where` clause we remembered to write — decide which agents appear.
  const { data: agentRows } = await supabase
    .from('agents')
    .select('id, name')
    .order('created_at', { ascending: true })
  const agents = (agentRows ?? []) as { id: string; name: string }[]

  const scopes = (details.scope ?? '').split(/\s+/).filter(Boolean)

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Connect an agent</p>
        <h1 className={styles.title}>
          <strong>{details.client.name || 'An unnamed app'}</strong> wants to act as your agent
          on PlanBound
        </h1>

        <dl className={styles.facts}>
          <div>
            <dt>Signed in as</dt>
            <dd>{user!.email}</dd>
          </div>
          <div>
            <dt>Sends you back to</dt>
            <dd className={styles.mono}>{details.redirect_uri}</dd>
          </div>
          <div>
            <dt>For</dt>
            <dd className={styles.mono}>{canonicalResource()}</dd>
          </div>
          {scopes.length > 0 && (
            <div>
              <dt>Scopes requested</dt>
              <dd className={styles.mono}>{scopes.join(' · ')}</dd>
            </div>
          )}
        </dl>

        <h2 className={styles.h2}>What this lets it do</h2>
        <ul className={styles.can}>
          <li>Shop a task for real prices and submit a priced plan for your approval.</li>
          <li>Wait for your decision, and read the plans it submitted.</li>
          <li>
            Spend <em>only</em> from an envelope you approve separately, plan by plan, never
            above the ceiling you set.
          </li>
        </ul>

        <h2 className={styles.h2}>What it cannot do</h2>
        <ul className={styles.cannot}>
          <li>
            <strong>Approve its own plans.</strong> Every plan still comes to you, on a page
            the agent cannot reach.
          </li>
          <li>
            <strong>Spend beyond a ceiling.</strong> The money in an envelope is the limit —
            there is no balance behind it to overrun.
          </li>
          <li>
            <strong>Touch your account or your other agents.</strong> This connection covers
            the one agent below and nothing else.
          </li>
        </ul>

        <form action={decide} className={styles.form}>
          <input type="hidden" name="authorization_id" value={authorizationId} />

          {agents.length === 0 ? (
            <p className={styles.warn}>
              This account owns no agent yet, so there is nothing for this app to act as.
              Create one first — approving now would connect an app that cannot do anything.
            </p>
          ) : agents.length === 1 ? (
            <>
              <input type="hidden" name="agent_id" value={agents[0]!.id} />
              <p className={styles.acting}>
                Acting as <span className={styles.mono}>{agents[0]!.name}</span>
              </p>
            </>
          ) : (
            <label className={styles.picker}>
              <span>Acting as</span>
              {/* Named, never guessed: several agents means the human chooses which
                  identity submits plans, because identity is what this product asks
                  people to trust. */}
              <select name="agent_id" defaultValue={agents[0]!.id} required>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.actions}>
            <button
              type="submit"
              name="decision"
              value="approve"
              className={styles.approve}
              disabled={agents.length === 0}
            >
              Approve
            </button>
            <button type="submit" name="decision" value="deny" className={styles.deny}>
              Refuse
            </button>
          </div>
        </form>

        <p className={styles.foot}>
          You can withdraw this at any time; tokens already issued stop working at their next
          request.
        </p>
      </section>
    </main>
  )
}
