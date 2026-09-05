# Owner Setup Runbook — Site, Domain, Droplet

Director deliverable, 2026-09-05, per DEC-032. These are the manual steps
**only you (the owner) can perform** because they involve your Cloudflare
account, your domain, your DigitalOcean droplet, and this repo's GitHub
secrets. Everything else (workflow YAML, the API code, compose files) is
agent work and is NOT in this document.

**Placeholders used throughout — substitute your real values everywhere:**

- `<yourdomain.com>` — your purchased domain (its DNS is already on
  Cloudflare). Wherever you see it, type your actual domain.
- `<droplet-ip>` — your droplet's public IPv4 address (you capture it in
  Step 1).
- `<you>` — your chosen admin username on the droplet.

Steps assume the droplet runs Ubuntu (22.04 or 24.04). Step 1 confirms
that; **if it turns out to be something else, stop after Step 1 and report
the facts back — the commands from Step 6 onward would need adjusting.**

---

## Checklist

**Part A — do NOW (site live + droplet prepared):**

- [ ] 1. Gather droplet facts and report them
- [ ] 2. Confirm the domain zone is active on Cloudflare
- [ ] 3. Create the Cloudflare Pages project
- [ ] 4. Create the Cloudflare API token + add GitHub repo secrets
- [ ] 5. Attach the custom domain to Pages + set zone SSL settings
- [ ] 6. Create the `api` DNS record pointing at the droplet
- [ ] 7. Harden the droplet (admin user, SSH keys, firewall, auto-updates)
- [ ] 8. Install Docker Engine + Compose plugin
- [ ] 9. Create the Cloudflare Origin certificate and install it on the
       droplet; set SSL mode to Full (strict)
- [ ] 10. Create the deploy user and add droplet deploy secrets to GitHub
- [ ] 11. Run the Part A verification checklist

**Part B — do WHEN THE API SHIPS (TASK-707; do NOT do these now — there
is no API or database to run yet):**

- [ ] 12. Create the server `.env` with a strong Postgres password
- [ ] 13. First `docker compose up` of the API stack
- [ ] 14. Enable daily database backups
- [ ] 15. Trigger the first automated deploy and run the API verification
       checklist

---

# Part A — Do NOW

## Step 1 — Gather droplet facts

SSH into the droplet however you do today (likely `ssh root@<droplet-ip>`
using the key DigitalOcean has for you). Run each command and save the
output — paste all of it back to the Director:

```bash
# OS and version (steps below assume Ubuntu 22.04/24.04)
cat /etc/os-release

# RAM and swap
free -h

# Disk space
df -h /

# CPU count
nproc

# Public IPv4 (this is <droplet-ip> for the rest of this document)
curl -4 -s ifconfig.me; echo

# Every port something is already listening on, and what owns it
sudo ss -tlnp

# Running services (look for anything you already host on this droplet)
systemctl list-units --type=service --state=running --no-pager
```

Why this matters: the plan must not assume a fresh droplet. If `ss -tlnp`
shows something already using port **80** or **443** (an existing nginx,
Apache, another app), or the OS is not Ubuntu, **stop and report before
continuing past Step 5** — the reverse-proxy steps would need to be merged
with whatever is already there instead of installed fresh.

Also check RAM: the future API stack (Postgres + Node API + Caddy in
Docker) is comfortable in 1 GB but happier in 2 GB. If `free -h` shows
1 GB or less total, note it; we may add a small swap file in Part B.

## Step 2 — Confirm the domain zone is active on Cloudflare

1. Log in at https://dash.cloudflare.com.
2. On the account home you should see `<yourdomain.com>` listed with a
   green "Active" status.
3. If it says "Pending Nameserver Update", finish moving the domain's
   nameservers to the two Cloudflare nameservers shown there (done at your
   registrar), and wait for Active before continuing to Step 5.

## Step 3 — Create the Cloudflare Pages project

The game deploys from GitHub Actions (the workflow uploads the tested
build), so create a **Direct Upload** project — do NOT connect the Git
repository (a Git-connected project would make Cloudflare rebuild the game
itself, bypassing our CI gate).

1. Cloudflare dashboard → **Workers & Pages** → **Create** →
   **Pages** tab → **Upload assets** (Direct Upload).
2. Project name: `lootdivers` (this becomes `lootdivers.pages.dev`).
3. It will ask you to upload something to finish creating the project.
   Upload any single placeholder file (e.g. an empty `index.html` you make
   on your desktop). The first real CI deploy will replace it.
4. Note the project name exactly — the deploy workflow must reference it.

## Step 4 — Create the Cloudflare API token + add GitHub repo secrets

