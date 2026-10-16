// Two keys live in this browser so one visitor can play both sides: a lab key (signs results, becomes $creator)
// and a patient key (receives them, becomes $owner, and alone can extend or revoke them). Test GLM only.
// Result keys (the AES secrets) are kept here too, so "My results" can open what this browser was given.
import { formatEther } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { walletClient } from "../../shared/vial.js"

const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k, v) => { try { localStorage.setItem(k, v) } catch {} }

export function localWallet(role) {
  const store = `vial.key.${role}`
  let k = get(store)
  if (!k) { k = generatePrivateKey(); put(store, k) }
  const account = privateKeyToAccount(k)
  return { role, address: account.address, client: walletClient(account) }
}

export const secrets = {
  all() { try { return JSON.parse(get("vial.secrets") || "{}") } catch { return {} } },
  get(key) { return this.all()[key.toLowerCase()] },
  set(key, secret) { const a = this.all(); a[key.toLowerCase()] = secret; put("vial.secrets", JSON.stringify(a)) },
}
export const labProfile = {
  get() { try { return JSON.parse(get("vial.lab") || "{}") } catch { return {} } },
  set(p) { put("vial.lab", JSON.stringify(p)) },
}

export async function balanceOf(pub, address) {
  const wei = await pub.getBalance({ address })
  return { wei, text: Number(formatEther(wei)).toFixed(4) + " GLM" }
}

export async function drip(address) {
  const r = await fetch("/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `top-up failed (${r.status})`)
  return body
}

/** Make sure a key can pay for one more write: top it up from the testnet treasury when it runs low. */
export async function ensureGas(pub, w, onWait) {
  const { wei } = await balanceOf(pub, w.address)
  if (wei >= 1_000_000_000_000_000n) return
  onWait?.()
  try { await drip(w.address) } catch (e) { if (!/already has/.test(e.message)) throw e }
  for (let i = 0; i < 20; i++) {
    if ((await pub.getBalance({ address: w.address })) > 0n) return
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error("The test GLM top-up hasn't landed yet. Try again in a moment.")
}
