// Vial web app: one page, four rooms. The verifier (/r/<key>#k=<secret>) is the heart; the lab desk and
// "My results" exist so a visitor can play every side. Every read goes to Arkiv directly from this browser.
import QRCode from "qrcode"
import {
  accreditationOf, EXPLORER, isBudgetError, issue, keepFor, myResultsQuery, collect, publicClient, REGULATOR,
  RESULT_DAYS, resultLink, revoke, unseal, verify,
} from "../../shared/vial.js"
import { DEMO } from "./demo.js"
import { TESTS } from "./tests.js"
import { balanceOf, ensureGas, labProfile, localWallet, secrets } from "./wallet.js"

const $ = (id) => document.getElementById(id)
const app = $("app")
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "")
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const BLOCK_S = 2

// ---------- reads: Arkiv directly, our read-only relay only when this visitor's anonymous budget runs out ----------
let pub = publicClient(), relayed = false
async function reading(fn) {
  try { return await fn(pub) } catch (e) {
    if (relayed || !isBudgetError(e)) throw e
    relayed = true; pub = publicClient({ rpc: `${location.origin}/api/rpc` })
    $("net").classList.add("relay"); $("net").lastChild.textContent = "Arkiv testnet · via relay"
    return fn(pub)
  }
}
let headAt = { block: 0n, t: 0 }
async function head() {
  if (Date.now() - headAt.t < 4000) return headAt.block + BigInt(Math.floor((Date.now() - headAt.t) / 2000))
  const block = await reading((c) => c.getBlockNumber()); headAt = { block, t: Date.now() }; return block
}
const secondsLeft = (expiresAt) => Number(BigInt(expiresAt) - headAt.block) * BLOCK_S - (Date.now() - headAt.t) / 1000
function life(s) {
  if (s <= 0) return "expired"
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d >= 2 ? `${d} days` : d === 1 ? `1 day ${h} h` : h ? `${h} h ${m} min` : `${m} min ${Math.floor(s % 60)} s`
}
const until = (s) => new Date(Date.now() + s * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

function toast(msg, kind = "") {
  const t = $("toast"); t.className = `toast ${kind}`; t.innerHTML = msg; t.hidden = false
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 4200)
}
function modal(html) {
  const m = $("modal"); m.innerHTML = `<div class="sheet">${html}<button class="x" data-close aria-label="Close">×</button></div>`; m.hidden = false
}
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) $("modal").hidden = true })
const copy = async (text, what = "Link") => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`) } catch { toast("Copy failed. Select it and copy by hand.") } }
const friendly = (e) => {
  const m = `${e?.shortMessage ?? ""} ${e?.message ?? ""}`
  if (isBudgetError(e)) return "Arkiv's public endpoint is busy for this visitor. Try again in a minute."
  if (/insufficient funds/i.test(m)) return "This key has no test GLM yet. Try again in a moment."
  return esc((e?.shortMessage || e?.message || "Something went wrong").split("\n")[0].slice(0, 160))
}

// ---------- routing ----------
let cleanup = []
function go(path) { history.pushState({}, "", path); route() }
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]")
  if (!a || e.metaKey || e.ctrlKey) return
  e.preventDefault(); go(a.getAttribute("href"))
})
window.addEventListener("popstate", route)
function route() {
  for (const f of cleanup) f(); cleanup = []
  $("modal").hidden = true
  const p = location.pathname
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", p.startsWith(`/${a.dataset.nav}`) || (a.dataset.nav === "verify" && p.startsWith("/r/"))))
  window.scrollTo(0, 0)
  if (p.startsWith("/r/")) return verifier(p.slice(3).split("/")[0], new URLSearchParams(location.hash.slice(1)).get("k"))
  if (p === "/verify") return verifyHome()
  if (p === "/me") return mine()
  if (p === "/lab") return labDesk()
  if (p === "/how") return how()
  return home()
}

// ---------- home ----------
const demoHref = (d) => `/r/${d.key}#k=${d.secret}`
function home() {
  app.innerHTML = `
  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">Lab results · sealed on Arkiv</p>
      <h1>A lab result anyone can check, <em>and only you can read.</em></h1>
      <p class="lede">A paper result is easy to forge, and once you hand it over you can't take it back. With Vial, an accredited lab
      seals your result on Arkiv and gives it to you. You choose who sees it and for how long. Whoever you share it with can tell in seconds whether it's real.</p>
      <div class="cta">
        <a class="btn primary" href="${demoHref(DEMO.genuine)}" data-link>Check a real result</a>
        <a class="btn ghost" href="${demoHref(DEMO.forged)}" data-link>Check a forged one</a>
      </div>
      <p class="fine">Both are live on the Arkiv testnet. Synthetic data, no real patients.</p>
    </div>
    <div class="hero-art">
      <div class="halo"></div>
      <img src="/art/vial.webp" alt="A sealed sample vial" />
      <div class="chip c1"><b>✓</b> Accredited lab</div>
      <div class="chip c2"><b>🔒</b> Sealed · read-only</div>
      <div class="chip c3"><b>⏳</b> Yours · 29 days left</div>
    </div>
  </section>

  <section class="steps">
    ${[
      ["lab", "The lab seals it", "The report is encrypted in the lab's browser, written to Arkiv as read-only, and handed to you, all in one transaction."],
      ["phone", "You hold it", "On Arkiv it's yours: you are its owner. Keep it a week or a year. Revoke it, and every link you've shared stops working."],
      ["seal", "Anyone checks it", "Arkiv records who signed it, forever, and nobody can fake that. The regulator's list says which signers are accredited labs."],
    ].map(([img, h, p], i) => `<article><img src="/art/${img}.webp" alt="" /><span class="n">${i + 1}</span><h3>${h}</h3><p>${p}</p></article>`).join("")}
  </section>

  <section class="split">
    <div class="pub">
      <p class="eyebrow">On Arkiv, public to anyone</p>
      <ul>
        <li>That a <code>vial</code> result exists, plus a random id</li>
        <li>Which lab wrote it <span>(its signer, <code>$creator</code>)</span></li>
        <li>Which wallet holds it <span>(<code>$owner</code>, a pseudonymous address)</span></li>
        <li>When it expires</li>
        <li>About 400 bytes of ciphertext</li>
      </ul>
    </div>
    <div class="priv">
      <p class="eyebrow">Only in the link you share</p>
      <ul>
        <li>The test, its values and reference ranges</li>
        <li>Your name and the lab's notes</li>
        <li>The 256-bit key that opens it. It sits after the <code>#</code>, so browsers never send it to any server, ours included.</li>
      </ul>
    </div>
  </section>

  <section class="roles">
    <h2>Play every side</h2>
    <div class="role-grid">
      <a href="/lab" data-link><img src="/art/lab.webp" alt="" /><b>Be the lab</b><span>Get sandbox accreditation, then seal a result and hand it to a patient.</span></a>
      <a href="/me" data-link><img src="/art/vial.webp" alt="" /><b>Be the patient</b><span>See what you hold. Share it, keep it longer, or revoke it.</span></a>
      <a href="/verify" data-link><img src="/art/seal.webp" alt="" /><b>Be the verifier</b><span>Paste a link. See who signed it and whether they're accredited.</span></a>
    </div>
  </section>`
}

