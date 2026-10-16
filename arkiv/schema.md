# Vial data model (`/arkiv/schema.md`)

Vial stores two kinds of entity on Arkiv. Both carry `app = "vial"`, `net = "v1"` and a `kind`. The code version of this
file is [`shared/vial.js`](../shared/vial.js). Network: Tiramisu testnet (chain 7738577).

## Who is who

| Role | Arkiv identity | Holds |
|---|---|---|
| Regulator | the key `0x6BE641Ca56A1427f37f431e10fde993C4AbAb0B1` (`REGULATOR`) | the only key whose `lab` records count |
| Lab | any key; trusted only if the regulator wrote a live `lab` record naming it | signs results, becomes their `$creator` |
| Patient | any key | receives results, becomes their `$owner`; alone can extend or delete them |
| Verifier | nobody: reads only | a link `https://vial.nerom.site/r/<resultKey>#k=<secret>` |

## `lab`: an accreditation

Written by the regulator (sandbox: by `api/accredit.js`; demo lab: by `scripts/seed.mjs`).

| Field | Value |
|---|---|
| attributes | `app`, `net`, `kind = "lab"`, `wallet` (addr: the lab's signing key), `name` (str), `sandbox` (bool) |
| payload | JSON `{ name, city }` |
| expiry | **the accreditation itself**: 365 days, sandbox 10 days. Expired or deleted = no longer accredited. |
| `$creator` | must equal `REGULATOR`, or the record is ignored |

Anyone can write an entity that looks exactly like this (the demo forger "QuickCert Lab" did). Verifiers filter with
`.createdBy(REGULATOR)`, which a forger cannot satisfy.

Queries:
- accreditation of an address: `app = "vial" && net = "v1" && kind = "lab" && wallet = <addr>`, `createdBy(REGULATOR)`
- a forger's self-made records (shown on the verdict): the same query without `createdBy`, keeping only those not by the regulator

## `result`: a sealed lab result

Written by a lab in **one `executeBatch`**:
1. `creates[0]`: the result, with `flags: { readonly: true }` and a `salt` from `predictEntityKeys`
2. `ownershipChanges[0]`: `{ entityKey: <predicted key>, newOwner: <patient> }`

| Field | Value |
|---|---|
| attributes | `app`, `net`, `kind = "result"`, `rid` (random 72-bit id). **Nothing else: no test name, no patient, no values.** |
| payload | JSON `{ v: 1, alg: "A256GCM", iv, ct }`: the report, AES-256-GCM encrypted in the lab's browser |
| content type | `application/json` |
| flags | `readonly`: nobody can patch or update attributes or payload, ever |
| expiry | chosen by the lab at issue (7 / 30 / 90 / 365 days), then by the patient: `extendEntity` to keep it, `deleteEntity` to revoke it |
| `$creator` | the lab key (permanent: survives the ownership change) |
| `$owner` | the patient key |

The decrypted report (never on chain):
```json
{ "lab": "…", "test": "Genotype & blood group", "sample": "…", "collected": "2026-10-16",
  "patient": { "name": "…", "ref": "…" },
  "results": [{ "name": "Haemoglobin genotype", "value": "AA", "ref": "AA · AS · SS · AC" },
              { "name": "Haemoglobin", "value": "13.8", "unit": "g/dL", "low": 13, "high": 17 }],
  "note": "Synthetic demo data." }
```

The 256-bit key travels only in the link fragment (`#k=`, base64url). Browsers never send fragments to servers, and
the site sets `Referrer-Policy: no-referrer`.

Queries:
- a patient's results: `app = "vial" && net = "v1" && kind = "result"`, `ownedBy(<patient>)`
- one result: `getEntity(<key>)`

## Verification, in order ([`verify()`](../shared/vial.js))

1. `getEntity(key)`. `NoEntityFoundError` → **gone** (revoked or expired). Any other error is surfaced as an error and is
   never shown as "revoked".
2. The result's `$creator` has a live `lab` record created by `REGULATOR`, and that record is **older than the result**
   (accreditation after the fact doesn't count). If not → **unaccredited** (red).
3. The `readonly` flag is set. If not → **editable** (red): its owner could have rewritten the payload after the lab signed it.
4. The lab record's `sandbox` attribute (written by the regulator, so trustworthy) is `true` → **sandbox** (amber): a real
   signature, but self-service accreditation. Otherwise → **verified** (green).
5. `$owner ≠ $creator` (handed to a patient) is shown as a check but doesn't change the verdict.
6. The key in the link decrypts the payload (AES-GCM authenticates it, so any tampering would also fail here).

The open verifier page subscribes to `watchEntityEvents`: `EntityDeleted` on the result flips it to "revoked" live,
`ExpiryExtended` updates the expiry, and `EntityDeleted` on the lab record re-runs the check.

## Lifetimes at a glance

| Entity | Lifetime | Who can change it |
|---|---|---|
| `lab` | 365 d (sandbox 10 d) | regulator (extend to renew, delete to withdraw) |
| `result` | 7–365 d at issue | patient only (extend, delete). Not the lab, not Vial. |

## Server code

- `api/accredit.js` holds the sandbox regulator key; writes `lab` records, 3 per hour per IP, 10-day lifetime, `sandbox = true`.
- `api/drip.js` sends 0.01 test GLM to a new browser key so it can sign its own writes.
- `api/rpc.js` is a read-only relay (allow-listed read methods), used only when a visitor's anonymous Arkiv budget is exhausted.

Vial has no database. Results, accreditations and their lifetimes live on Arkiv only.
