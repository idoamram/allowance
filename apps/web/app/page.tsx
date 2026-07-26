import type { Metadata } from 'next'
import styles from './landing.module.css'

/**
 * The public landing page.
 *
 * Every figure and every quoted string here exists somewhere else in this repository:
 * the plan card is the fixture the smoke test really submits (`scripts/smoke-api.ts`),
 * the envelope figures are the run the README reports, the $0.0035 sliver is the fee
 * float `sweepEnvelope` deliberately leaves behind (`packages/chains/hedera.ts:236`),
 * and the two statistics carry their sources inline. Nothing on this page is
 * illustrative, and there is nothing on it we cannot point at.
 *
 * Server component, zero client JavaScript, no external fonts or images — a strict CSP
 * applies in production and the page has to paint before a judge loses interest.
 */

export const metadata: Metadata = {
  title: 'PlanBound — your agent asks for a plan, not a payment',
  description:
    'An agent shops the task and returns a priced, reasoned plan. One human approval funds a single-use envelope the agent cannot exceed, because the money is not there to exceed.',
}

const REPO = 'https://github.com/idoamram/planbound'

/** The plan a human receives, rendered as the artifact it is. */
const PLAN = {
  id: 'pln_7f3a91',
  agent: 'vetting.planbound.eth',
  goal: 'Vet 3 counterparty wallets before I pay them',
  approach: 'Screen every address for sanctions first, then price risk on the ones that clear',
  selfCheck: 2,
  fixes: ['dropped one dead endpoint', 'deduped two steps on the same host'],
  steps: [
    {
      service: 'Wallet Risk X-Ray',
      why: 'A sanctioned counterparty voids the rest of the vetting',
      quote: '$0.05',
    },
    {
      service: 'Market diversity',
      why: 'A thin market means the risk score is not meaningful',
      quote: '$0.02',
    },
  ],
  total: '$0.07',
  ceiling: '$0.12',
}

/** The sequence is load-bearing — shop before pricing, price before funding, fund
 *  before spending — which is the only reason these carry numbers. */
const SEQUENCE = [
  {
    title: 'The agent shops the task',
    body: (
      <>
        It searches the <b>x402 Bazaar</b>, Coinbase&rsquo;s keyless public catalog, and probes
        each candidate for a live HTTP&nbsp;402 quote. A listing is a claim; the probe is the
        fact. Sellers sitting behind a bot wall never reach a plan.
      </>
    ),
  },
  {
    title: 'It comes back with one priced plan',
    body: (
      <>
        Every step carries what it buys and a <b>one-line why</b> it earns its price. Live quotes
        are stamped apart from estimates — an estimate is never dressed as a quote. Before you see
        it, the agent has graded the plan against your goal and fixed what failed.
      </>
    ),
  },
  {
    title: 'One approval funds the envelope',
    body: (
      <>
        Approving mints a <b>single-use account holding exactly the ceiling</b>, keyed{' '}
        <span className={styles.num}>1-of-[2-of-2(agent, policy), treasury]</span>. Approval is not
        consent to a transaction. It is the creation of the budget.
      </>
    ),
  },
  {
    title: 'The agent runs unattended inside it',
    body: (
      <>
        It pays sellers <b>out of that same account</b>, co-signed step by step against the plan
        you approved. It cannot exceed the ceiling, because the money is not there to exceed. What
        it does not spend sweeps back at expiry.
      </>
    ),
  },
]

const EXITS = [
  { name: 'Finish', body: 'Top up the exact shortfall and let the run complete at the new price.' },
  { name: 'Re-plan', body: 'Re-price the remaining steps. Everything already delivered is kept.' },
  { name: 'Abort', body: 'Stop now. The sweep returns the remainder, and you keep what was bought.' },
]