The GitHub Actions deploy job authenticates to Cloudflare with a scoped
token. Create it:

1. Cloudflare dashboard → click the profile icon (top right) →
   **My Profile** → **API Tokens** → **Create Token** → scroll to
   **Create Custom Token** → **Get started**.
2. Token name: `lootdivers-pages-deploy`.
3. Permissions: **Account** → **Cloudflare Pages** → **Edit**. Nothing
   else.
4. Account Resources: Include → your account.
5. Continue → Create Token → **copy the token now** (it is shown once).

**NEVER paste the real token or account ID into this file or any other
repo file — they belong only in the GitHub secrets below.** (A pasted
token was caught here by push protection on 2026-09-05 and removed;
that token should be rolled: Cloudflare → My Profile → API Tokens →
"..." on `lootdivers-pages-deploy` → Roll, then update the GitHub
secret.)

Find your Account ID:

1. Cloudflare dashboard → **Workers & Pages** (or any zone Overview
   page) → the **Account ID** is shown in the right-hand sidebar. Copy it.

Add both to the GitHub repository as Actions secrets:

1. Go to https://github.com/mot-stuff/LootDivers →
   **Settings** (repo settings, top tab) → left sidebar
   **Secrets and variables** → **Actions** → **New repository secret**.
2. Create secret `CLOUDFLARE_API_TOKEN` = the token you copied.
3. Create secret `CLOUDFLARE_ACCOUNT_ID` = the account id.

## Step 5 — Attach the custom domain to Pages + zone SSL settings

Attach the apex and `www` to the Pages project (Cloudflare creates the
DNS records for you because the zone is on the same account):

1. **Workers & Pages** → open the `lootdivers` project →
   **Custom domains** tab → **Set up a custom domain**.
2. Enter `<yourdomain.com>` (the apex). Confirm — Cloudflare adds the
   record automatically. Wait for the domain to show **Active**.
3. Repeat with `www.<yourdomain.com>`.

Zone-wide SSL settings (do these once):

1. Select `<yourdomain.com>` from the dashboard home → **SSL/TLS** →
   **Overview** → set encryption mode to **Full (strict)**. (Pages is
   always valid HTTPS, so this is safe now, and Step 9 makes the droplet
   satisfy it too.)
2. **SSL/TLS** → **Edge Certificates** → turn **Always Use HTTPS** on.

## Step 6 — Create the `api` DNS record pointing at the droplet

1. Select `<yourdomain.com>` → **DNS** → **Records** → **Add record**.
2. Type: **A** · Name: `api` · IPv4 address: `<droplet-ip>` ·
   Proxy status: **Proxied** (orange cloud ON).
3. Save.

Proxied means visitors and attackers see Cloudflare's IPs, not your
droplet's, and Cloudflare's TLS/DDoS protection sits in front of the API.
Nothing answers on `api.<yourdomain.com>` yet — that is expected until
Part B.

## Step 7 — Harden the droplet

All commands run on the droplet. First session as `root` (or however you
log in today).

**7a. Create your admin user** (replace `<you>`):

```bash
adduser <you>            # pick a strong password when prompted
usermod -aG sudo <you>
```

**7b. Give it your SSH key.** On your **Windows machine** (PowerShell),
print your public key (if you don't have one: `ssh-keygen -t ed25519`
first, accept defaults):

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Back on the **droplet**:

```bash
mkdir -p /home/tom/.ssh
nano /home/tom/.ssh/authorized_keys   # paste the public key line, save (Ctrl+O, Enter, Ctrl+X)
chmod 700 /home/tom/.ssh
chmod 600 /home/tom/.ssh/authorized_keys
chown -R tom:tom /home/tom/.ssh
```

**Open a NEW terminal and confirm `ssh <you>@<droplet-ip>` works and that
`sudo whoami` prints `root` — before doing 7c. Do not lock yourself out.**

**7c. Disable root login and password authentication:**

```bash
sudo nano /etc/ssh/sshd_config
```

Find (or add) these lines and set them exactly (remove any leading `#`):

```
PermitRootLogin no
PasswordAuthentication no
```

Also check for override files that could undo you:
`ls /etc/ssh/sshd_config.d/` — if `50-cloud-init.conf` (or similar)
contains `PasswordAuthentication yes`, edit that file too. Then:

```bash
sudo systemctl restart ssh
```

Keep your current session open, and verify a fresh
`ssh <you>@<droplet-ip>` still works.

