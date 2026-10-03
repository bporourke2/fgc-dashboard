# FGC Dashboard

A small, free and open-source **web dashboard for [Free-Games-Claimer-Remaster](https://github.com/P-Adamiec/Free-Games-Claimer-Remaster)** (FGC-R), packaged as a Docker add-on that runs next to it.

- ⏱ **Next run**: a live countdown worked out from FGC-R's scheduler settings (`SCHEDULER_HOURS`, `SCHEDULER_FIXED_TIMES`, `SCHEDULER_TIMEZONE`), plus the next 5 runs.
- 🟢 **Run status**: whether a claim run is in progress right now, when the last one ran, how long it took, and a history of recent runs.
- 🧩 **Services**: which stores are enabled through `STORES`, whether credentials and 2FA are set, and how many games each store has claimed, already owned or failed.
- 🎮 **Claimed games**: every game from FGC-R's database. You can search it and filter it by store, status and account. Prime Gaming games show where to redeem them (GOG, Legacy Games…) and the code if you allow it.
- 📈 Claims per month, failure screenshots, light and dark themes, and a layout that works on phones.

It is **read-only**: it never changes the claimer's data and cannot start or stop anything.
It has **zero npm dependencies** (Node 24 built-ins only) and loads nothing from CDNs, so it works fully offline on your LAN.

If you find it useful, you can support the project:

<a href="https://www.buymeacoffee.com/bporourke2"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=bporourke2&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="50"></a>

## Install (add-on for an existing FGC-R install)

The dashboard is an **add-on**. It doesn't run the claimer; it sits next to your existing FGC-R container and reads its data folder (`/fgc/data`, which holds `fgc.db`) read-only.

**First, find the claimer's data folder on the host.** It's whatever the claimer's compose file mounts at `/fgc/data`:

| Claimer's compose has | Set `FGC_DATA` to |
|---|---|
| A bind mount, e.g. `./data:/fgc/data` in `/opt/stacks/fgc` | The absolute path: `/opt/stacks/fgc/data` |
| A named volume, e.g. `fgc_data:/fgc/data` | `/var/lib/docker/volumes/<volume>/_data`. Find the volume with `docker volume ls \| grep fgc_data`, e.g. `/var/lib/docker/volumes/fgc_fgc_data/_data` |

You can also run `docker inspect fgc-remaster --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'` and use the source path shown for `/fgc/data`.

```bash
git clone https://github.com/bporourke2/fgc-dashboard && cd fgc-dashboard
cp .env.example .env
# set FGC_DATA (and FGC_CONTAINER if your claimer isn't named fgc-remaster) in .env
docker compose up -d
```

Open <http://localhost:8080>.

This `.env` is only for the dashboard. It is **not** the claimer's `.env`, and the dashboard never needs your store credentials.

**Same compose file as the claimer:** you can instead copy the `dashboard` and `socket-proxy` services into FGC-R's `docker-compose.yml`. Mount the same source the claimer uses, read-only, e.g. `./data:/fgc/data:ro` or `fgc_data:/fgc/data:ro`.

To build the image yourself instead of pulling it: `docker build -t ghcr.io/bporourke2/fgc-dashboard:latest .`, then `docker compose up -d`.

### Portainer

1. Find the claimer's data folder (see the table above), e.g. `/opt/stacks/fgc/data`.
2. Go to **Stacks → Add stack**, choose **Repository**, and fill in:
   - URL: `https://github.com/bporourke2/fgc-dashboard`
   - Reference: `refs/heads/main`
   - Compose path: `docker-compose.yml`

   Or choose **Web editor** and paste [`docker-compose.yml`](docker-compose.yml).
3. Under **Environment variables**, set `FGC_DATA` to the folder from step 1. Optionally set `FGC_CONTAINER`, `DASHBOARD_PORT`, `DASHBOARD_USER` and `DASHBOARD_PASS` (see [`.env.example`](.env.example)).
4. Click **Deploy the stack** and open `http://<host>:8080`.

This needs a standalone Docker environment, not Swarm: Swarm ignores `container_name`, so the dashboard can't find the claimer by name.

## How it gets its information

| What | Where it comes from |
|---|---|
| Claimed games | `/fgc/data/fgc.db` (table `claimed_games`), opened read-only |
| Enabled services and schedule | The claimer container's environment (via Docker), or the mounted `.env` / `data/config.env` |
| Exact next run | Container start time plus `SCHEDULER_HOURS` (APScheduler counts from start), combined with fixed times |
| Last run / running now | `🎮 Starting claiming run…` and `✔ Claiming run complete.` lines in the claimer's logs |
| Screenshots | `/fgc/data/screenshots/<store>/*.png` |

### Docker access is optional (but recommended)

FGC-R doesn't write its schedule or run history to disk. Exact timing therefore needs the container's start time and its logs.
The compose file uses [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy) with only `CONTAINERS=1`. That allows read-only `inspect` and `logs` calls. Its port is never published, so only containers in the same stack can reach it.

Without Docker access (`DOCKER_HOST` unset):

- Configuration is read from the `.env` file mounted at `/fgc/.env`, or from `data/config.env`.
- Fixed-time schedules are still exact. Interval schedules are **estimated** from the latest database activity and marked as such.
- Run history and "running now" are not available.

Avoid mounting `/var/run/docker.sock` into the dashboard directly. That gives it root-equivalent access to the host.

## Configuration

These are the dashboard container's environment variables. `docker-compose.yml` already sets the important ones from your `.env` (`FGC_CONTAINER`, `DASHBOARD_USER`, `DASHBOARD_PASS`, `DASHBOARD_SHOW_CODES`, `DASHBOARD_PORT`, `FGC_DATA`). All are optional.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `FGC_DATA_DIR` | `/fgc/data` | FGC-R data directory |
| `FGC_ENV_FILE` | `/fgc/.env` | Claimer `.env`, used when Docker is off (falls back to `data/config.env`) |
| `DOCKER_HOST` | — | `tcp://socket-proxy:2375` or `unix:///var/run/docker.sock` |
| `FGC_CONTAINER` | `fgc-remaster` | Name of the claimer container |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | — | Turns on HTTP basic auth when both are set (`/api/health` stays open) |
| `MASK_ACCOUNTS` | `true` | Shows email accounts as `p***@gmail.com` |
| `SHOW_CODES` | `false` | Shows Prime Gaming redemption codes (click to reveal) |
| `CACHE_SECONDS` | `15` | API cache time-to-live |

**Security:** credential values are never sent to the browser. Only whether each one is set ("✓ Credentials") is shown. For access from outside your LAN, put the dashboard behind a reverse proxy with TLS, and turn on basic auth or the proxy's own auth.

## API

Every endpoint is a JSON `GET`:

- `/api/overview`
- `/api/status`
- `/api/schedule`
- `/api/services`
- `/api/stats`
- `/api/games?store=&group=claimed|owned|failed|pending|info&user=&q=&sort=date|title|store|status&dir=asc|desc&page=&pageSize=`
- `/api/screenshots`
- `/api/health`

## Development

Requires Node.js 24 or newer.

```bash
npm run demo     # creates ./demo-data with a sample fgc.db and starts on :8080
npm test         # node --test
```

Code layout:

- `src/server.js`: HTTP server, routes, basic auth, static files
- `src/service.js`: combines config, database and Docker data
- `src/fgcConfig.js` + `src/stores.js`: FGC-R env interpretation and the store catalogue
- `src/schedule.js`: next-run calculation (time-zone and DST aware, no libraries)
- `src/db.js`: read-only SQLite (`node:sqlite`)
- `src/docker.js`: Docker Engine API client and log parsing
- `public/`: the UI, plain HTML/CSS/JS with no build step

When FGC-R adds a store, add it to `src/stores.js`.
Stores that appear in the database but not in the catalogue still show up, labelled "Unknown store".

## License

MIT. This project is not affiliated with Free-Games-Claimer-Remaster or with any of the stores.
