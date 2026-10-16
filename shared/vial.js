// The Vial data contract in code. Shared by the web app, the API and the seed script.
// A lab result is an Arkiv entity: written by an accredited lab ($creator, forever), handed to the patient
// ($owner) in the same transaction, encrypted so the explorer shows nothing personal, and alive only as long
// as the patient chooses. See /arkiv/schema.md for the prose version.
import { createPublicClient, createWalletClient, ExpirationTime, jsonToPayload, NoEntityFoundError } from "@arkiv-network/sdk"
import { addr, bool, str } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq } from "@arkiv-network/sdk/query"
import { http, webSocket } from "viem"

export const APP = "vial"
export const NET = "v1"
/** The registry's signer. Only labs this address created (and that are still alive) are accredited. */
export const REGULATOR = "0x6BE641Ca56A1427f37f431e10fde993C4AbAb0B1"
export const RPC_URL = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
export const EXPLORER = "https://tiramisu.explorer.arkiv.network"
export const ACCREDITATION_DAYS = 365
export const SANDBOX_ACCREDITATION_DAYS = 10
export const RESULT_DAYS = { week: 7, month: 30, quarter: 90, year: 365 }

// ---------- clients ----------

const envKey = () => globalThis.process?.env?.ARKIV_ACCESS_KEY || undefined
/** Fail fast: the public RPC answers an exhausted budget with 429 + a long Retry-After that viem would sleep through. */
const transport = ({ rpc = RPC_URL, apiKey = envKey() } = {}) =>
  http(rpc, { retryCount: 0, timeout: 20_000, fetchOptions: apiKey ? { headers: { "X-API-KEY": apiKey } } : undefined })
export const publicClient = ({ ws = false, rpc, apiKey } = {}) => createPublicClient({ chain: tiramisu, transport: ws ? webSocket() : transport({ rpc, apiKey }) })
export const walletClient = (account, opts) => createWalletClient({ chain: tiramisu, transport: transport(opts), account })
export function isBudgetError(e) {
  for (let cur = e, d = 0; cur && d < 8; cur = cur.cause, d++) {
    if (cur.status === 429 || cur.code === -32005 || /ANON_COST_LIMITED|Status: 429|-32005|exceeds defined limit/i.test(`${cur.details ?? ""} ${cur.message ?? ""}`)) return true
  }
  return false
}

const common = (kind) => ({ app: str(APP), net: str(NET), kind: str(kind) })
const FIELDS = { key: true, owner: true, creator: true, createdAt: true, expiresAt: true, creationFlags: true, attributes: true, payload: true }

export function toThing(e) {
  const a = {}
  for (const [k, v] of Object.entries(e.attributes ?? {})) a[k] = v.value
  let data = {}
  try { data = e.payload?.length ? JSON.parse(new TextDecoder().decode(e.payload)) : {} } catch {}
  return { key: e.key, kind: a.kind, attrs: a, owner: e.owner, creator: e.creator, createdAt: e.createdAt, expiresAt: e.expiresAt, flags: e.creationFlags, data }
}
export async function collect(builder) {
  const out = []
  let page = await builder.limit(200).fetch()
  for (;;) { for (const e of page.entities) out.push(toThing(e)); if (!page.hasNextPage()) break; page = await page.next() }
  return out
}
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

// ---------- the registry ----------

/** Accredit a lab: an entity created by the regulator whose lifetime IS the accreditation. */
export function accredit(regulatorWallet, { wallet, name, city, sandbox = false }) {
  return regulatorWallet.createEntity({
    attributes: { ...common("lab"), wallet: addr(wallet), name: str(String(name).slice(0, 60)), sandbox: bool(!!sandbox) },
    payload: jsonToPayload({ name, city: city ?? "" }),
    contentType: "application/json",
    expires: ExpirationTime.fromDays(sandbox ? SANDBOX_ACCREDITATION_DAYS : ACCREDITATION_DAYS),
  })
}
/** Is this address an accredited lab right now? Trust comes from $creator = REGULATOR, never a field anyone can write. */
export async function accreditationOf(client, address) {
  const labs = await collect(client.select(FIELDS).where(eq("app", APP), eq("net", NET), eq("kind", "lab"), eq("wallet", addr(address))).createdBy(REGULATOR))
  return labs.sort((a, b) => (a.expiresAt < b.expiresAt ? 1 : -1))[0] ?? null
}
export const labsQuery = (client) => client.select(FIELDS).where(eq("app", APP), eq("net", NET), eq("kind", "lab")).createdBy(REGULATOR)

