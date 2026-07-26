import type { Metadata } from 'next'
import { Mark } from './(components)/mark'
import styles from './landing.module.css'

/**
 * The public landing page.
 *
 * The rule this page is built to: it shows the product's own artifacts, drawn
 * to scale, rather than illustrations of them. The plan in the hero is the plan
 * `scripts/smoke-api.ts` really submits. The envelope, drift and close figures
 * are the runs the README reports. The scale is the same instrument the
 * approval page draws (`app/p/[id]/approval.module.css`, `.scale`), so the page
 * and the product are visibly one thing.
 *
 * Every figure below traces to somewhere in this repository:
 *   plan fixture        scripts/smoke-api.ts:36
 *   tolerance → the line a step may not cross   packages/core/money.ts:31
 *   the recorded run    README.md — funded $0.05, paid $0.035, swept $0.0115
 *   the fee float       packages/chains/hedera.ts:236 — sweep leaves 0.05 ℏ
 * Nothing here is illustrative, and there is nothing on it we cannot point at.
 *
 * Server component, zero client JavaScript, no external fonts or images: a
 * strict CSP applies in production and the page has to paint before a reader
 * loses interest.
 */

export const metadata: Metadata = {
  title: 'PlanBound — your agent asks for a plan, not a payment',
  description:
    'An agent shops the task and returns a priced, reasoned plan. One human approval funds a single-use envelope the agent cannot exceed, because the money is not there to exceed.',
}

const REPO = 'https://github.com/idoamram/planbound'

/* ── The plan a human receives ──────────────────────────────────────────────
   Verbatim from the smoke-test fixture, in its own order. */
const PLAN = {
  id: 'pln_7f3a91',
  agent: 'vetting.planbound.eth',
  goal: 'Vet 3 counterparty wallets before I pay them',
  approach: 'Screen every address for sanctions first, then price risk on the ones that clear',
  fixes: ['dropped one dead endpoint', 'deduped two steps on the same host'],
  steps: [
    {
      service: 'Market diversity',
      why: 'A thin market means the risk score is not meaningful',
      rail: 'worldchain',
      quote: '$0.02',
    },
    {
      service: 'Wallet Risk X-Ray',
      why: 'A sanctioned counterparty voids the rest of the vetting',
      rail: 'base',
      quote: '$0.05',
    },
  ],
  total: '$0.07',
  ceiling: '$0.12',
  /** 0.07 / 0.12 — the bar is drawn to the ratio, not to a pleasing width. */
  quotedPct: 58.3,
}

/* ── The loop ───────────────────────────────────────────────────────────────
   Six moments. `human` marks the only one that interrupts anybody; `bound`
   marks the span that runs inside the ceiling with nobody watching.

   One line each, because the names carry the sequence and the exhibits below
   carry the argument. This list used to explain them too, and a reader met the
   same claim three times before reaching the evidence for it. */
const LOOP = [
  { name: 'Shop', sub: 'Bazaar discovery, then a live 402 probe of every candidate.' },
  { name: 'Plan', sub: 'One priced table, with a line of why per step.' },
  { name: 'Approve', sub: 'The only human moment. One decision, whole task priced.', human: true },
  { name: 'Fund', sub: 'A single-use account minted holding exactly the ceiling.', bound: true },
  { name: 'Pay', sub: 'The agent buys out of that account, co-signed step by step.', bound: true },
  { name: 'Close', sub: 'The remainder sweeps back; receipts land on HCS.', bound: true },
]

/* ── The key on the envelope account ────────────────────────────────────────
   1-of-[ 2-of-2(agent, policy), treasury ] — packages/chains/hedera.ts:174. */
const KEY_LEAVES = [
  { name: 'agent', role: 'Signs the step it wants to pay for.' },
  { name: 'policy', role: 'Signs only if the live ask still matches the approved plan.' },
]

/* ── The recorded drift ─────────────────────────────────────────────────────
   Drawn against the seller's ask, so the ask is the full width and the line
   the step may not cross sits where the arithmetic puts it: 0.012 / 0.05. */
const DRIFT = {
  quoted: '$0.010',
  allowed: '$0.012',
  asked: '$0.050',
  quotedPct: 20,
  allowedPct: 24,
}