// ---------- verifier ----------
function verifyHome() {
  app.innerHTML = `<section class="narrow">
    <p class="eyebrow">Verify</p><h1 class="h">Check a result someone shared with you</h1>
    <p class="lede">Paste the Vial link. Vial reads Arkiv directly from your browser: it asks who signed the result, whether that signer is an accredited lab right now, and whether the patient still stands behind it.</p>
    <form id="vf" class="paste"><input id="vl" placeholder="https://vial.nerom.site/r/0x…#k=…" autocomplete="off" /><button class="btn primary">Verify</button></form>
    <p class="fine">Or try the demos: <a href="${demoHref(DEMO.genuine)}" data-link>a genuine result</a> · <a href="${demoHref(DEMO.forged)}" data-link>a forged one</a></p>
  </section>`
  $("vf").onsubmit = (e) => {
    e.preventDefault()
    const m = $("vl").value.trim().match(/(0x[0-9a-fA-F]{64})(?:#k=([\w-]+))?/)
    if (!m) return toast("That doesn't look like a Vial link.", "bad")
    go(`/r/${m[1]}${m[2] ? `#k=${m[2]}` : ""}`)
  }
}

function rangeBar(r) {
  if (r.low === undefined || r.high === undefined) return ""
  const v = Number(r.value), lo = Number(r.low), hi = Number(r.high), span = hi - lo
  const min = lo - span * 0.5, max = hi + span * 0.5, pct = Math.max(2, Math.min(98, ((v - min) / (max - min)) * 100))
  const out = v < lo || v > hi
  return `<div class="bar ${out ? "out" : ""}"><i class="ok" style="left:${((lo - min) / (max - min)) * 100}%;right:${100 - ((hi - min) / (max - min)) * 100}%"></i><b style="left:${pct}%"></b></div>`
}
function reportCard(rep, { lab, issued, void: isVoid } = {}) {
  return `<article class="report ${isVoid ? "void" : ""}">${isVoid ? `<span class="stamp">Not verified</span>` : ""}
    <header><div><p class="eyebrow">${esc(rep.lab || lab || "Laboratory report")}</p><h2>${esc(rep.test)}</h2></div><img src="/art/vial.webp" alt="" /></header>
    <dl class="meta">
      <div><dt>Patient</dt><dd>${esc(rep.patient?.name || "—")}${rep.patient?.ref ? ` <span class="mono">${esc(rep.patient.ref)}</span>` : ""}</dd></div>
      <div><dt>Sample</dt><dd>${esc(rep.sample || "—")}</dd></div>
      <div><dt>Collected</dt><dd>${esc(rep.collected || "—")}</dd></div>
      ${issued ? `<div><dt>Sealed</dt><dd>${esc(issued)}</dd></div>` : ""}
    </dl>
    <table class="results"><thead><tr><th>Test</th><th>Result</th><th>Reference</th></tr></thead><tbody>
      ${(rep.results || []).map((r) => `<tr><td>${esc(r.name)}</td><td class="v">${esc(r.value)}${r.unit ? ` <span>${esc(r.unit)}</span>` : ""}${rangeBar(r)}</td><td class="ref">${r.low !== undefined ? `${r.low}–${r.high}${r.unit ? ` ${esc(r.unit)}` : ""}` : esc(r.ref || "")}</td></tr>`).join("")}
    </tbody></table>
    ${rep.note ? `<p class="note">${esc(rep.note)}</p>` : ""}
  </article>`
}

async function verifier(key, secret) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) { app.innerHTML = `<section class="narrow"><h1 class="h">That link is broken</h1><p class="lede">A Vial link has a 64-character result key after /r/.</p></section>`; return }
  app.innerHTML = `<section class="verdict checking"><div class="v-art"><img src="/art/seal.webp" alt="" /></div><div><p class="eyebrow">Checking against Arkiv…</p><h1 class="h">Reading the result's record</h1></div></section>`
  let v, at
  const check = async () => {
    try { [v, at] = await reading(async (c) => [await verify(c, key, secret), await head()]) }
    catch (e) { app.innerHTML = `<section class="narrow"><h1 class="h">Couldn't reach Arkiv</h1><p class="lede">${friendly(e)}</p><button class="btn primary" id="again">Try again</button></section>`; $("again").onclick = check; return }
    if (secret && v.status !== "gone") secrets.set(key, secret) // so "My results" can open it if this browser holds it
    paint()
  }
  const paint = (flash = "") => {
    if (v.status === "gone") {
      app.innerHTML = `<section class="verdict gone ${flash}"><div class="v-art"><img src="/art/vial.webp" alt="" class="dim" /></div><div>
        <p class="eyebrow">${flash ? "Revoked just now" : "Not on Arkiv"}</p>
        <h1 class="h">This result no longer exists.</h1>
        <p class="lede">${flash ? "The patient revoked it while you were looking. Every link to it died at once." : "Either the patient revoked it, or its time ran out. Either way, nobody should rely on it, including any copy, screenshot or printout."}</p>
        <p class="mono small">result ${short(key)} · checked at block ${at}</p></div></section>`
      return
    }
    const { result: r, lab, report } = v, left = secondsLeft(r.expiresAt)
    const ok = v.status === "verified"
    const labName = lab?.attrs?.name, sandbox = lab?.attrs?.sandbox
    const forgedName = v.claims?.[0]?.attrs?.name
    const claimed = report?.lab
    const head1 = ok ? `Genuine. Sealed by ${esc(labName)}.` : `Not from an accredited lab.`
    const sub = ok
      ? `The signer is on the regulator's list${sandbox ? " (a sandbox accreditation, made for trying Vial)" : ""}, the record can't be edited, and the patient holds it.`
      : forgedName || claimed
        ? `It claims to come from <b>${esc(forgedName || claimed)}</b>. ${forgedName ? `That lab even wrote its own accreditation record on Arkiv, but the regulator didn't sign it, so it counts for nothing.` : `No accreditation signed by the regulator exists for its signer.`}`
        : `Its signer has no accreditation signed by the regulator.`
    const row = (good, title, ev) => `<li class="${good ? "y" : "n"}"><i>${good ? "✓" : "✕"}</i><div><b>${title}</b><span>${ev}</span></div></li>`
    app.innerHTML = `
    <section class="verdict ${ok ? "good" : "bad"} ${flash}">
      <div class="v-art"><img src="/art/${ok ? "seal" : "fake"}.webp" alt="" /></div>
      <div>
        <p class="eyebrow">${ok ? "Verified on Arkiv" : "Verification failed"} · live</p>
        <h1 class="h">${head1}</h1>
        <p class="lede">${sub}</p>
        <p class="mono small">checked at block ${at} · this page updates by itself if the patient revokes it</p>
      </div>
    </section>
    <section class="v-grid">
      <div>
        <h3 class="label">What Vial checked</h3>
        <ul class="checks">
          ${row(true, "It exists on Arkiv", `Result <a href="${EXPLORER}/entity/${r.key}" target="_blank" rel="noopener" class="mono">${short(r.key)}</a> expires in <b data-left="${r.expiresAt}">${life(left)}</b> (${until(left)}), on the patient's terms.`)}
          ${row(ok, ok ? "Signed by an accredited lab" : "Signed by a lab nobody accredited", ok
            ? `Signer <span class="mono">${short(r.creator)}</span> holds accreditation <a href="${EXPLORER}/entity/${lab.key}" target="_blank" rel="noopener" class="mono">${short(lab.key)}</a>, written by the regulator <span class="mono">${short(REGULATOR)}</span>, valid ${life(secondsLeft(lab.expiresAt))} more.`
            : `Signer <span class="mono">${short(r.creator)}</span>. ${v.late ? "Its accreditation is newer than this result, so it doesn't count." : v.claims?.length ? `It has a lab record <a href="${EXPLORER}/entity/${v.claims[0].key}" target="_blank" rel="noopener" class="mono">${short(v.claims[0].key)}</a>, but that record was written by <span class="mono">${short(v.claims[0].creator)}</span>, not the regulator.` : "No lab record from the regulator names it."}`)}
          ${row(v.readonly, v.readonly ? "Nobody can edit it" : "It could have been edited", v.readonly ? "Created with Arkiv's <code>readonly</code> flag: not the lab, not the patient, not us can change a byte of it. They can only let it go." : "Created without the read-only flag.")}
          ${row(v.handedOver, v.handedOver ? "The patient holds it" : "The lab still holds it", v.handedOver ? `Owner <span class="mono">${short(r.owner)}</span>, handed over in the same transaction that created it. Only the owner can extend or revoke it.` : "Ownership never moved to a patient.")}
          ${secret ? row(!v.sealed, v.sealed ? "The key in this link doesn't open it" : "Your link opened it", v.sealed ? "The ciphertext is genuine, but this link carries the wrong key. Ask for the link again." : "AES-256-GCM, decrypted in this browser. The key never left the link.") : row(false, "No key in this link", "You can see who signed it, but not what it says. The full link ends in <code>#k=…</code>.")}
        </ul>
        <details class="raw"><summary>What everyone else sees on Arkiv</summary>
          <pre>${esc(JSON.stringify({ key: r.key, $creator: r.creator, $owner: r.owner, $expiresAt: String(r.expiresAt), flags: { readonly: !!r.flags?.readonly }, attributes: r.attrs, payload: { ...r.data, ct: String(r.data.ct || "").slice(0, 64) + "…" } }, null, 2))}</pre>
        </details>
      </div>
      <div>${report ? `${ok ? "" : `<div class="warn">The contents below are whatever the forger typed. They prove nothing.</div>`}${reportCard(report, { issued: `block ${r.createdAt}`, void: !ok })}` : `<div class="sealed-card"><img src="/art/phone.webp" alt="" /><b>Sealed</b><p>Only someone with the full link can read this result. What the verifier can still prove is who signed it and who holds it.</p></div>`}</div>
    </section>`
  }
  await check()
  // Live: deletion = revoked; an extension moves the expiry; the regulator withdrawing the lab flips the verdict.
  const ws = publicClient({ ws: true })
  const stop = ws.watchEntityEvents({
    onEntityDeleted: (e) => { if (same(e.entityKey, key)) { v = { status: "gone" }; if (e.blockNumber) at = e.blockNumber; paint("flash") } else if (v?.lab && same(e.entityKey, v.lab.key)) check() },
    onExpiryExtended: (e) => { if (same(e.entityKey, key) && v?.result) { v.result.expiresAt = e.expiresAt; toast("The patient just extended this result.") ; paint() } },
    onError: () => {},
  })
  const tick = setInterval(() => {
    document.querySelectorAll("[data-left]").forEach((el) => { const s = secondsLeft(el.dataset.left); el.textContent = life(s); if (s <= 0) check() })
  }, 1000)
  cleanup.push(() => { try { stop?.then ? stop.then((f) => f?.()) : stop?.() } catch {} ; clearInterval(tick) })
}

// ---------- the patient ----------
async function mine() {
  const me = localWallet("me")
  app.innerHTML = `<section class="page-head"><div><p class="eyebrow">My results</p><h1 class="h">What you hold</h1>
    <p class="lede">Results handed to this browser's patient wallet. You own them on Arkiv: only you can keep them longer or revoke them.</p></div>
    <div class="who"><span class="label">Your patient wallet</span><button class="mono addr" id="cp-me" title="Copy">${me.address}</button><span class="small" id="me-bal">…</span></div></section>
    <section id="list" class="list"><div class="skeleton"></div><div class="skeleton"></div></section>
    <section class="narrow import"><h3 class="label">Got a link from a lab?</h3><form id="imp" class="paste"><input id="impl" placeholder="Paste a Vial link to open it here" /><button class="btn ghost">Open</button></form></section>`
  $("cp-me").onclick = () => copy(me.address, "Address")
  $("imp").onsubmit = (e) => {
    e.preventDefault(); const m = $("impl").value.match(/(0x[0-9a-fA-F]{64})#k=([\w-]+)/)
    if (!m) return toast("Paste the full link, including the #k= part.", "bad")
    secrets.set(m[1], m[2]); mine()
  }
  reading((c) => balanceOf(c, me.address)).then((b) => ($("me-bal").textContent = b.text)).catch(() => {})
  let list
  try { list = await reading(async (c) => { await head(); return collect(myResultsQuery(c, me.address)) }) }
  catch (e) { $("list").innerHTML = `<p class="empty">${friendly(e)}</p>`; return }
  if (!list.length) {
    $("list").innerHTML = `<div class="empty"><img src="/art/vial.webp" alt="" /><b>Nothing here yet</b><p>Go to the <a href="/lab" data-link>Lab desk</a>, get sandbox accreditation, and issue a result to this wallet. It'll show up here, sealed and yours.</p></div>`
    return
  }
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = await Promise.all(list.map(async (r) => {
    const s = secrets.get(r.key); let rep = null
    if (s) { try { rep = await unseal(r.data, s) } catch {} }
    let lab = null; try { lab = await reading((c) => accreditationOf(c, r.creator)) } catch {}
    return { r, s, rep, lab }
  }))
  $("list").innerHTML = rows.map(({ r, s, rep, lab }) => {
    const left = secondsLeft(r.expiresAt)
    return `<article class="held ${lab ? "" : "rogue"}" data-key="${r.key}">
      <img src="/art/${lab ? "vial" : "fake"}.webp" alt="" />
      <div class="t"><b>${esc(rep?.test || "Sealed result")}</b>
        <span>${lab ? `✓ ${esc(lab.attrs.name)}` : `✕ unaccredited signer ${short(r.creator)}`} · block ${r.createdAt}</span>
        <span class="life ${left < 86400 ? "soon" : ""}">Expires in <b data-left="${r.expiresAt}">${life(left)}</b></span></div>
      <div class="acts">
        ${s ? `<button class="btn primary sm" data-share="${r.key}">Share</button>` : `<span class="small">No key in this browser</span>`}
        <button class="btn ghost sm" data-keep="${r.key}">Keep 30 more days</button>
        <button class="btn danger sm" data-revoke="${r.key}">Revoke</button>
      </div></article>`
  }).join("")
  const tick = setInterval(() => document.querySelectorAll("[data-left]").forEach((el) => (el.textContent = life(secondsLeft(el.dataset.left)))), 1000)
  cleanup.push(() => clearInterval(tick))
  $("list").onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return
    if (b.dataset.share) return shareSheet(b.dataset.share, secrets.get(b.dataset.share))
    const key = b.dataset.keep || b.dataset.revoke, row = rows.find((x) => x.r.key === key)
    if (b.dataset.revoke && !confirm("Revoke this result? It's deleted from Arkiv for good, and every link you've shared stops working right away.")) return
    b.disabled = true; const label = b.textContent; b.textContent = "Signing…"
    try {
      await ensureGas(pub, me, () => (b.textContent = "Getting test GLM…"))
      if (b.dataset.keep) {
        const days = Math.ceil(Math.max(0, secondsLeft(row.r.expiresAt)) / 86400) + 30
        await keepFor(me.client, key, days); toast(`Kept. It now lasts ${days} days.`, "good")
      } else { await revoke(me.client, key); toast("Revoked. Every link to it is dead.", "good") }
      setTimeout(mine, 600)
    } catch (err) { toast(friendly(err), "bad"); b.disabled = false; b.textContent = label }
  }
}

