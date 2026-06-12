# Runbook: Deploy a Next.js site to AWS Amplify with a custom domain (Cloudflare DNS)

A repeatable process for putting a website live at `https://yourdomain.com` **and** `https://www.yourdomain.com`, on the AWS free tier, with free HTTPS.

**Stack:** Next.js (App Router) → GitHub → AWS Amplify Hosting → Cloudflare DNS (registrar stays GoDaddy/any).
**Proven on:** `calibrehrsolutions.ai`, `synergyglobalits.com` (2026-06-12).

Throughout, replace these placeholders:

| Placeholder | Meaning | Example |
|---|---|---|
| `<DOMAIN>` | apex/root domain | `example.com` |
| `<REPO>` | GitHub `owner/name` | `dev-x-bot/example` |
| `<APP_ID>` | Amplify app id (after step 4) | `d30k649of4xqlc` |
| `<ACCOUNT_ID>` | AWS account number | `902916048215` |
| `<REGION>` | AWS region | `us-east-1` |
| `<ALERT_EMAIL>` | budget alert email | `dev@x-bot.co` |

> Convention here: keep `aws` on PATH with `export PATH="/usr/local/bin:$PATH"` (official installer location on macOS).

---

## 0. One-time machine setup (do once, reuse forever)

### Node
```bash
node -v   # need 18+ (Next 15 likes 18.18+/20+); 22/26 fine
```

### AWS CLI v2 (macOS) — use the OFFICIAL installer
⚠️ **Do NOT `brew install awscli`** on recent macOS — the Homebrew bottle's Python 3.14 fails with a `libexpat` symbol error (`_XML_SetAllocTrackerActivationThreshold`). Use Amazon's self-contained pkg instead:
```bash
curl -fsSL "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o /tmp/AWSCLIV2.pkg
sudo installer -pkg /tmp/AWSCLIV2.pkg -target /     # needs your password
/usr/local/bin/aws --version
```

### AWS credentials (browser, once)
1. Console → **IAM → Users → Create user** (e.g. `cli-admin`), **no** console access.
2. Attach **AdministratorAccess** (simplest; tighten later).
3. Open the user → **Security credentials → Create access key → Command Line Interface (CLI)** → tick confirm → **Create** → **Download .csv**.
4. ```bash
   aws configure
   # Access Key ID, Secret Access Key, region = us-east-1, output = json
   ```
   > Use **`us-east-1`** — required for the ACM certs Amplify uses with custom domains.
5. Verify: `aws sts get-caller-identity`

### Cloudflare account (once)
Sign up free at https://dash.cloudflare.com/sign-up. All your domains share **one account nameserver pair** (e.g. `elijah.ns.cloudflare.com` / `nola.ns.cloudflare.com`).

---

## 1. Prepare the project (Next.js)

If starting from a static `index.html`, convert to Next.js App Router:
```
<project>/
├─ app/
│  ├─ layout.tsx     # metadata + next/font; <html> gets font CSS-var classes
│  ├─ page.tsx       # server component; static markup as JSX
│  ├─ <Interactive>.tsx  # "use client" for any JS (forms, handlers, state)
│  └─ globals.css    # ported CSS (remove hardcoded font-family vars; next/font supplies them)
├─ public/           # images/SVGs (reference as /logo.svg)
├─ package.json  tsconfig.json  next.config.mjs  .gitignore
```
Key conversions: `class`→`className`, self-close tags, `stroke-width`→`strokeWidth`, inline `<script>`→ a `"use client"` component with React state, assets → `public/`.

`.gitignore` must include: `/node_modules`, `/.next/`, `/out/`, `next-env.d.ts`, `.env*.local`.

Build locally before pushing — fix anything red:
```bash
npm install
npm run build
npm run dev        # optional: eyeball at localhost:3000
```

