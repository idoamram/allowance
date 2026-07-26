'use client'

import { useActionState, useEffect, useState } from 'react'
import type { OwnedAgent } from '@/lib/accounts'
import {
  createAgentAction,
  rotateAgentTokenAction,
  deleteAgentAction,
  type TokenState,
  type PlainState,
} from './actions'
import { TokenReveal } from './token-reveal'
import styles from './agents.module.css'

type Reveal = { token: string; agentName: string; kind: 'created' | 'rotated' }

/**
 * Everything on this page that can mint or destroy a credential.
 *
 * It is one client component because a token is only ever readable inside React state:
 * whichever action produced it — create or rotate — hands it to the same reveal panel, and
 * when that panel is dismissed the value is dropped and cannot be got back.
 */
export function AgentsPanel({ agents }: { agents: OwnedAgent[] }) {
  const [reveal, setReveal] = useState<Reveal | null>(null)

  return (
    <>
      {agents.length === 0 ? (
        <p className={styles.empty}>
          You have no agents. Create one below &mdash; you get a token back once, the agent
          sets it as <code>PLANBOUND_AGENT_TOKEN</code>, and it can start submitting plans for
          you to approve.
        </p>
      ) : (
        <ul className={styles.agentList}>
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onToken={setReveal} />
          ))}
        </ul>
      )}

      <CreateAgent onToken={setReveal} />


      {reveal && (
        <TokenReveal
          token={reveal.token}
          agentName={reveal.agentName}
          kind={reveal.kind}
          onClose={() => setReveal(null)}
        />
      )}
    </>
  )
}

function CreateAgent({ onToken }: { onToken: (r: Reveal) => void }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(createAgentAction, {})

  useEffect(() => {
    if (state.token) {
      onToken({ token: state.token, agentName: state.agentName ?? 'this agent', kind: 'created' })
    }
  }, [state.token, state.agentName, onToken])

  return (
    <form action={action} className={styles.create}>
      <label className={styles.label} htmlFor="agentName">
        New agent
      </label>
      <div className={styles.createRow}>
        <input
          id="agentName"
          name="name"
          className={styles.input}
          required
          minLength={2}
          maxLength={60}
          autoComplete="off"
          placeholder="research-buyer"
        />
        <button type="submit" className={styles.btn} disabled={pending}>
          {pending ? 'Creating…' : 'Create agent'}
        </button>
      </div>
      <p className={styles.hint}>
        Creating an agent issues one bearer token, shown once and never again. It says which
        agent is asking; it holds no funds and cannot approve a plan.
      </p>
      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
    </form>
  )
}

function AgentRow({ agent, onToken }: { agent: OwnedAgent; onToken: (r: Reveal) => void }) {
  const [confirming, setConfirming] = useState<'rotate' | 'delete' | null>(null)
  const [rotateState, rotate, rotating] = useActionState<TokenState, FormData>(
    rotateAgentTokenAction,
    {},
  )
  const [deleteState, remove, removing] = useActionState<PlainState, FormData>(
    deleteAgentAction,
    {},
  )

  useEffect(() => {
    if (rotateState.token) {
      onToken({
        token: rotateState.token,
        agentName: rotateState.agentName ?? agent.name,
        kind: 'rotated',
      })
      setConfirming(null)
    }
  }, [rotateState.token, rotateState.agentName, agent.name, onToken])

  const created = new Date(agent.createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  return (
    <li className={styles.agent}>
      <div className={styles.agentHead}>
        <span className={styles.agentName}>{agent.name}</span>
        {agent.ens && <span className={styles.stamp}>{agent.ens}</span>}
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Plans</dt>
          <dd className={styles.num}>{agent.planCount}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{created}</dd>
        </div>
        <div>
          <dt>Signing key</dt>
          <dd className={styles.key}>
            {agent.hederaPublicKey ? `${agent.hederaPublicKey.slice(0, 14)}…` : 'not registered'}
          </dd>
        </div>
      </dl>

      {confirming === null && (
        <div className={styles.rowActions}>
          <button
            type="button"
            className={`${styles.rowBtn}`}
            onClick={() => setConfirming('rotate')}
          >
            Rotate token
          </button>
          <button
            type="button"
            className={`${styles.rowBtn} ${styles.rowBtnStop}`}
            onClick={() => setConfirming('delete')}
          >
            Delete agent
          </button>
        </div>
      )}

      {confirming === 'rotate' && (
        <form action={rotate} className={styles.confirm}>
          <input type="hidden" name="agentId" value={agent.id} />
          <input type="hidden" name="agentName" value={agent.name} />
          <p className={styles.confirmText}>
            Rotating issues a new token and retires the current one the same instant &mdash;
            there is no overlap. Any running copy of <b>{agent.name}</b> starts getting 401s
            and stays down until you put the new token in its environment. The new token is
            shown once.
          </p>
          <div className={styles.rowActions}>
            <button type="submit" className={styles.rowBtn} disabled={rotating}>
              {rotating ? 'Rotating…' : 'Rotate token'}
            </button>
            <button
              type="button"
              className={`${styles.rowBtn} ${styles.rowBtnGhost}`}
              onClick={() => setConfirming(null)}
              disabled={rotating}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {confirming === 'delete' && (
        <form action={remove} className={`${styles.confirm} ${styles.confirmStop}`}>
          <input type="hidden" name="agentId" value={agent.id} />
          <p className={styles.confirmText}>
            Deleting <b>{agent.name}</b> also deletes{' '}
            <b className={styles.num}>
              {agent.planCount} {agent.planCount === 1 ? 'plan' : 'plans'}
            </b>
            . Settled ones and their receipts go with it. This is the history of what the agent
            spent and what you approved, and nothing here can restore it.
          </p>
          {agent.planCount > 0 && (
            <p className={styles.confirmText}>
              The on-chain record survives; the account&rsquo;s copy of it does not.
            </p>
          )}
          <div className={styles.rowActions}>
            <button
              type="submit"
              className={`${styles.rowBtn} ${styles.rowBtnStop}`}
              disabled={removing}
            >
              {removing
                ? 'Deleting…'
                : agent.planCount > 0
                  ? `Delete agent and ${agent.planCount} ${agent.planCount === 1 ? 'plan' : 'plans'}`
                  : 'Delete agent'}
            </button>
            <button
              type="button"
              className={`${styles.rowBtn} ${styles.rowBtnGhost}`}
              onClick={() => setConfirming(null)}
              disabled={removing}
            >
              Keep it
            </button>
          </div>
        </form>
      )}

      {(rotateState.error || deleteState.error) && (
        <p className={styles.error} role="alert">
          {rotateState.error ?? deleteState.error}
        </p>
      )}
    </li>
  )
}