async function shareSheet(key, secret) {
  const link = resultLink(location.origin, key, secret)
  modal(`<p class="eyebrow">Share</p><h2 class="h2">Anyone with this link can read it</h2>
    <p class="small">Send it to your employer, school or partner. Revoke the result whenever you like, and the link stops working.</p>
    <canvas id="qr"></canvas>
    <div class="linkbox"><code>${esc(link)}</code></div>
    <div class="row"><button class="btn primary" id="cp">Copy link</button><a class="btn ghost" href="/r/${key}#k=${secret}" data-link>Open as a verifier</a></div>`)
  QRCode.toCanvas($("qr"), link, { width: 220, margin: 1, color: { dark: "#16201f", light: "#ffffff" } })
  $("cp").onclick = () => copy(link)
}

// ---------- the lab ----------
let draft = { test: "genotype", patient: "me", days: "month", name: "Ada Obi", values: {} }
async function labDesk() {
  const lab = localWallet("lab"), me = localWallet("me"), prof = labProfile.get()
  app.innerHTML = `<section class="page-head"><div><p class="eyebrow">Lab desk</p><h1 class="h">Seal a result and hand it over</h1>
    <p class="lede">You're a lab. Your browser holds a signing key. Results you seal carry its signature on Arkiv forever, so verifiers can tell whether you're accredited.</p></div>
    <div class="who"><span class="label">Lab signing key</span><button class="mono addr" id="cp-lab">${lab.address}</button><span class="small" id="lab-bal">…</span></div></section>
    <section class="lab-grid">
      <aside id="accr" class="card"><div class="skeleton"></div></aside>
      <div id="issue" class="card"></div>
    </section>`
  $("cp-lab").onclick = () => copy(lab.address, "Address")
  reading((c) => balanceOf(c, lab.address)).then((b) => ($("lab-bal").textContent = b.text)).catch(() => {})
  let acc = null
  const paintAcc = () => {
    $("accr").innerHTML = acc
      ? `<img src="/art/seal.webp" alt="" class="ic" /><p class="eyebrow ok">Accredited</p><h3>${esc(acc.attrs.name)}</h3>
         <p class="small">The regulator <span class="mono">${short(REGULATOR)}</span> wrote <a href="${EXPLORER}/entity/${acc.key}" target="_blank" rel="noopener" class="mono">${short(acc.key)}</a> for your key. It lasts <b data-left="${acc.expiresAt}">${life(secondsLeft(acc.expiresAt))}</b>. When it runs out, verifiers stop trusting results you issue from then on.</p>`
      : `<img src="/art/lab.webp" alt="" class="ic" /><p class="eyebrow">Step 1 · Accreditation</p><h3>Get on the regulator's list</h3>
         <p class="small">Real labs are accredited by a regulator. Here a sandbox regulator signs a record for your key that lasts 2 days, so you can try Vial.</p>
         <form id="accf" class="stack"><input id="ln" maxlength="40" placeholder="Lab name" value="${esc(prof.name || "")}" required /><input id="lc" maxlength="30" placeholder="City" value="${esc(prof.city || "")}" />
         <button class="btn primary">Request sandbox accreditation</button></form>
         <p class="fine">Or skip this and issue anyway, like a forger would. Then watch the verifier reject it.</p>`
    const f = $("accf"); if (!f) return
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = f.querySelector("button"); btn.disabled = true; btn.textContent = "The regulator is signing…"
      labProfile.set({ name: $("ln").value, city: $("lc").value })
      try {
        const r = await fetch("/api/accredit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: lab.address, name: $("ln").value, city: $("lc").value }) })
        const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || `failed (${r.status})`)
        for (let i = 0; i < 8 && !acc; i++) { await new Promise((r) => setTimeout(r, 1500)); acc = await reading((c) => accreditationOf(c, lab.address)) }
        toast("You're accredited. Results you seal now verify green.", "good"); paintAcc(); paintIssue()
      } catch (err) { toast(friendly(err), "bad"); btn.disabled = false; btn.textContent = "Request sandbox accreditation" }
    }
  }
  const paintIssue = () => {
    const t = TESTS[draft.test]
    $("issue").innerHTML = `<p class="eyebrow">${acc ? "Step 2 · Issue" : "Issue a result"}</p><h3>New result</h3>
      <form id="isf" class="issue">
        <label class="label">Test</label>
        <div class="chips">${Object.entries(TESTS).map(([k, x]) => `<button type="button" class="tchip ${k === draft.test ? "on" : ""}" data-test="${k}">${esc(x.title)}</button>`).join("")}</div>
        <p class="small muted">${esc(t.blurb)}</p>
        <table class="edit"><tbody>${t.results.map((r, i) => `<tr><td>${esc(r.name)}</td><td><input data-v="${i}" value="${esc(draft.values[`${draft.test}.${i}`] ?? r.value)}" />${r.unit ? `<span>${esc(r.unit)}</span>` : ""}</td></tr>`).join("")}</tbody></table>
        <div class="two"><div><label class="label">Patient name <span class="muted">(encrypted)</span></label><input id="pn" value="${esc(draft.name)}" maxlength="60" /></div>
          <div><label class="label">Keep for</label><select id="days">${Object.keys(RESULT_DAYS).map((k) => `<option value="${k}" ${k === draft.days ? "selected" : ""}>${RESULT_DAYS[k]} days</option>`).join("")}</select></div></div>
        <label class="label">Hand it to</label>
        <div class="seg"><label><input type="radio" name="to" value="me" ${draft.patient === "me" ? "checked" : ""} /> This browser's patient wallet <span class="mono">${short(me.address)}</span></label>
          <label><input type="radio" name="to" value="other" ${draft.patient !== "me" ? "checked" : ""} /> Another address</label></div>
        <input id="pa" placeholder="0x… patient address" value="${draft.patient !== "me" ? esc(draft.patient) : ""}" ${draft.patient === "me" ? "hidden" : ""} />
        <button class="btn primary big" id="seal">${acc ? "Seal and hand over" : "Seal and hand over (unaccredited)"}</button>
        <p class="fine">One Arkiv transaction: create the result read-only, then change its owner to the patient. If either part fails, neither happens.</p>
      </form>`
    const save = () => {
      document.querySelectorAll("[data-v]").forEach((i) => (draft.values[`${draft.test}.${i.dataset.v}`] = i.value))
      draft.name = $("pn").value; draft.days = $("days").value
      const to = document.querySelector("input[name=to]:checked").value; draft.patient = to === "me" ? "me" : $("pa").value.trim()
    }
    $("issue").querySelectorAll("[data-test]").forEach((b) => (b.onclick = () => { save(); draft.test = b.dataset.test; paintIssue() }))
    $("issue").querySelectorAll("input[name=to]").forEach((r) => (r.onchange = () => { $("pa").hidden = r.value === "me" || !r.checked; if (r.value === "other" && r.checked) $("pa").focus() }))
    $("isf").onsubmit = async (e) => {
      e.preventDefault(); save()
      const patient = draft.patient === "me" ? me.address : draft.patient
      if (!/^0x[0-9a-fA-F]{40}$/.test(patient)) return toast("Enter the patient's 0x address.", "bad")
      const btn = $("seal"); btn.disabled = true; btn.textContent = "Encrypting…"
      const report = {
        lab: acc?.attrs?.name?.replace(/ \(sandbox\)$/, "") || prof.name || "Unnamed lab", test: t.title, sample: t.sample,
        collected: new Date().toISOString().slice(0, 10), patient: { name: draft.name, ref: `VL-${Math.floor(Math.random() * 9000 + 1000)}` },
        results: t.results.map((r, i) => ({ ...r, value: draft.values[`${draft.test}.${i}`] ?? r.value })), note: "Synthetic demo data.",
      }
      try {
        await ensureGas(pub, lab, () => (btn.textContent = "Getting test GLM…"))
        btn.textContent = "Sealing on Arkiv…"
        const out = await issue(lab.client, pub, { patient, report, days: RESULT_DAYS[draft.days] })
        secrets.set(out.key, out.secret)
        issued(out, report, patient)
      } catch (err) { toast(friendly(err), "bad"); btn.disabled = false; btn.textContent = "Try again" }
    }
  }
  const issued = (out, report, patient) => {
    const link = resultLink(location.origin, out.key, out.secret)
    $("issue").innerHTML = `<p class="eyebrow ok">Sealed and handed over</p><h3>${esc(report.test)} for ${esc(report.patient.name)}</h3>
      <div class="done"><canvas id="qr"></canvas><div>
        <p class="small">Give this link to the patient. It holds the only key that opens the result. Vial doesn't keep a copy.</p>
        <div class="linkbox"><code>${esc(link)}</code></div>
        <div class="row"><button class="btn primary" id="cp">Copy link</button><a class="btn ghost" href="/r/${out.key}#k=${out.secret}" data-link>Open as a verifier</a></div>
        <p class="fine">Result <a href="${EXPLORER}/entity/${out.key}" target="_blank" rel="noopener" class="mono">${short(out.key)}</a> · tx <a href="${EXPLORER}/tx/${out.txHash}" target="_blank" rel="noopener" class="mono">${short(out.txHash)}</a> · owner ${short(patient)}. Open the entity in the explorer: all it shows is ciphertext.</p>
      </div></div>
      <button class="btn ghost" id="another">Issue another</button>`
    QRCode.toCanvas($("qr"), link, { width: 180, margin: 1, color: { dark: "#16201f", light: "#ffffff" } })
    $("cp").onclick = () => copy(link); $("another").onclick = paintIssue
  }
  paintIssue()
  try { await head(); acc = await reading((c) => accreditationOf(c, lab.address)) } catch {}
  paintAcc(); paintIssue()
  const tick = setInterval(() => document.querySelectorAll("[data-left]").forEach((el) => (el.textContent = life(secondsLeft(el.dataset.left)))), 1000)
  cleanup.push(() => clearInterval(tick))
}