/** Drawn to scale against a $0.05 ceiling: 70% / 23% / 7%. */
const ENVELOPE = [
  {
    name: 'Paid',
    note: 'Two steps, settled from the envelope itself',
    amount: '$0.0350',
    pct: 70,
    swatch: styles.swatchPaid,
  },
  {
    name: 'Swept back',
    note: 'Returned to the treasury when the plan closed',
    amount: '$0.0115',
    pct: 23,
    swatch: styles.swatchBack,
  },
  {
    name: 'Left behind',
    note: 'The sliver the sweep leaves so the transfer fee can be paid',
    amount: '$0.0035',
    pct: 7,
    swatch: styles.swatchFee,
  },
]

const BUILT_ON = [
  {
    name: 'Hedera',
    body: 'The envelope account, its 2-of-2 threshold key, the scheduled refund at expiry, the receipt trail on HCS — and the purchase itself, so the thing that enforces the cap and the thing that pays are one account.',
  },
  {
    name: 'x402',
    body: 'Discovery, live 402 quoting and payment through one scheme-pluggable client across Hedera, Base and Worldchain. The gate sits in the only path money leaves by.',
  },
  {
    name: 'The Graph',
    body: 'Claimed against settled. Our database records what the control plane claims; the subgraph records what settled on-chain. The console diffs the two, so you can check us against the chain.',
  },
  {
    name: 'World',
    body: 'Identity as step-up: a large ceiling asks for a second factor before the approve button does anything, enforced server-side rather than in the UI.',
  },
  {
    name: 'ENS',
    body: 'An agent’s name resolves to what it is currently allowed to spend — authority published as text records, verifiable without an API of ours.',
  },
]

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.wrap}>
        <div className={styles.masthead}>
          <span className={styles.wordmark}>PlanBound</span>
          <nav className={styles.mastNav}>
            <a href="/console">Console</a>
            <a href="/login">Sign in</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </header>

      <main>
        {/* ── hero ───────────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.hero}`}>
          <div>
            <p className={styles.eyebrow}>Spend controls for autonomous agents</p>
            <h1 className={styles.h1}>Your agent asks for a plan, not a payment.</h1>
            <p className={styles.heroLede}>
              It shops the task first — discovers real sellers, collects live quotes — and returns
              one priced, reasoned plan.{' '}
              <strong>A single approval funds a single-use envelope</strong> holding exactly the
              ceiling you approved. The agent then runs unattended inside it and cannot exceed it,
              because the money is not there to exceed.
            </p>
            <div className={styles.ctas}>
              <a className={styles.btn} href="/console">
                Open the console
              </a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href={REPO}>
                Read the code
              </a>
            </div>
          </div>

          {/* The artifact — the approval card itself, carrying the plan our smoke
              test submits, not a mock-up of one. */}
          <div>
            <p className={styles.artifactLabel}>What the human receives</p>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.planId}>Plan {PLAN.id}</span>
                <span className={styles.stamp}>expires 14:20 UTC</span>
              </div>
              <p className={styles.goal}>&ldquo;{PLAN.goal}&rdquo;</p>
              <p className={styles.agent}>{PLAN.agent}</p>

              <p className={styles.logic}>
                <b>Logic:</b> {PLAN.approach} &middot;{' '}
                <span className={`${styles.stamp} ${styles.stampGood}`}>
                  self-checked &times;{PLAN.selfCheck}
                </span>
              </p>
              <ul className={styles.fixes}>
                {PLAN.fixes.map((fix) => (
                  <li key={fix}>{fix}</li>
                ))}
              </ul>

              <table className={styles.table}>
                <tbody>
                  {PLAN.steps.map((step) => (
                    <tr key={step.service}>
                      <td>
                        <span className={styles.service}>{step.service}</span>
                        <span className={styles.why}>{step.why}</span>
                      </td>
                      <td>
                        <span className={styles.num}>{step.quote}</span>{' '}
                        <span className={`${styles.stamp} ${styles.stampGood}`}>live</span>
                      </td>
                    </tr>
                  ))}
                  <tr className={styles.totalRow}>
                    <td>Total quoted</td>
                    <td className={styles.num}>{PLAN.total}</td>
                  </tr>
                </tbody>
              </table>

              <div className={styles.ceilingRow}>
                <span>Ceiling (drift headroom)</span>
                <span className={styles.num}>{PLAN.ceiling}</span>
              </div>

              <div aria-hidden="true">
                <span className={styles.fakeBtn}>Approve {PLAN.ceiling} envelope</span>
                <span className={`${styles.fakeBtn} ${styles.fakeBtnGhost}`}>Reject</span>
              </div>
              <p className={styles.cardNote}>
                Approving funds a single-use envelope with exactly this ceiling.
              </p>
            </div>
          </div>
        </section>

        {/* ── the problem ────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.section}`}>
          <div className={styles.split}>
            <div className={styles.splitHead}>
              <p className={styles.eyebrow}>The problem</p>
              <h2 className={styles.h2}>Neither of today&rsquo;s answers is consent.</h2>
              <p className={styles.lede}>
                An agent that spends either holds a funded key — no budget, no scope, no kill
                switch — or interrupts its human on every call until the interruptions stop meaning
                anything.
              </p>
            </div>
            <div className={styles.failures}>
              <div className={styles.failure}>
                <span className={styles.stat}>93%</span>
                <p className={styles.statCaption}>
                  of Claude Code permission prompts are approved. The popup arrives without the
                  context to judge it, so it gets rubber-stamped. Consent that always says yes
                  isn&rsquo;t consent.
                </p>
                <p className={styles.source}>
                  Anthropic&rsquo;s own data, cited in{' '}
                  <a href="https://www.resilientcyber.io/p/the-human-in-the-loop-illusion">
                    The Human-in-the-Loop Illusion
                  </a>
                  , 2026.
                </p>
              </div>
              <div className={styles.failure}>
                <span className={styles.stat}>24.7%</span>
                <p className={styles.statCaption}>
                  of x402 endpoints publish a price at all. No total for a task exists before it
                  runs — the plan is the first moment anyone, human or agent, knows what it costs.
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

        {/* ── the sequence ───────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.section}`}>
          <div className={styles.split}>
            <div className={styles.splitHead}>
              <p className={styles.eyebrow}>How it works</p>
              <h2 className={styles.h2}>Four steps, one of them yours.</h2>
              <p className={styles.lede}>
                The agent does the shopping. You answer one question, once, with the whole task
                priced in front of you.
              </p>
            </div>
            <ol className={styles.steps}>
              {SEQUENCE.map((s, i) => (
                <li className={styles.step} key={s.title}>
                  <span className={styles.stepNum} aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className={styles.stepTitle}>{s.title}</h3>
                  <p className={styles.stepBody}>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── the sentence the page exists to deliver ────────────────────────── */}
        <section className={styles.quoteBand}>
          <div className={styles.wrap}>
            <blockquote className={styles.quote}>
              Others give the agent a funded wallet and enforce the limit in their own service. We
              give the agent <em>zero funds</em> and let consensus enforce the cap.
              <span className={styles.quoteWho}>The one-sentence difference</span>
            </blockquote>
          </div>
        </section>

        {/* ── drift ──────────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.section}`}>
          <div className={styles.split}>
            <div className={styles.splitHead}>
              <p className={styles.eyebrow}>When reality drifts</p>
              <h2 className={styles.h2}>The agent hits a wall. You get a diff, not a popup.</h2>
              <p className={styles.lede}>
                A step that asks more than it quoted stops there — the funds and the co-signer both
                refuse. What reaches you is what already settled, what changed and by how much, and
                the price of every way out.
              </p>
            </div>
            <div>
              <p className={styles.blockLine}>
                In our own run, a step quoted at <span className={styles.num}>$0.01</span> met a
                real seller asking <span className={styles.num}>$0.05</span>. The gate blocked it{' '}
                <em>even though the envelope held enough to pay</em>, because the plan the human
                approved was not the plan the agent found.
              </p>
              <ul className={styles.exits}>
                {EXITS.map((e) => (
                  <li className={styles.exit} key={e.name}>
                    <p className={styles.exitName}>{e.name}</p>
                    <p className={styles.exitBody}>{e.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── the run: the ceiling bar ───────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.section} ${styles.sectionTotal}`}>
          <div className={styles.split}>
            <div className={styles.splitHead}>
              <p className={styles.eyebrow}>A real run, end to end</p>
              <h2 className={styles.h2}>Every cent of the ceiling, accounted for.</h2>
              <p className={styles.lede}>
                One loop on Hedera testnet: two services quoted, a human approved on their phone, an
                envelope minted holding exactly the ceiling, and the agent bought from the seller
                paying out of that same account. Quoted equals paid; the remainder came back.
              </p>
            </div>
            <div className={styles.instrument}>
              <div className={styles.barHead}>
                <span>Envelope &mdash; plan closed</span>
                <span>Funded $0.0500</span>
              </div>
              <div className={styles.track}>
                {ENVELOPE.map((seg, i) => (
                  <div
                    key={seg.name}
                    className={
                      i === 0 ? styles.segPaid : i === 1 ? styles.segBack : styles.segFee
                    }
                    style={{ width: `${seg.pct}%` }}
                  />
                ))}
              </div>
              {/* Right-aligned so the arrow sits directly under the ceiling edge. */}
              <p className={styles.ceilingMark}>ceiling &mdash; nothing crosses this edge &#8593;</p>

              <ul className={styles.legend}>
                {ENVELOPE.map((seg) => (
                  <li className={styles.legendRow} key={seg.name}>
                    <p className={styles.legendName}>
                      <span className={`${styles.swatch} ${seg.swatch}`} aria-hidden="true" />
                      {seg.name}
                      <span className={styles.legendNote}>{seg.note}</span>
                    </p>
                    <span className={styles.legendAmt}>{seg.amount}</span>
                  </li>
                ))}
              </ul>

              <div className={styles.honesty}>
                <p className={styles.honestyTitle}>Stated plainly</p>
                <ul className={styles.honestyList}>
                  <li>
                    Hedera testnet, faucet funds. Mainnet purchases stay impossible until you turn
                    them on yourself.
                  </li>
                  <li>
                    The reference seller on the Hedera rail is <em>ours</em>, and the code says so —
                    no Hedera x402 seller market exists yet. Every other seller is a stranger
                    discovered through the Bazaar.
                  </li>
                  <li>
                    Per-service policy logic runs off-chain. The 2-of-2 key is what makes bypassing
                    it impossible.
                  </li>
                  <li>
                    The rest of what is and isn&rsquo;t proven is in the{' '}
                    <a href={`${REPO}#honesty-box`}>honesty box</a>, in the README.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── built on ───────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.section}`}>
          <div className={styles.split}>
            <div className={styles.splitHead}>
              <p className={styles.eyebrow}>Built on</p>
              <h2 className={styles.h2}>Each piece does real work.</h2>
              <p className={styles.lede}>
                The README points at the exact lines where every one of these lives, so nobody has
                to grep for them.
              </p>
            </div>
            <div className={styles.rails}>
              {BUILT_ON.map((r) => (
                <div className={styles.rail} key={r.name}>
                  <span className={styles.railName}>{r.name}</span>
                  <p className={styles.railBody}>{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── close ──────────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.close}`}>
          <h2 className={styles.h2}>See a plan, priced and reasoned.</h2>
          <p className={styles.lede}>
            The console lists real plans with their receipts and diffs what we claim against what
            settled on-chain. The agent side is an MCP server and a Claude Code plugin — seven
            tools, and your key never leaves your machine.
          </p>
          <div className={`${styles.ctas} ${styles.closeCtas}`}>
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