Push to GitHub (repo must already exist and you must have push access):
```bash
git add -A
git commit -m "Convert to Next.js / initial site"
git push -u origin main
```
> Git auth gotcha: macOS keychain caches **one** github.com credential. If pushing as a different account fails with `403 denied to <other-user>`, clear it:
> ```bash
> printf "protocol=https\nhost=github.com\n\n" | git credential-osxkeychain erase
> ```
> then push again and enter the correct username + a **Personal Access Token** (repo scope).

---

## 2. Cost guard — AWS Budget (free, do once per account)
```bash
export PATH="/usr/local/bin:$PATH"
cat > /tmp/budget.json <<'EOF'
{ "BudgetName": "monthly-5usd-guard", "BudgetLimit": { "Amount": "5", "Unit": "USD" },
  "TimeUnit": "MONTHLY", "BudgetType": "COST" }
EOF
cat > /tmp/budget-notifications.json <<EOF
[
 {"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":1,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<ALERT_EMAIL>"}]},
 {"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<ALERT_EMAIL>"}]},
 {"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":100,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<ALERT_EMAIL>"}]},
 {"Notification":{"NotificationType":"FORECASTED","ComparisonOperator":"GREATER_THAN","Threshold":100,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<ALERT_EMAIL>"}]}
]
EOF
aws budgets create-budget --account-id <ACCOUNT_ID> \
  --budget file:///tmp/budget.json \
  --notifications-with-subscribers file:///tmp/budget-notifications.json
```
> AWS Budgets: first 2 budgets are **free**. Only need this once total, not per site.

---

## 3. Create the Amplify app (console — GitHub auth can't be scripted)
1. Console → **Amplify** (confirm region top-right = `<REGION>`).
2. **Create new app → GitHub** → authorize the **AWS Amplify** GitHub App → pick the account → install on the repo(s).
3. Repository **`<REPO>`**, branch **`main`** → Next.
4. Amplify auto-detects **Next.js** — accept default build settings; let it auto-create the service role.
5. **Save and deploy.** Wait ~2–4 min → you get `https://main.<APP_ID>.amplifyapp.com`.
6. Grab the app id for later:
   ```bash
   aws amplify list-apps --region <REGION> \
     --query 'apps[].{name:name,appId:appId,repo:repository}' --output table
   ```

Verify the default URL works:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://main.<APP_ID>.amplifyapp.com
```

---

## 4. Attach the custom domain (CLI) — generates the DNS records
```bash
export PATH="/usr/local/bin:$PATH"
aws amplify create-domain-association --app-id <APP_ID> --region <REGION> \
  --domain-name <DOMAIN> \
  --sub-domain-settings 'prefix=,branchName=main' 'prefix=www,branchName=main'
```
Wait ~10–20s, then pull the records you must add to DNS:
```bash
aws amplify get-domain-association --app-id <APP_ID> --region <REGION> --domain-name <DOMAIN> \
  --query 'domainAssociation.{status:domainStatus,acm:certificateVerificationDNSRecord,subs:subDomains[].dnsRecord}' \
  --output json