// ---------- how it works ----------
function how() {
  app.innerHTML = `<section class="narrow prose">
    <p class="eyebrow">How it works</p><h1 class="h">Four Arkiv facts do the work</h1>
    <h3>1 · Who signed it can't be forged</h3><p>Every Arkiv entity records <code>$creator</code>, the key that created it. It never changes, even when the entity changes hands. A forger can copy every field of a real result, the lab's name, the logo, the layout, but not the signature.</p>
    <h3>2 · Accreditation is an entity with a lifetime</h3><p>The regulator writes one <code>lab</code> entity per accredited lab, naming the lab's key, and it expires when the accreditation does. Verifiers only accept lab records whose <code>$creator</code> is the regulator. When an accreditation lapses or is withdrawn, the record is gone, and so is the lab's green tick.</p>
    <h3>3 · Sealed, then handed over, in one transaction</h3><p>The lab creates the result with the <code>readonly</code> flag, so nobody can ever edit it, then calls <code>changeOwnership</code> to the patient, in the same <code>executeBatch</code>. The result's key is predicted with <code>predictEntityKeys</code> so both steps fit in one transaction.</p>
    <h3>4 · The patient controls its life</h3><p>As owner, the patient can extend the result (<code>extendEntity</code>) or delete it. Deleting it is revoking it: every verifier link fails at once, and an open verifier page flips to "revoked" live, from <code>watchEntityEvents</code>.</p>
    <h3>Privacy</h3><p>On Arkiv the result carries only <code>app</code>, <code>kind</code> and a random id, plus AES-256-GCM ciphertext. The 256-bit key travels only in the link's fragment (after <code>#</code>), which browsers never send to servers. Encryption and decryption happen in the browser. Vial has no database and no copy of any key.</p>
    <h3>What it doesn't hide</h3><p>That a given lab issued <em>a</em> result to a given wallet address, and when. Patient wallets are pseudonymous, and a patient can use a fresh wallet per result. The ciphertext's length is visible too.</p>
    <p><a class="btn primary" href="${demoHref(DEMO.genuine)}" data-link>See a verified result</a></p>
  </section>`
}

route()
