# Vial

**A lab result anyone can check, and only the patient can read.** Built on [Arkiv](https://arkiv.network) for the
Global Tour Stop hackathon (Security and Privacy tracks).

Live: **https://vial.nerom.site** · Tiramisu testnet · synthetic data only

- [A genuine result](https://vial.nerom.site/r/0x04511855f004d5448e2a0a4bda7991faaf52fc5d2e37be8be1e06026f06e25ff#k=L9D3KKap1GP3Dw3kg8DFpYg1RKNT_g9BWmKhI-TjRc8) (Harbourside Diagnostics, accredited)
- [A forged one](https://vial.nerom.site/r/0x169f8eb6fdc2da619330dc2bd25159a1760ed8ba8a7f9ba08fa364931e4ec673#k=1tbrXXKdEZGJi7mfiqSheZmUG6l-AINAds9i4lFG9x8) (QuickCert Lab wrote its own "accreditation")

## The problem

In Nigeria, couples are asked for a genotype certificate before marriage, employers ask for malaria and fitness
results, and travel desks ask for test certificates. Paper results are cheap to forge, and a printout can't be taken back
once it's handed over: whoever holds the copy holds your HIV status forever.

## How Vial works

| | |
|---|---|
| **The lab seals it** | The report is encrypted in the lab's browser (AES-256-GCM), written to Arkiv with the `readonly` flag, and its ownership is handed to the patient, all in **one `executeBatch`**. |
| **The patient holds it** | The patient is the entity's `$owner`. Only they can `extendEntity` (keep it longer) or `deleteEntity` (revoke it). |
| **Anyone checks it** | A verifier opens `/r/<key>#k=<secret>`. Vial checks that the result exists, that its `$creator` holds a live `lab` record **written by the regulator**, that it's read-only and held by a patient, and decrypts it in the browser. |
| **Revocation is live** | An open verifier page subscribes to `watchEntityEvents`. When the patient revokes, it flips to "revoked" within about a block. |

### Security (who signed it can't be forged)
- Trust comes from `$creator`, which Arkiv sets and nobody can change, not from any attribute. A forger can copy every
  field of a real result, and even write a `lab` record naming themselves. The verifier only accepts lab records
  `createdBy(REGULATOR)`, and shows the forger's record so the reader sees why it failed.
- Accreditation is an entity whose **lifetime is the accreditation**. Lapsed or withdrawn means gone, and a lab
  accredited *after* issuing a result doesn't retro-validate it.
- `readonly`: nobody (not the lab, not the patient, not Vial) can edit a result. A result without the flag never verifies
  green, because its owner could have rewritten it after the lab signed. AES-GCM also authenticates the ciphertext.
- Sandbox accreditation (the self-service button that lets anyone try the lab side) shows **amber**, never green. Only
  labs the regulator accredited directly (the demo's Harbourside Diagnostics) verify green.
- A network or rate-limit error is never shown as "revoked": only `NoEntityFoundError` means gone.

### Privacy (only the patient decides who reads it)
- On chain: `app`, `kind`, a random id, ciphertext, the lab's and patient's addresses, and an expiry. No test name, no
  values, no names.
- The key sits only in the link fragment (`#k=`), which browsers never send to servers; `Referrer-Policy: no-referrer`.
- No database, no server-side copy of any key. Encryption and decryption happen in the browser.
- The patient chooses the lifetime and can revoke at any time; a revoked result is gone from Arkiv for every link at once.
- What stays visible: that a lab issued *a* result to a wallet address, and when. A patient can use a fresh wallet per result.

## Try every side
1. **Lab desk** (`/lab`): get a 10-day sandbox accreditation from the sandbox regulator (verifiers show sandbox labs in amber), pick a test, seal it, hand it
   to this browser's patient wallet (or any address). Or skip accreditation and watch the verifier reject you.
2. **My results** (`/me`): share (link + QR), keep 30 more days, revoke.
3. **Verify** (`/verify`): paste a link.

Each browser gets its own lab and patient keys, topped up with test GLM by `/api/drip`.

## Arkiv features used
`$creator` / `$owner` · `createdBy` / `ownedBy` queries · `executeBatch` with `predictEntityKeys` + `salt` ·
`changeOwnership` · `readonly` creation flag · entity expiration as meaning (accreditation, result lifetime) ·
`extendEntity` · `deleteEntity` · `watchEntityEvents` over WebSocket · encrypted JSON payloads.

See [`arkiv/schema.md`](arkiv/schema.md) for the data model and [`arkiv/friction.md`](arkiv/friction.md) for the friction report.

## Wallets (Tiramisu)
| Role | Address |
|---|---|
| Regulator (sandbox) | `0x6BE641Ca56A1427f37f431e10fde993C4AbAb0B1` |
| Harbourside Diagnostics (accredited demo lab) | `0x37EE4A732251B2513e13EF47Cc6709Afbf1e5a4F` |
| QuickCert Lab (forger, not accredited) | `0x0fd3ddBbDCaDcE2C008BF02979643F6724a5DDD9` |
| Demo patient | `0x9FE40c815803Aeda8D231532Bd6cD2F3A22D2Bc7` |
| Treasury (test GLM drip) | `0x15182825237e9E13F4822B7eb92eDf15E95470f9` |

## Run it
```bash
npm install
npm run dev            # http://localhost:5175 (reads keys from ~/.vial for the API routes)
node scripts/seed.mjs status|fund|labs
```
Vercel env: `TREASURY_KEY`, `REGULATOR_KEY`, `ARKIV_ACCESS_KEY` (optional; for the read relay).

## Layout
- `shared/vial.js`: the data contract (accredit, issue, verify, seal/unseal, queries), used by the web app, the API and the seed script
- `web/`: Vite + vanilla JS app (`main.js` routes `/`, `/lab`, `/me`, `/verify`, `/r/<key>`, `/how`)
- `api/`: `accredit.js` (sandbox regulator), `drip.js` (test GLM), `rpc.js` (read-only relay)
- `scripts/seed.mjs`: funds keys, accredits the demo lab, plays the forger, issues the demo results

Art: icons generated with Higgsfield. License: MIT.
