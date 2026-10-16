// POST /api/accredit { address, name, city } -> the sandbox regulator accredits a visitor's lab key for 2 days.
// The only code that holds the regulator key. It writes exactly one kind of entity: a `lab` record whose lifetime is
// the accreditation. Real labs would go through a real regulator; this endpoint exists so anyone can try issuing.
import { privateKeyToAccount } from "viem/accounts"
import { isAddress } from "viem"
import { accredit, accreditationOf, publicClient, walletClient } from "../shared/vial.js"

const recent = new Map() // ip -> [timestamps], per warm instance
const clean = (s, n) => String(s ?? "").replace(/[<>"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, n)

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })
  const key = process.env.REGULATOR_KEY
  if (!key) return res.status(503).json({ error: "The sandbox regulator is not configured." })
  const { address } = req.body ?? {}
  const name = clean(req.body?.name, 48) || "Sandbox Lab"
  const city = clean(req.body?.city, 32)
  if (!isAddress(address)) return res.status(400).json({ error: "Send a valid lab address." })

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon"
  const now = Date.now(), hits = (recent.get(ip) || []).filter((t) => now - t < 3600_000)
  if (hits.length >= 3) return res.status(429).json({ error: "Three accreditations an hour per visitor." })

  const reader = publicClient()
  const existing = await accreditationOf(reader, address)
  if (existing) return res.status(200).json({ entityKey: existing.key, existing: true })

  const regulator = walletClient(privateKeyToAccount(key))
  const { entityKey, txHash } = await accredit(regulator, { wallet: address, name: `${name} (sandbox)`, city, sandbox: true })
  hits.push(now); recent.set(ip, hits)
  return res.status(200).json({ entityKey, txHash })
}
