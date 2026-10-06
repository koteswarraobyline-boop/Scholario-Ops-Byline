# Scholario Ops

Operations dashboard for applications running on a PRD (main) VPS and a DR (standby) VPS, with Cloudflare DNS failover.
All data is real. The server probes your endpoints, an agent on each VPS reports telemetry, and Cloudflare and Hostinger are read through their APIs.

One process (`server.ts` + `backend/`) serves both the API and the React dashboard. Data is stored as JSON in `DATA_DIR` (default `./data`); back that folder up.

> The `server/` folder is the older Postgres-based backend and is **not used**.

## Run locally

```bash
cp .env.example .env      # set ADMIN_EMAIL (and optionally ADMIN_PASSWORD)
npm install
npm run dev               # http://localhost:3000
```

If `ADMIN_PASSWORD` is empty, the first start prints a generated password in the console.

## First-time setup (in the dashboard → **Setup**)

1. **Add server.** Register the Main VPS (role PRD) and the DR VPS (role DR) with their public IPs.
2. **Agent.** Run the install command on each VPS as root. Within about 15 seconds the agent shows CONNECTED.
3. **Add application.** Choose the PRD and DR servers, the Cloudflare zone and the DNS record to switch on failover. Optionally tick the starter health monitors.
4. **Notifications.** Add a Teams, Email, Webhook or PagerDuty channel.

## Production (Ubuntu VPS)

```bash
npm ci && npm run build                     # builds dist/ and dist-server/server.js
pm2 start ecosystem.config.js --env production && pm2 save
```

- Put `nginx/scholario-ops.conf` in front of the app. It proxies `/api` to port 4000 and does not buffer the realtime stream.
- Set `PUBLIC_URL` in `.env` to the HTTPS address. Agents and notification links use it.

## Integrations (`.env`)

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Zone:Read + DNS:Edit (required for failover). SSL and Certificates:Read + Analytics:Read are optional. |
| `HOSTINGER_API_TOKEN` | Optional. Imports plan, CPU, RAM and state for registered servers. |
| `SMTP_*` | Email notification channels. |
| `DEADMAN_HEARTBEAT_URL` | External heartbeat (for example healthchecks.io) that alerts you if this server itself goes down. |
| `DEPLOY_REPORT_TOKEN` | Lets CI report deployments to `POST /api/v1/deployments/report`. |

## Scripts

- `npm run dev`: API and UI with Vite.
- `npm run build`: production build.
- `npm start`: run the build.
- `npm run lint`: type-check the frontend and backend.