**7d. Firewall — allow only SSH, HTTP, HTTPS:**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable        # answer y
sudo ufw status verbose
```

Expected: 22, 80, 443 allowed, everything else denied. (80/443 sit idle
until Part B; opening them now is harmless.) If Step 1 revealed other
services you host here that need their ports, add them explicitly.

**7e. Automatic security updates:**

```bash
sudo apt-get update
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # choose Yes
```

## Step 8 — Install Docker Engine + Compose plugin

We run the future API stack (Postgres + API + reverse proxy) with Docker
Compose rather than native installs: one declarative file defines the
whole stack, versions are pinned instead of drifting with the OS, the
database lives in one named volume (one thing to back up), and wiping or
rebuilding the stack never contaminates the droplet itself. On the
droplet, run the official install (from docs.docker.com, condensed):

```bash
# Prerequisites and Docker's apt repository
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

# Docker Engine + Compose plugin
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify
sudo docker run --rm hello-world
docker compose version
```

Let your admin user run docker without sudo:

```bash
sudo usermod -aG docker tom
# log out and back in, then verify:
docker ps
```

## Step 9 — Cloudflare Origin certificate on the droplet (Full strict)

With the `api` record proxied, browsers talk TLS to Cloudflare; Cloudflare
then talks TLS to your droplet. **Full (strict)** (set in Step 5) means
Cloudflare verifies the droplet's certificate. The simplest correct
certificate for that hop is a **Cloudflare Origin CA certificate**: free,
valid 15 years, zero renewal automation — it is only trusted by
Cloudflare, which is exactly the only client that will ever connect to the
droplet directly.

1. Cloudflare dashboard → select `<yourdomain.com>` → **SSL/TLS** →
   **Origin Server** → **Create Certificate**.
2. Keep defaults: RSA (2048), hostnames `*.<yourdomain.com>` and
   `<yourdomain.com>`, validity 15 years → **Create**.
3. Two text boxes appear: **Origin Certificate** and **Private Key**.
   Copy each into files on the droplet:

```bash
sudo mkdir -p /opt/lootdivers/certs
sudo nano /opt/lootdivers/certs/origin.pem      # paste the Origin Certificate, save
sudo nano /opt/lootdivers/certs/origin-key.pem  # paste the Private Key, save
sudo chmod 600 /opt/lootdivers/certs/origin-key.pem
```

(The private key is shown only once — if you lose it, just create a new
certificate.) The reverse proxy (Caddy, shipped with the API stack in
Part B) will mount these files; nothing else to do now.

## Step 10 — Deploy user + GitHub deploy secrets

The future deploy path: GitHub Actions, after a green main build of the
API, SSHes into the droplet as a low-privilege `deploy` user and runs a
pull-and-restart script. Prepare the user and secrets now so the API task
needs zero owner involvement later.

**10a. On the droplet — create the user and app directory:**

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/lootdivers
sudo chown -R deploy:deploy /opt/lootdivers
```

