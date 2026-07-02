# Fraud Watch

A **local-first fraud-defense browser extension** (Manifest V3). It watches for
high-risk moments, extracts a *minimal, redacted* view of the page, runs local
deterministic detectors, and shows calm, specific, overridable warnings before
harm occurs.

> Core principle: the user should feel protected and informed with a clear risk
> score for each site — without the extension behaving like spyware.

This repo currently implements the **end-to-end skeleton** (plan §12 "MVP 1"
foundations): everything runs locally, no backend yet. The Claude/model gateway
(plan §5) and threat-feed / DNR blocking (plan §4 Stage 0) are the next lanes.

## What works today

- **MV3 extension** built with [WXT](https://wxt.dev) + TypeScript, loadable in Chrome.
- **Content script** extracts redacted page features (forms, links, popups,
  visible-text snippets) — never password/OTP/card/seed *values*.
- **Redaction layer** scrubs secrets/PII before anything crosses the trust boundary.
- **Local analyzers** (independent, additive):
  - `url_domain_analyzer` — punycode, brand-embedding subdomains, typosquatting,
    off-brand credential pages.
  - `form_intent_analyzer` — login / payment / bank / tax / **crypto seed** intent,
    cross-origin form submission.
  - `popup_scareware_analyzer` — fake system warnings, remote-support scam language,
    fullscreen lock-in.
- **Weighted scoring + policy engine** → 0–100 score, 1–10 site rating, and a UX
  tier (allow / caution / warn / step-up / block) per the plan's thresholds.
- **Toolbar popup** with the risk rating, categories, *why*, and a "how it was
  calculated" per-analyzer breakdown; plus a "Trust this site" allowlist override.
- **Inline warning banner** (shadow-DOM isolated) for warn/step-up/block tiers.
- **"Report site"** — records the domain to a local bad-sites list (which flags
  it on every future visit) and forwards the report to external abuse
  authorities in the background. See [Reporting](#reporting) for what actually
  submits.
- **AI-generated-text ("slop") detector** — user-triggered from the popup.
  Highlights suspected AI-written blocks inline with a score badge (0–100) and a
  reason tooltip. A local, offline heuristic runs always; an **optional**
  self-hosted [sloptotal](https://github.com/pablocaeg/sloptotal) endpoint can be
  configured to refine results (see below).

## Architecture

```
content script (least trusted)        service worker (orchestrator)      popup
  extract.ts  redact + summarize  ──▶  validate.ts  parse/sanitize        main.ts
  banner.ts   shadow-DOM warning  ◀──  analyzers/   run detectors    ◀──▶ get_verdict
  index.ts    observe + message        scoring.ts   score + policy         render
                                       storage.ts   allowlist + cache      allowlist
```

- `lib/` holds framework-agnostic, unit-testable logic (types, redaction,
  domain utils, brands, analyzers, scoring, storage, validation).
- `lib/slop/` is the self-contained AI-text detector (types, local heuristic,
  settings, the optional sloptotal client, and its messaging). The remote fetch
  runs only in the service worker, gated on an opt-in host permission.
- `entrypoints/` holds the three WXT entrypoints (content, background, popup).
- The service worker makes the fast local decision first (plan §4). Backend
  escalation to Claude for ambiguous/high-risk cases (plan §4 Stage 3, §5) plugs
  into `handleMessage` in `entrypoints/background.ts`.

### Trust & privacy posture (plan §10)

- Local-first: nothing leaves the device in this build.
- Never reads password/OTP/card/seed input **values**; classifies fields by
  name/type/autocomplete only.
- Redacts snippets and caps payload size before any message crosses a boundary.
- Content-script messages are validated/sanitized in the service worker before use.
- Narrow permissions: `storage`, `activeTab`, `scripting`. Broad host access and
  `declarativeNetRequest` blocking are deferred to explicit opt-in (plan §8).

## Develop

```bash
npm install
npm run dev          # launches Chrome with the extension + live reload
npm run build        # production build → .output/chrome-mv3/
npm run typecheck    # tsc --noEmit
npm run zip          # store-ready zip
```

### Load a production build manually

1. `npm run build`
2. Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select `.output/chrome-mv3/`.

### Try the detectors

The content script only runs on `http/https`, so serve the fixtures locally:

```bash
cd test-fixtures && python3 -m http.server 8000
```

- `http://localhost:8000/fake-wallet-seed.html` → **critical** (crypto wallet
  drain): red block banner, toolbar rating ~7–10.
- `http://localhost:8000/fake-microsoft-login.html` → credential theft + brand
  impersonation warning.

Open the toolbar popup on any page to see the risk rating, reasons, and the
per-analyzer score breakdown.

### Try the AI-text detector

Serve the fixture and use the popup's **AI-text detection** panel → **Scan this
page**:

```bash
cd test-fixtures && python3 -m http.server 8000
# open http://localhost:8000/ai-slop-sample.html, then popup → Scan this page
```

The human paragraph stays unflagged; the LLM-boilerplate paragraphs highlight
amber/red with a score badge. This works fully offline via the local heuristic.

**Optional remote (sloptotal):** if you self-host a
[sloptotal](https://github.com/pablocaeg/sloptotal) server, expand *Optional:
sloptotal endpoint* in the popup, enter its URL (e.g. `http://localhost:8000`),
tick **Use this endpoint**, and grant the one-time host-permission prompt for
that origin. Scans then call `POST /api/scan/snippets` and override the local
scores. **This project does not host sloptotal** — you point it at your own
endpoint. When remote is off (the default) or no endpoint is set, only the
offline heuristic runs and nothing leaves the device.

## Roadmap (next lanes from the plan)

- **Stage 0 reputation** (plan §4): URL canonicalization + Web Risk / threat feeds
  + `declarativeNetRequest` dynamic rules for known-bad domains.
- **Claude gateway** (plan §5): backend model gateway with the strict
  RiskEvidenceBundle → RiskVerdict contract, prompt-injection hardening, redaction
  enforcement, prompt caching.
- **Webmail analyzers** (plan §6): Gmail/Outlook content scripts for phishing.
- **Signed config/rules updater** (plan §9 Lane B): data-only updates, no remote code.
- **Evaluation harness** (plan §14) and false-positive review loop.

## Reporting

Clicking **Report site** (in the popup or the warning banner) does two things:

1. **Records the domain locally** in a user-reported bad-sites list. The
   `user_report_analyzer` then flags that domain on every future visit (adds a
   strong risk signal + "you reported this site" evidence). It stays overridable
   via "Trust this site".
2. **Forwards the report to external authorities in the background** — a real
   form POST, no new tab, no email. From the popup, the first report triggers a
   one-time host-permission prompt so the background can submit.

Reporting is **best-effort per authority**, and only those that can be submitted
without a CAPTCHA or a required email address are attempted automatically:

| Authority | Auto-submitted? | Why |
| --- | --- | --- |
| **NCSC (UK)** | ✅ Yes | Plain webform — background `POST` with scraped form token. |
| Netcraft | ⏭️ Skipped | Protected by reCAPTCHA v3 (`POST /api/report/urls`, action `report_urls`). |
| Microsoft (WDSI) | ⏭️ Skipped | Protected by CAPTCHA. |
| Google Safe Browsing | ⏭️ Skipped | Protected by reCAPTCHA. |

The popup shows each authority's outcome (submitted / skipped + reason). For the
CAPTCHA/email-gated ones, it also offers an **"Open report page ↗"** button that
opens the authority's own report form (pre-filled with the URL where supported —
Google and Netcraft accept `?url=`). The captcha runs on the authority's own
origin there; it cannot be proxied into the extension popup, because reCAPTCHA
tokens are bound to the authority's registered domains and these sites forbid
being framed.

Implementation notes:

- Extensions with host permission are not subject to CORS, which is why the
  background `POST` reaches the authority even though a web page could not.
- NCSC rejects cross-origin POSTs (`Origin` mismatch → HTTP 403). A
  service-worker `fetch` always sends `Origin: chrome-extension://<id>`, so a
  narrow `declarativeNetRequest` session rule strips the `Origin` header for that
  one endpoint (verified: no-Origin → 200). This is gated by the same host
  permission the user granted for reporting.
- The skipped adapters live in `lib/reporters/` so a captcha-free/email-free path
  can be enabled later without touching the rest of the flow.

## License

MIT — see [`LICENSE`](./LICENSE). You may use, modify, and redistribute this
software, including commercially, provided you retain the copyright and license
notice (attribution). Third-party dependency licenses (including the MPL-2.0
build tooling pulled in by WXT) are documented in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md); keep both files when
redistributing.