const EXITS = [
  { name: 'Finish', body: 'Top up the exact shortfall. The run completes.' },
  { name: 'Re-plan', body: 'Re-price what remains. What was delivered is kept.' },
  { name: 'Abort', body: 'Stop here. The remainder sweeps back.' },
]

/* ── The close ──────────────────────────────────────────────────────────────
   Drawn to scale against the $0.0500 that was funded: 70 / 23 / 7. */
const CLOSE = [
  {
    name: 'Paid to sellers',
    note: 'Two steps, settled out of the envelope account itself',
    amount: '$0.0350',
    pct: 70,
    left: 0,
    swatch: styles.swatchPaid,
    seg: styles.segPaid,
  },
  {
    name: 'Swept back',
    note: 'Returned to the treasury when the plan closed',
    amount: '$0.0115',
    pct: 23,
    left: 70,
    swatch: styles.swatchBack,
    seg: styles.segBack,
  },
  {
    name: 'Fee float',
    note: 'The 0.05 ℏ the sweep leaves behind so the transfer fee can be paid',
    amount: '$0.0035',
    pct: 7,
    left: 93,
    swatch: styles.swatchFloat,
    seg: styles.segFloat,
  },
]

/**
 * What each sponsor's technology actually does here.
 *
 * ENS was on this list and has been removed: there is a nullable `agents.ens` column and
 * nothing else — no resolver, no text record, no name ever resolved. Naming a sponsor we do
 * not use is the one claim on this page that would have been outright false.
 *
 * Bullets rather than prose because this is a checklist a judge scans, not an argument.
 * Every line names a thing that exists and can be opened.
 *
 * `logo` is optional and deliberately only set for the three whose files are in
 * `public/logos/`. x402 and MCP carried paths to SVGs that were never added, so both cards
 * rendered a broken image — an audit of the page's own claims found it. A name set in the
 * card's own type is not a downgrade; a broken image is.
 */
const BUILT_ON: { name: string; logo?: string; points: string[] }[] = [
  {
    name: 'Hedera',
    logo: '/logos/hedera.svg',
    points: [
      'The envelope is a Hedera account, keyed 1-of-[2-of-2(agent, policy), treasury]',
      'Keeperless refund scheduled at mint, so an abandoned plan returns itself',
      'The envelope pays the seller directly — cap and payment, one account, one chain',
      'Every decision and receipt written to HCS',
    ],
  },
  {
    name: 'x402',
    points: [
      'Sellers discovered live through the Bazaar, never a hardcoded list',
      'Prices are real HTTP 402 quotes, badged live or estimate and never blurred',
      'One scheme-pluggable client across Hedera, Base and Worldchain',
      'The gate sits in the only path money leaves by',
    ],
  },
  {
    name: 'World',
    logo: '/logos/world.svg',
    points: [
      'Above a set ceiling, approving demands a proof an agent cannot produce',
      'Enforced server-side, not by disabling a button',
      'The nullifier binds an account to one human, so a leaked link is not enough',
      'Selfie Check integrated on the beta preset',
    ],
  },
  {
    name: 'The Graph',
    logo: '/logos/thegraph.svg',
    points: [
      'The approver checks a seller’s settlement history before funding it',
      'Claimed-against-settled reconciled against consensus, not our own database',
      'A Substreams skill anyone can install — no Rust, reaches chains Studio dropped',
    ],
  },
  {
    name: 'MCP',
    points: [
      'Seven tools, two transports, one implementation',
      'Remote server protected by OAuth 2.1 with our own consent screen',
      'Installable as a plugin from a published marketplace',
    ],
  },
]


