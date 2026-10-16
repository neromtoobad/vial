# Friction report (`/arkiv/friction.md`)

What got in the way while building Vial, and what worked, measured on 16 Oct 2026. Items shared with our other entry
(Tideland: budget hangs, `predictEntityKeys` on the wallet client, `-32005` on cursor pages) are only summarised here.

**Environment:** `@arkiv-network/sdk` 0.8.1 · `viem` 2.57.7 · Node 24.21.0 (macOS) · Chrome (Claude desktop browser pane) ·
Tiramisu testnet, public RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.

---

## 1. "Not found" and "budget exhausted" look alike unless you check the error class

**Surface:** `getEntity`.

**Why it matters here:** in a verifier, "this result doesn't exist" means *revoked*. Our first version caught every
error from `getEntity` as "gone", and on a dev machine whose anonymous budget was exhausted the genuine demo result
showed **"This result no longer exists"**. The cause was a 429; viem surfaced it as `HTTP request failed.` with
no hint in the message.

**Steps to reproduce:** exhaust the anonymous budget from one IP, then `await client.getEntity(<live key>)` → rejects with
`HttpRequestError` ("HTTP request failed."), the same `await` shape as a missing entity.

**What worked:** the SDK does throw a distinct `NoEntityFoundError` for a missing entity, and it is exported. We now
treat only `err instanceof NoEntityFoundError` as gone and rethrow everything else, so the page falls back to our
read-only relay. **Suggestion:** say in the `getEntity` docs that `NoEntityFoundError` is the *only* "gone" signal and
that apps making trust decisions must not catch broadly. A typed `QueryError` kind `"budget"` for HTTP 429 would also help
(see Tideland's report, item 1).

## 2. A forged accreditation record is indistinguishable without `createdBy`

**Surface:** queries.

**Not a bug, a sharp edge.** Anyone can create an entity with `kind = "lab"`, `wallet = <me>`, `name = "Real Lab"`. Our
forger demo does exactly that. A verifier that queries `wallet = <signer>` without `.createdBy(REGULATOR)` accepts it.
`$creator` being system-set and immutable is what makes Vial possible at all, but nothing in the query docs warns that
attribute-only filters are trivially spoofable. **Suggestion:** a "trust" note in the query docs: authority comes from
`$creator` / `createdBy`, never from attributes.

## 3. `readonly` + `changeOwnership` in one batch works, and the docs could say so

**Surface:** `executeBatch`, creation flags.

We needed a result that nobody can ever edit but whose *owner* is the patient, created atomically. The docs don't say
whether ownership changes are allowed on a `readonly` entity in the same batch that creates it. They are:
`executeBatch({ creates: [{ …, flags: { readonly: true }, salt }], ownershipChanges: [{ entityKey: predicted, newOwner }] })`
succeeded every time (5 of 5), and the new owner can then `extendEntity` and `deleteEntity` it. One line in the
creation-flags docs would save the experiment.

## 4. `ExpiryExtended` and `EntityDeleted` reach the verifier in about one block

**Measured:** with a verifier open in one tab and the patient in another, "Keep 30 more days" (`extendEntity`) changed
the verifier's "29 days" to "59 days" before the patient's own receipt promise resolved. "Revoke" (`deleteEntity`)
flipped the verifier to "Revoked just now" the same way. We drive the UI from the WebSocket event, not the receipt.

## 5. No event when an entity expires

**Surface:** `watchEntityEvents`.

A result that runs out of time emits nothing, so the verifier keeps a local countdown from the head block (2 s blocks)
and re-checks at zero. An `EntityExpired` event would let verifiers flip as cleanly as on delete.

## 6. Payload privacy is entirely the app's job

Arkiv payloads are public. That is expected, but a health app has no SDK help: we use WebCrypto AES-256-GCM in the
browser and keep the key in the URL fragment. A short "storing sensitive data" page in the docs (encrypt client-side,
keep attributes minimal because they're queryable, remember `$owner` is public) would help health and identity
builders avoid putting a test name in an attribute "just for filtering".

---

## Tested paths that worked as documented

| What we did | Result |
|---|---|
| `executeBatch`: `readonly` create with predicted key + `changeOwnership` to patient | Worked on every issue (5 of 5); minted key matched the prediction; `$creator` stays the lab. |
| `extendEntity` by the new owner (patient) of a `readonly` entity | Expiry moved from 29 to 59 days; verifier updated live. |
| `deleteEntity` by the owner | Entity left queries at once; `getEntity` → `NoEntityFoundError`; live verifier flipped. |
| `select().where(...).createdBy(REGULATOR)` | Returned only the regulator's lab record; the forger's identical-looking record was excluded. |
| `ownedBy(patient)` | Lists exactly the results handed to that wallet. |
| `creationFlags` read back | Resolved as `{ readonly: true, permissionlessExtension: false, raw: 1 }`. |
| AES-256-GCM payload (~400 bytes JSON) | Stored and returned byte-exact; decrypts in browser and Node. |
