import { BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Transfer } from '../generated/USDC/ERC20'
import { IndexMeta, Payer, PayerSeller, Seller, Settlement } from '../generated/schema'

/** USDC is 6dp on Worldchain — verified live 2026-07-25 via decimals(). */
const USDC_SCALE = BigDecimal.fromString('1000000')
const META_ID = 'meta'

const ZERO = BigInt.fromI32(0)
const ONE = BigInt.fromI32(1)

/** Mint/burn counterparty. A transfer to or from it is supply movement, not a payment. */
const ZERO_ADDRESS = Bytes.fromHexString('0x0000000000000000000000000000000000000000')

function toUsd(amount: BigInt): BigDecimal {
  return amount.toBigDecimal().div(USDC_SCALE)
}

function loadSeller(address: Bytes, event: ethereum.Event): Seller {
  let seller = Seller.load(address)
  if (seller == null) {
    seller = new Seller(address)
    seller.settlementCount = ZERO
    seller.uniquePayerCount = ZERO
    seller.totalReceived = ZERO
    seller.totalReceivedUsd = BigDecimal.zero()
    seller.firstSeenBlock = event.block.number
    seller.firstSeenTimestamp = event.block.timestamp
  }
  return seller as Seller
}

function loadPayer(address: Bytes, event: ethereum.Event): Payer {
  let payer = Payer.load(address)
  if (payer == null) {
    payer = new Payer(address)
    payer.paymentCount = ZERO
    payer.uniqueSellerCount = ZERO
    payer.totalSent = ZERO
    payer.totalSentUsd = BigDecimal.zero()
    payer.firstSeenBlock = event.block.number
    payer.firstSeenTimestamp = event.block.timestamp
  }
  return payer as Payer
}

/**
 * Every USDC transfer on Worldchain becomes a Settlement.
 *
 * Deliberately unfiltered. Our plan wallets are minted per approval, so their addresses do
 * not exist when this manifest is written — filtering to a known address set would mean
 * redeploying the subgraph on every plan, and would still miss any seller the agent
 * discovers at runtime. Indexing the whole (low-volume) token and filtering at query time
 * keeps the manifest static and makes both consumers work for addresses nobody enumerated.
 *
 * Mints and burns are skipped: a transfer from or to the zero address is supply movement,
 * and counting it as a settlement would inflate seller trust with non-payments.
 */
export function handleTransfer(event: Transfer): void {
  const from = changetype<Bytes>(event.params.from)
  const to = changetype<Bytes>(event.params.to)
  if (from == ZERO_ADDRESS || to == ZERO_ADDRESS) return

  const amount = event.params.value
  const amountUsd = toUsd(amount)

  const payer = loadPayer(from, event)
  const seller = loadSeller(to, event)

  // Payer→seller edge first: whether it is new is what makes the unique counts correct.
  const edgeId = from.concat(to)
  let edge = PayerSeller.load(edgeId)
  if (edge == null) {
    edge = new PayerSeller(edgeId)
    edge.payer = payer.id
    edge.seller = seller.id
    edge.count = ZERO
    edge.totalAmount = ZERO
    edge.firstSeenTimestamp = event.block.timestamp
    seller.uniquePayerCount = seller.uniquePayerCount.plus(ONE)
    payer.uniqueSellerCount = payer.uniqueSellerCount.plus(ONE)
  }
  edge.count = edge.count.plus(ONE)
  edge.totalAmount = edge.totalAmount.plus(amount)
  edge.lastSeenTimestamp = event.block.timestamp
  edge.save()

  seller.settlementCount = seller.settlementCount.plus(ONE)
  seller.totalReceived = seller.totalReceived.plus(amount)
  seller.totalReceivedUsd = toUsd(seller.totalReceived)
  seller.lastSeenBlock = event.block.number
  seller.lastSeenTimestamp = event.block.timestamp
  seller.save()

  payer.paymentCount = payer.paymentCount.plus(ONE)
  payer.totalSent = payer.totalSent.plus(amount)
  payer.totalSentUsd = toUsd(payer.totalSent)
  payer.lastSeenBlock = event.block.number
  payer.lastSeenTimestamp = event.block.timestamp
  payer.save()

  // id = txHash-logIndex: unique per log, and the transaction hash inside it is exactly what
  // our receipts record as txRef, so the console can join on it.
  const settlement = new Settlement(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  settlement.payer = payer.id
  settlement.seller = seller.id
  settlement.from = from
  settlement.to = to
  settlement.amount = amount
  settlement.amountUsd = amountUsd
  settlement.blockNumber = event.block.number
  settlement.blockTimestamp = event.block.timestamp
  settlement.transactionHash = event.transaction.hash
  settlement.logIndex = event.logIndex
  settlement.save()

  touchMeta(event)
}

/**
 * Records the real indexing window. The console reads this instead of hardcoding a period,
 * so "settled since deployment" is a fact the subgraph reports rather than a claim the UI makes.
 */
function touchMeta(event: ethereum.Event): void {
  let meta = IndexMeta.load(META_ID)
  if (meta == null) {
    meta = new IndexMeta(META_ID)
    meta.firstIndexedBlock = event.block.number
    meta.firstIndexedTimestamp = event.block.timestamp
    meta.settlementCount = ZERO
  }
  meta.lastIndexedBlock = event.block.number
  meta.lastIndexedTimestamp = event.block.timestamp
  meta.settlementCount = meta.settlementCount.plus(ONE)
  meta.save()
}
