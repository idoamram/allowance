import { redirect } from 'next/navigation'

/**
 * `/account` was a second page holding half of one mental model.
 *
 * The operator's account, their agents and their tokens are three lines of a page they
 * open to answer a different question — what did my agents spend, what is waiting on me,
 * does the chain agree. Splitting those across two routes produced the failure this
 * redirect exists to end: a human who had already created an agent opened the app's home
 * and was shown an empty state telling him to go create an agent, on the other page.
 *
 * The URL stays alive rather than 404ing. It is bookmarked, it was linked from the old
 * console footer, and a redirect costs nothing — the agents section is at the fragment.
 */
export default function AccountPage() {
  redirect('/console#agents')
}