**10b. On your Windows machine — generate a dedicated deploy keypair**
(no passphrase — CI can't type one):

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\lootdivers_deploy -N '""' -C "lootdivers-deploy"
type $env:USERPROFILE\.ssh\lootdivers_deploy.pub
```

**10c. On the droplet — authorize the public key for `deploy`:**

```bash
sudo mkdir -p /home/deploy/.ssh
sudo nano /home/deploy/.ssh/authorized_keys   # paste the lootdivers_deploy.pub line
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
```

Verify from Windows: `ssh -i $env:USERPROFILE\.ssh\lootdivers_deploy deploy@<droplet-ip>` gets a shell.

**10d. Add the GitHub secrets** (same UI path as Step 4:
repo → Settings → Secrets and variables → Actions → New repository
secret):

- `DROPLET_HOST` = `<droplet-ip>`
- `DROPLET_SSH_USER` = `deploy`
- `DROPLET_SSH_KEY` = the **entire contents** of the PRIVATE key file
  (`type $env:USERPROFILE\.ssh\lootdivers_deploy` — from
  `-----BEGIN OPENSSH PRIVATE KEY-----` through the END line inclusive).

## Step 11 — Part A verification checklist

Run these from your Windows machine (after the first CI deploy lands on
Pages; until then the pages.dev/domain checks will show the Step 3
placeholder):

```powershell
# DNS: apex + www resolve through Cloudflare; api points at the proxy
nslookup <yourdomain.com>
nslookup www.<yourdomain.com>
nslookup api.<yourdomain.com>

# Site over HTTPS (placeholder until first deploy; game after)
curl.exe -sI https://<yourdomain.com>/ | Select-String "HTTP","cache-control"
curl.exe -sI https://lootdivers.pages.dev/ | Select-String "HTTP"

# HTTP redirects to HTTPS (Always Use HTTPS)
curl.exe -sI http://<yourdomain.com>/ | Select-String "HTTP","location"
```

And on the droplet / via SSH:

```powershell
# Admin login works, root login refused, deploy login works
ssh <you>@<droplet-ip> "sudo ufw status verbose && docker compose version"
ssh root@<droplet-ip>      # expected: Permission denied
ssh -i $env:USERPROFILE\.ssh\lootdivers_deploy deploy@<droplet-ip> "ls /opt/lootdivers"
```

Expected end-state for Part A: game reachable at `https://<yourdomain.com>`
(after TASK-706's first deploy), `?autostart` works there, droplet
hardened with Docker ready, origin cert staged, deploy secrets in GitHub —
and **nothing running on the droplet yet**.

---

# Part B — Do WHEN THE API SHIPS (TASK-707)

Do not perform these now. Verified 2026-09-05 against the TASK-707
implementation as shipped: the `server/` workspace in this repo contains
the Fastify API, SQL migrations (run automatically when the API starts —
you never run migrations by hand), `docker-compose.yml`, `Caddyfile`,
`backup.sh`, and `deploy.sh`. The deploy workflow SSHes in as `deploy`
and runs `server/deploy.sh`, which clones the repo to
`/opt/lootdivers/app` on the first run (no manual checkout needed),
resets it to `origin/main` on every later run, and runs Compose from
`/opt/lootdivers/app/server` with your `/opt/lootdivers/.env`. The
`server/.env.example` file documents both variables Step 12 creates.

## Step 12 — Create the server `.env`

On the droplet. The `.env` lives OUTSIDE the checkout (so deploys never
touch it):

```bash
mkdir -p /opt/lootdivers
cd /opt/lootdivers

# Database password: generated once, never typed again (the compose file
# passes it to Postgres and the API).
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" > .env

# Your real domain (no placeholder!) — the API uses it for CORS and
# cookie scope:
echo "APP_DOMAIN=<yourdomain.com>" >> .env

chmod 600 .env
```

## Step 13 — First start of the API stack

The first deploy (Step 15) normally does this for you; these are the
manual equivalents and the health checks:

```bash
cd /opt/lootdivers/app/server
docker compose --env-file /opt/lootdivers/.env up -d
docker compose ps          # expect postgres, api, caddy all "running"
docker compose logs --tail=50 api   # look for "migrations applied" and "listening"
```

Postgres data lives in a named Docker volume (`pgdata`); the compose file
mounts `/opt/lootdivers/certs` into Caddy for the Step 9 origin
certificate. Migrations run automatically at API startup — a clean boot
log means the schema exists.

## Step 14 — Daily database backups

The repo ships `server/backup.sh` (`pg_dump` from the running container
into `/opt/lootdivers/backups`, dated, with retention). Your step is just
scheduling it:

```bash
mkdir -p /opt/lootdivers/backups
sudo crontab -u deploy -e
# add (3:17 AM server time daily):
17 3 * * * /opt/lootdivers/app/server/backup.sh >> /opt/lootdivers/backups/backup.log 2>&1
```

Occasionally copy a dump off the droplet (your machine or DO Spaces) —
a backup that lives only on the server it backs up is half a backup.

**Restore drill (do once after your first backup):** the exact commands
are documented in the header of `server/backup.sh` — they restore the
newest dump into a scratch `restore_drill` database, count the
`characters` rows to prove the data is intact, and drop the scratch
database. A backup you have never restored is a hope, not a backup.

## Step 15 — First automated deploy + API verification

Trigger: merge the TASK-707 PR to main (or re-run the deploy workflow).
Then verify from your Windows machine:

```powershell
# Health endpoint through Cloudflare (proves DNS + proxy + Caddy + API + DB)
curl.exe -s https://api.<yourdomain.com>/healthz

# TLS mode sanity: loads over HTTPS with no certificate warnings
curl.exe -sI https://api.<yourdomain.com>/healthz | Select-String "HTTP"
```

And the full loop in the game: sign up on the homepage, create a
character (name it, admire the barbarian), play until a zone travel saves
it, open the game on a different browser/machine, log in — the character
is in your list and continues where the save left it.

---

## If something goes wrong

- Locked out of SSH: use the DigitalOcean dashboard → your droplet →
  **Access** → **Launch Recovery Console** to get a root console and undo
  the last `sshd_config` change.
- `api.<yourdomain.com>` shows Cloudflare error 521/522 in Part B: the
  droplet isn't answering on 443 — check `docker compose ps` and
  `sudo ufw status`.
- Anything unexpected in Step 1's facts (non-Ubuntu OS, ports 80/443
  already occupied, <1 GB RAM): report to the Director before continuing;
  the plan adapts, not you.