```
You'll get three things (note them):
- **ACM validation CNAME** — `_xxxx.<DOMAIN>. CNAME _yyyy.<id>.acm-validations.aws.`
- **apex record** — `CNAME <something>.cloudfront.net`
- **www record** — `www CNAME <something>.cloudfront.net`

(Domain association + ACM cert are **free**.)

---

## 5. Move DNS to Cloudflare + add records
Done **once per domain**.

1. Cloudflare → **+ Add → Existing domain** → `<DOMAIN>` → **Free** plan.
2. Cloudflare imports the registrar's records. **Clean up:**
   - ❌ **Delete** old host records: any `A @` (e.g. GitHub Pages `185.199.108–111.153`), old `www` CNAME, registrar `_domainconnect` CNAME.
   - ✅ **Keep** all email records: `MX`, SPF `TXT (v=spf1…)`, DKIM `TXT`, `_dmarc TXT`, and any mail-provider CNAME (e.g. Mailgun `email → mailgun.org`). **Mail-related CNAMEs must be DNS-only (grey).**
3. **Add the 3 records from step 4** — all **DNS only (grey cloud)**:

   | Type | Name | Target | Proxy |
   |---|---|---|---|
   | CNAME | `_xxxx` (part before `.<DOMAIN>`) | `_yyyy.<id>.acm-validations.aws` | **grey** |
   | CNAME | `@` (shows as the root domain) | `<...>.cloudfront.net` | **grey** |
   | CNAME | `www` | `<...>.cloudfront.net` | **grey** |

   > 🔴 **The #1 gotcha:** the apex `@` record MUST be **grey (DNS only)**. If it's orange (Proxied) it resolves to Cloudflare IPs and **blocks ACM validation + serving**. Cloudflare's CNAME-flattening makes apex-as-CNAME work in grey mode.
4. **Continue to activation** → copy Cloudflare's **2 nameservers**.
5. At the **registrar** (GoDaddy etc.): domain → **Nameservers → Change → "I'll use my own nameservers"** → replace with Cloudflare's two → **Save**. *(This is the only registrar change, ever.)*

---

## 6. Verify
```bash
export PATH="/usr/local/bin:$PATH"
# nameservers flipped?
dig +short NS <DOMAIN> @1.1.1.1
# apex must resolve to CloudFront (Amazon 13.x/108.x), NOT Cloudflare (104.21.x/172.67.x):
dig +short <DOMAIN> @1.1.1.1
dig +short www.<DOMAIN> @1.1.1.1
# Amplify status: PENDING_VERIFICATION -> AWAITING_APP_CNAME / PENDING_DEPLOYMENT -> AVAILABLE
aws amplify get-domain-association --app-id <APP_ID> --region <REGION> --domain-name <DOMAIN> \
  --query 'domainAssociation.domainStatus' --output text
# live check (expect 200 / 200, and http -> 301)
for u in https://<DOMAIN> https://www.<DOMAIN> http://<DOMAIN>; do
  curl -s -o /dev/null -w "$u -> %{http_code}\n" "$u"; done
# confirm served by Amplify:
curl -sI https://<DOMAIN> | grep -i 'x-amz-cf-id\|x-cache'
```
**Timing:** nameserver flip = minutes; ACM validation + Amplify association = **10–30 min** after DNS is correct. During that window apex may bounce `000`/`403` — normal. Status labels lag the real state (a site can serve `200` while status still says `AWAITING_APP_CNAME`).

---

## 7. Ongoing: updating the site
Just push to `main` — Amplify auto-rebuilds & redeploys:
```bash
git add -A && git commit -m "update" && git push
```

---

## 8. Optional hardening (after it's live & green)
- **Cloudflare edge + Always-Use-HTTPS:** set **SSL/TLS → Overview → Full**, then flip `@` and `www` to **Proxied (orange)**. Keep the **ACM validation record grey forever**. (Not required — Amplify already does HTTP→HTTPS.)
- **Old host cleanup:** if the domain previously used GitHub Pages, set that repo's **Settings → Pages → Source → None** so it stops publishing. Harmless once DNS points to Amplify, but tidy.
- **Tighten IAM:** swap `AdministratorAccess` for a scoped policy, or delete the access key when not actively deploying.

---

## Quick checklist (per new site)
- [ ] Repo on GitHub, builds locally (`npm run build`), pushed to `main`
- [ ] Amplify app created from repo, default URL = 200
- [ ] `create-domain-association` run; 3 DNS records captured
- [ ] Cloudflare zone added; old records cleaned; email records kept
- [ ] 3 records added **all grey**; apex `@` grey (double-check!)
- [ ] Registrar nameservers → Cloudflare's pair
- [ ] apex + www = 200 over HTTPS; http = 301; served by CloudFront
- [ ] (Budget guard already exists account-wide)
