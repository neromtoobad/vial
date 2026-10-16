// node scripts/seed.mjs <fund|labs|status>
// fund:   treasury -> regulator (gas for accreditations) and -> the two demo lab keys
// labs:   the regulator accredits "Harbourside Diagnostics"; "QuickCert Lab" is never accredited (the forger)
//         and forges a lab record for itself, which the verifier must ignore. Each lab issues one demo result.
// Keys live in ~/.vial and are never printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { formatEther, parseEther } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { addr } from "@arkiv-network/sdk/attr"
import { eq } from "@arkiv-network/sdk/query"
import { accredit, accreditationOf, collect, issue, publicClient, REGULATOR, verify, walletClient } from "../shared/vial.js"

const dir = `${homedir()}/.vial`
const read = (n) => readFileSync(`${dir}/${n}`, "utf8").trim()
process.env.ARKIV_ACCESS_KEY ||= existsSync(`${dir}/access.key`) ? read("access.key") : ""
const keyFor = (n) => { if (!existsSync(`${dir}/${n}`)) writeFileSync(`${dir}/${n}`, generatePrivateKey(), { mode: 0o600 }); return privateKeyToAccount(read(n)) }

const reader = publicClient()
const treasury = privateKeyToAccount(read("treasury.key"))
const regulator = privateKeyToAccount(read("regulator.key"))
const good = keyFor("lab-harbourside.key"), rogue = keyFor("lab-quickcert.key"), patient = keyFor("patient-demo.key")
if (regulator.address !== REGULATOR) throw new Error("regulator.key does not match REGULATOR in shared/vial.js")

const cmd = process.argv[2] ?? "status"
const bal = async (a) => Number(formatEther(await reader.getBalance({ address: a }))).toFixed(4)

if (cmd === "status" || cmd === "fund") {
  for (const [n, a] of [["treasury", treasury], ["regulator", regulator], ["harbourside", good], ["quickcert", rogue], ["patient", patient]]) console.log(n.padEnd(12), a.address, await bal(a.address))
}
if (cmd === "fund") {
  const w = walletClient(treasury)
  for (const [a, amt] of [[regulator.address, "0.3"], [good.address, "0.05"], [rogue.address, "0.05"], [patient.address, "0.02"]]) {
    const h = await w.sendTransaction({ to: a, value: parseEther(amt) }); await reader.waitForTransactionReceipt({ hash: h }); console.log("sent", amt, "->", a)
  }
}
if (cmd === "labs") {
  if (!(await accreditationOf(reader, good.address))) {
    const r = await accredit(walletClient(regulator), { wallet: good.address, name: "Harbourside Diagnostics", city: "Lagos" })
    console.log("accredited harbourside", r.entityKey)
  } else console.log("harbourside already accredited")
  // The forger writes a lab record for itself with every field a real one has. Only $creator differs.
  const fakes = await collect(reader.select({ key: true }).where(eq("app", "vial"), eq("kind", "lab"), eq("wallet", addr(rogue.address))).createdBy(rogue.address))
  if (!fakes.length) {
    const fake = await accredit(walletClient(rogue), { wallet: rogue.address, name: "QuickCert Lab", city: "Lagos" })
    console.log("quickcert self-accredited (ignored by verifiers)", fake.entityKey)
  }
  await new Promise((r) => setTimeout(r, 1500))
  const report = (lab, extra) => ({
    lab, test: "Genotype & blood group", sample: "Whole blood (EDTA)", collected: new Date().toISOString().slice(0, 10),
    patient: { name: "Demo Patient", ref: "DP-0042" },
    results: [{ name: "Haemoglobin genotype", value: "AA", ref: "AA · AS · SS · AC" }, { name: "ABO blood group", value: "O", ref: "" }, { name: "Rhesus (D)", value: "Positive", ref: "" }],
    note: "Synthetic demo data.", ...extra,
  })
  const a = await issue(walletClient(good), reader, { patient: patient.address, report: report("Harbourside Diagnostics"), days: 365 })
  const b = await issue(walletClient(rogue), reader, { patient: patient.address, report: report("QuickCert Lab", { note: "Certified fit for marriage. (A forged demo: QuickCert is not accredited.)" }), days: 365 })
  writeFileSync(`${dir}/demo-links.json`, JSON.stringify({ genuine: a, forged: b }, null, 2), { mode: 0o600 })
  // The demo results are synthetic, so their keys can ship with the site: the home page links straight to them.
  const pick = (x) => ({ key: x.key, secret: x.secret })
  writeFileSync(new URL("../web/src/demo.js", import.meta.url), `// Written by scripts/seed.mjs. Synthetic demo results, live on the Arkiv testnet.\nexport const DEMO = ${JSON.stringify({ genuine: pick(a), forged: pick(b) }, null, 2)}\n`)
  await new Promise((r) => setTimeout(r, 1500))
  for (const [n, x] of [["genuine", a], ["forged", b]]) { const v = await verify(reader, x.key, x.secret); console.log(n, x.key, "->", v.status, v.lab?.attrs?.name ?? "", v.report?.lab, "handedOver", v.handedOver, "readonly", v.readonly) }
}