// ---------- encryption (WebCrypto, same in browsers and Node) ----------

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
const unb64u = (s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

/** Encrypt a report with a fresh 256-bit key. The key is returned to travel in a link fragment, never on-chain. */
export async function seal(report) {
  const raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"])
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(report)))
  return { box: { v: 1, alg: "A256GCM", iv: b64u(iv), ct: b64u(ct) }, secret: b64u(raw) }
}
export async function unseal(box, secret) {
  const key = await crypto.subtle.importKey("raw", unb64u(secret), "AES-GCM", false, ["decrypt"])
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(box.iv) }, key, unb64u(box.ct))
  return JSON.parse(new TextDecoder().decode(pt))
}
export const randomId = () => b64u(crypto.getRandomValues(new Uint8Array(9)))

// ---------- issuing ----------

/**
 * Issue a result as ONE atomic batch: create it read-only (nobody, not even the patient, can edit it), then
 * hand ownership to the patient. The result's key is predicted so the same batch can transfer it.
 * Attributes are the bare minimum: no test name, no patient, no values. Everything else is ciphertext.
 */
export async function issue(labWallet, reader, { patient, report, days = RESULT_DAYS.month }) {
  const { box, secret } = await seal(report)
  const [k] = await reader.predictEntityKeys({ owner: labWallet.account.address, count: 1 })
  const r = await labWallet.executeBatch({
    creates: [{
      attributes: { ...common("result"), rid: str(randomId()) },
      payload: jsonToPayload(box),
      contentType: "application/json",
      expires: ExpirationTime.fromDays(days),
      flags: { readonly: true },
      salt: k.salt,
    }],
    ownershipChanges: [{ entityKey: k.key, newOwner: patient }],
  })
  if (r.createdEntities[0] !== k.key) throw new Error("result key moved; another write from this lab was in flight")
  return { key: k.key, secret, txHash: r.txHash }
}

// ---------- the patient ----------

export const myResultsQuery = (client, owner) => client.select(FIELDS).where(eq("app", APP), eq("net", NET), eq("kind", "result")).ownedBy(owner)
/** Keep a result around longer (only its owner can). Sets a new expiry from now. */
export const keepFor = (wallet, key, days) => wallet.extendEntity({ entityKey: key, expires: ExpirationTime.fromDays(days) })
/** Make a result disappear: the owner deletes it. Every verifier link stops working at once. */
export const revoke = (wallet, key) => wallet.deleteEntity({ entityKey: key })

// ---------- verifying ----------

/**
 * Everything a verifier needs, in order: does the result still exist, who wrote it, are they an accredited lab,
 * has it been handed to someone else (the patient), and does the key in the link open it.
 */
export async function verify(client, key, secret) {
  let e
  // Only "no live entity" means gone. A network or budget error must never read as "revoked".
  try { e = toThing(await client.getEntity(key)) } catch (err) { if (err instanceof NoEntityFoundError) return { status: "gone" }; throw err }
  if (e.kind !== "result" || e.attrs.app !== APP) return { status: "gone" }
  let lab = await accreditationOf(client, e.creator)
  // Accredited after the fact doesn't count: the lab record must be older than the result.
  const late = !!lab && BigInt(lab.createdAt ?? 0) > BigInt(e.createdAt ?? 0)
  if (late) lab = null
  // A forger can write a lab record that looks exactly like a real one. Show it, so the reader sees why it fails.
  const claims = lab ? [] : await collect(client.select(FIELDS).where(eq("app", APP), eq("net", NET), eq("kind", "lab"), eq("wallet", addr(e.creator))))
  let report = null, sealed = false
  if (secret) { try { report = await unseal(e.data, secret) } catch { sealed = true } } else sealed = true
  const readonly = !!e.flags?.readonly
  // Green needs both: an accredited signer AND a record nobody can edit. Without readonly the patient (its owner)
  // could rewrite the contents after the lab signed it. A sandbox accreditation is real but self-service, so it's amber.
  const status = !lab ? "unaccredited" : !readonly ? "editable" : lab.attrs.sandbox === true ? "sandbox" : "verified"
  return {
    status,
    result: e, lab, late, claims: claims.filter((c) => !same(c.creator, REGULATOR)), report, sealed,
    handedOver: !same(e.owner, e.creator),
    readonly,
  }
}
export const resultLink = (origin, key, secret) => `${origin}/r/${key}#k=${secret}`