export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.wrap}>
        <div className={styles.masthead}>
          <Mark className={styles.wordmark} title="PlanBound" />
          <nav className={styles.mastNav}>
            <a href="/console">Console</a>
            <a href="/login">Sign in</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero: the thesis, and the artifact it produces ───────────────── */}
        <section className={`${styles.wrap} ${styles.band}`}>
          <div className={styles.hero}>
            <div>
              <p className={`${styles.eyebrow} ${styles.rise}`}>
                Spend controls for autonomous agents
              </p>
              <h1 className={`${styles.h1} ${styles.rise} ${styles.rise2}`}>
                Your agent asks for a plan, not a payment.
              </h1>
              <p className={`${styles.heroLede} ${styles.rise} ${styles.rise3}`}>
                It shops the task first — real sellers, live quotes — and comes back with one
                priced, reasoned plan. <strong>One approval funds a single-use envelope</strong>{' '}
                holding exactly that ceiling. The agent runs unattended inside it and cannot
                exceed it, because the money is not there to exceed.
              </p>
              <div className={`${styles.ctas} ${styles.rise} ${styles.rise4}`}>
                <a className={styles.btn} href="/console">
                  Open the console
                </a>
                <a className={`${styles.btn} ${styles.btnGhost}`} href={REPO}>
                  Read the code
                </a>
              </div>
            </div>

            {/* The plan, as the document it is — not a picture of one. */}
            <div className={`${styles.artifact} ${styles.rise} ${styles.rise5}`}>
              <p className={styles.artifactLabel}>What the human receives</p>
              <div className={styles.sheet}>
                <div className={styles.sheetHead}>
                  <span>Plan {PLAN.id}</span>
                  <span>expires in 60 min</span>
                </div>

                <p className={styles.goal}>&ldquo;{PLAN.goal}&rdquo;</p>
                <p className={styles.agentName}>{PLAN.agent}</p>

                <p className={styles.approach}>
                  <b>Approach:</b> {PLAN.approach} &middot;{' '}
                  <span className={`${styles.stamp} ${styles.stampLive}`}>self-checked &times;2</span>
                </p>
                <ul className={styles.fixes}>
                  {PLAN.fixes.map((fix) => (
                    <li key={fix}>{fix}</li>
                  ))}
                </ul>

                <ul className={styles.steps}>
                  {PLAN.steps.map((step) => (
                    <li className={styles.step} key={step.service}>
                      <span className={styles.stepName}>{step.service}</span>
                      <span className={`${styles.stepPrice} ${styles.num}`}>{step.quote}</span>
                      <span className={styles.stepWhy}>{step.why}</span>
                      <span className={styles.stepMeta}>
                        <span className={styles.stamp}>{step.rail}</span>{' '}
                        <span className={`${styles.stamp} ${styles.stampLive}`}>live 402</span>
                      </span>
                    </li>
                  ))}
                </ul>

                <p className={styles.totalRow}>
                  <span>Total quoted</span>
                  <span className={styles.num}>{PLAN.total}</span>
                </p>

                {/* The signature, first appearance: quoted fills, the ceiling
                    stops it, the hatch between the two is drift headroom. */}
                <div className={styles.sheetScale}>
                  <p className={styles.scaleHead}>
                    <span>Quoted against ceiling</span>
                    <b>{PLAN.ceiling}</b>
                  </p>
                  <div className={styles.scale}>
                    <div
                      className={`${styles.scaleFill} ${styles.drawOnLoad}`}
                      style={{ width: `${PLAN.quotedPct}%` }}
                    />
                  </div>
                  <p className={styles.scaleFoot}>
                    <span>
                      <b>{PLAN.total}</b> quoted
                    </span>
                    <span>hatched: headroom you are approving, not spending</span>
                  </p>
                </div>

                <span className={styles.fakeBtn} aria-hidden="true">
                  Approve {PLAN.ceiling} envelope
                </span>
                <p className={styles.sheetNote}>
                  Not consent to a transaction — the creation of the budget.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── The problem, in two measured figures ─────────────────────────── */}
        <section className={`${styles.wrap} ${styles.band} ${styles.bandRule}`}>
          <div className={styles.split}>
            <div>
              <p className={styles.eyebrow}>The problem</p>
              <h2 className={styles.h2}>Neither of today&rsquo;s answers is consent.</h2>
              <p className={styles.lede}>
                An agent that spends either holds a funded key — no budget, no scope, no kill
                switch — or interrupts its human on every call until the interruptions stop meaning
                anything.
              </p>
            </div>
            <div className={styles.figures}>
              <div className={styles.datum}>
                <span className={styles.datumValue}>93%</span>
                <p className={styles.datumBody}>
                  of Claude Code permission prompts are approved. The popup arrives without the
                  context to judge it, so it gets rubber-stamped.
                </p>
                <p className={styles.source}>
                  Anthropic&rsquo;s own data, cited in{' '}
                  <a href="https://www.resilientcyber.io/p/the-human-in-the-loop-illusion">
                    The Human-in-the-Loop Illusion
                  </a>
                  , 2026.
                </p>
              </div>
              <div className={styles.datum}>
                <span className={styles.datumValue}>24.7%</span>
                <p className={styles.datumBody}>
                  of x402 endpoints publish a price at all. No total for a task exists before it
                  runs — the plan is the first moment anyone knows what it costs.
                </p>
                <p className={styles.source}>
                  <a href="https://theaicareerlab.com/blog/x402-pricing-report-2026">
                    TOLL&middot;402 census
                  </a>{' '}
                  of 78,290 routes, 2026-07-10.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── The mechanism: the loop, then the three moments after approval ─ */}
        <section className={`${styles.wrap} ${styles.band} ${styles.bandRule}`}>
          <div>
            <p className={styles.eyebrow}>The mechanism</p>
            <h2 className={styles.h2}>One decision, then a boundary that holds itself.</h2>
            <p className={styles.lede}>
              Six moments. Exactly one is yours; the rest happen inside a ceiling the thing
              spending against it cannot renegotiate.
            </p>
          </div>

          <ol className={styles.flow}>
            {LOOP.map((s) => (
              <li
                className={[
                  styles.flowStep,
                  s.human ? styles.flowHuman : '',
                  s.bound ? styles.flowBound : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={s.name}
              >
                <span className={styles.flowName}>{s.name}</span>
                <span className={styles.flowSub}>{s.sub}</span>
              </li>
            ))}
          </ol>

          <p className={styles.flowLegend}>
            The shaded span runs unattended, with <b>no further approval and no way to exceed the
            ceiling</b> — the agent holds no funds of its own.
          </p>

          <div className={styles.exhibits}>
            {/* Exhibit: the envelope ------------------------------------------------ */}
            <article className={styles.exhibit}>
              <div>
                <span className={styles.exhibitTag}>Envelope</span>
                <h3 className={styles.exhibitTitle}>
                  The cap is a balance, not a row in a database.
                </h3>
                <p className={styles.exhibitBody}>
                  Approval mints an account funded with exactly the ceiling. No service in the
                  middle can fail open, because there is none — the ceiling is{' '}
                  <em>how much money exists</em>.
                </p>
              </div>
              <div className={styles.plate}>
                <p className={styles.plateTitle}>Envelope minted &middot; Hedera testnet</p>
                <p className={styles.scaleHead}>
                  <span>Funded</span>
                  <b>$0.0500</b>
                </p>
                <div className={styles.scale}>
                  <div
                    className={`${styles.scaleFill} ${styles.drawOnScroll}`}
                    style={{ width: '100%' }}
                  />
                </div>
                <p className={styles.scaleFoot}>
                  <span>
                    Ceiling <b>$0.0500</b>
                  </span>
                  <span>filled to the edge, and no further</span>
                </p>

                <div className={styles.key}>
                  <p className={styles.plateTitle}>Who can move it</p>
                  <p className={styles.keyExpr}>1-of-[ 2-of-2(agent, policy), treasury ]</p>
                  <ul className={styles.keyTree}>
                    <li className={styles.keyNode}>
                      <span className={styles.keyName}>2-of-2</span>
                      <span className={styles.keyRole}>
                        Both signatures, or the transaction does not exist.
                      </span>
                      <ul className={styles.keySub}>
                        {KEY_LEAVES.map((leaf) => (
                          <li className={styles.keyNode} key={leaf.name}>
                            <span className={styles.keyName}>{leaf.name}</span>
                            <span className={styles.keyRole}>{leaf.role}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                    <li className={styles.keyNode}>
                      <span className={styles.keyName}>treasury</span>
                      <span className={styles.keyRole}>
                        Funds the envelope and reclaims the remainder at expiry. Never spends on
                        the agent&rsquo;s behalf.
                      </span>
                    </li>
                  </ul>
                  <p className={styles.keyNote}>
                    The agent can propose a payment, never complete one alone.
                  </p>
                </div>
              </div>
            </article>

            {/* Exhibit: drift ------------------------------------------------------- */}
            <article className={styles.exhibit}>
              <div>
                <span className={styles.exhibitTag}>Drift</span>
                <h3 className={styles.exhibitTitle}>
                  The wall is the plan, not the balance.
                </h3>
                <p className={styles.exhibitBody}>
                  A step quoted at {DRIFT.quoted} met a real seller asking {DRIFT.asked}. The gate
                  blocked it <em>even though the envelope held enough to pay</em>, because the plan
                  the human approved was not the plan the agent found. What reaches you is a diff,
                  with a price on every way out.
                </p>
              </div>
              <div className={styles.plate}>
                <p className={styles.plateTitle}>Step blocked &middot; recorded run</p>
                <p className={styles.scaleHead}>
                  <span>Seller&rsquo;s live ask</span>
                  <b>{DRIFT.asked}</b>
                </p>
                <div className={styles.scale}>
                  <div className={`${styles.scaleGroup} ${styles.drawOnScroll}`}>
                    <div
                      className={`${styles.scaleSeg} ${styles.segPaid}`}
                      style={{ left: 0, width: `${DRIFT.quotedPct}%` }}
                    />
                    <div
                      className={`${styles.scaleSeg} ${styles.segOver}`}
                      style={{
                        left: `${DRIFT.allowedPct}%`,
                        width: `${100 - DRIFT.allowedPct}%`,
                      }}
                    />
                  </div>
                  <div className={styles.scaleStop} style={{ left: `${DRIFT.allowedPct}%` }} />
                </div>
                <p className={styles.scaleFoot}>
                  <span>
                    Quoted <b>{DRIFT.quoted}</b>
                  </span>
                  <span>
                    Stops at <b>{DRIFT.allowed}</b> — quote plus the 20% tolerance
                  </span>
                </p>

                <ul className={styles.exits}>
                  {EXITS.map((e) => (
                    <li className={styles.exit} key={e.name}>
                      <span className={styles.exitName}>{e.name}</span>
                      <p className={styles.exitBody}>{e.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </article>

            {/* Exhibit: the close --------------------------------------------------- */}
            <article className={styles.exhibit}>
              <div>
                <span className={styles.exhibitTag}>Close</span>
                <h3 className={styles.exhibitTitle}>Every cent of the ceiling, accounted for.</h3>
                <p className={styles.exhibitBody}>
                  One loop end to end on Hedera testnet: quoted, approved on a phone, an envelope
                  minted, and the seller paid out of that same account. Quoted equals paid; the
                  remainder came back.
                </p>
              </div>
              <div className={styles.plate}>
                <p className={styles.plateTitle}>Plan closed &middot; funded $0.0500</p>
                <div className={styles.scale}>
                  <div className={`${styles.scaleGroup} ${styles.drawOnScroll}`}>
                    {CLOSE.map((seg) => (
                      <div
                        key={seg.name}
                        className={`${styles.scaleSeg} ${seg.seg}`}
                        style={{ left: `${seg.left}%`, width: `${seg.pct}%` }}
                      />
                    ))}
                  </div>
                </div>
                {/* The three parts do not sum to what was funded by accident —
                    they sum to it exactly, which is the claim. */}
                <p className={styles.scaleFoot}>
                  <span>Paid + swept + float</span>
                  <span>
                    <b>$0.0500</b> — the whole ceiling, nothing unaccounted
                  </span>
                </p>
                <ul className={styles.ledger}>
                  {CLOSE.map((seg) => (
                    <li className={styles.ledgerRow} key={seg.name}>
                      <span className={`${styles.swatch} ${seg.swatch}`} aria-hidden="true" />
                      <span className={styles.ledgerName}>{seg.name}</span>
                      <span className={`${styles.ledgerAmt} ${styles.num}`}>{seg.amount}</span>
                      <span className={styles.ledgerNote}>{seg.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </div>

          <div className={styles.honesty}>
            <p className={styles.plateTitle}>Stated plainly</p>
            <ul className={styles.honestyList}>
              <li>Hedera testnet, faucet funds. Mainnet purchases stay off until you turn them on.</li>
              <li>
                The Hedera-rail seller is <em>ours</em> — no Hedera x402 market exists yet. Every
                other seller is a stranger found through the Bazaar.
              </li>
              <li>
                Policy logic runs off-chain. The 2-of-2 key is what makes bypassing it impossible,
                not the chain.
              </li>
              <li>
                The drift above is our own estimate meeting a real ask. The rest of what is and
                isn&rsquo;t proven is in the <a href={`${REPO}#honesty-box`}>honesty box</a>.
              </li>
            </ul>
          </div>
        </section>

        {/* ── The sentence the page exists to deliver ──────────────────────── */}
        <section className={styles.quoteBand}>
          <div className={`${styles.wrap} ${styles.band}`}>
            <blockquote className={styles.quote}>
              Others give the agent a funded wallet and enforce the limit in their own service. We
              give the agent <em>zero funds</em> and let consensus enforce the cap.
              <span className={styles.quoteWho}>The one-sentence difference</span>
            </blockquote>
          </div>
        </section>

        {/* ── Built on ─────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.band}`}>
          <div className={styles.split}>
            <div>
              <p className={styles.eyebrow}>Built on</p>
              <h2 className={styles.h2}>Each piece does real work.</h2>
              <p className={styles.lede}>
                Not a logo wall. Every line below is something you can open, run, or check
                against a chain.
              </p>
            </div>
            <div className={styles.rails}>
              {BUILT_ON.map((r) => (
                <div className={styles.rail} key={r.name}>
                  <div className={styles.railHead}>
                    {r.logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.railLogo} src={r.logo} alt="" aria-hidden="true" />
                    )}
                    <span className={styles.railName}>{r.name}</span>
                  </div>
                  <ul className={styles.railPoints}>
                    {r.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Connect it ───────────────────────────────────────────────────
            The one claim on this page a reader can check in thirty seconds
            without trusting us, so it is written to be pasted rather than
            admired. Everything above describes what the product does; this is
            the part where they do it. */}
        <section className={`${styles.wrap} ${styles.band} ${styles.bandRule}`}>
          <div className={styles.split}>
            <div>
              <p className={styles.eyebrow}>Connect it</p>
              <h2 className={styles.h2}>Point your agent at it.</h2>
              <p className={styles.lede}>
                Seven tools over the Model Context Protocol. Claude Code registers itself, sends
                you to our consent screen, and comes back with a token scoped to one agent — no
                key to copy, and nothing that can spend until you approve a plan.
              </p>
            </div>
            <div className={styles.rails}>
              <div className={styles.rail}>
                <span className={styles.railName}>Remote, over OAuth</span>
                <pre className={styles.cmd}>
                  <code>claude mcp add --transport http planbound https://planbound.xyz/api/mcp/http</code>
                </pre>
                <p className={styles.railBody}>
                  Then <code>/mcp</code> &rarr; authenticate. You approve on a screen that says
                  exactly what the agent may do, and what it may not.
                </p>
              </div>
              <div className={styles.rail}>
                <span className={styles.railName}>As a plugin</span>
                <pre className={styles.cmd}>
                  <code>claude plugin marketplace add idoamram/planbound</code>
                  <code>claude plugin install planbound@planbound</code>
                </pre>
                <p className={styles.railBody}>
                  The tools, plus the skills &mdash; including a generic Substreams indexer for
                  reading settlements straight off a chain.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.band} ${styles.bandRule}`}>
          <h2 className={styles.h2}>See a plan, priced and reasoned.</h2>
          <p className={styles.closingLede}>
            The console lists real plans with their receipts, and diffs what we claim against what
            actually settled on-chain.
          </p>
          <div className={styles.ctas}>
            <a className={styles.btn} href="/console">
              Open the console
            </a>
            <a className={`${styles.btn} ${styles.btnGhost}`} href={REPO}>
              Read the code
            </a>
          </div>
        </section>
      </main>

      <footer className={styles.wrap}>
        <div className={styles.footer}>
          <span>PlanBound &middot; MIT licensed</span>
          <nav className={styles.footerNav}>
            <a href="/console">Console</a>
            <a href="/login">Sign in</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
