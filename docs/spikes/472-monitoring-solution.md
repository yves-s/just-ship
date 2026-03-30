# Spike T-472: Native Error Logging & Monitoring for VPS Deployments

**Date:** 2026-03-30
**Status:** Complete
**Ticket:** T-472

---

## Problem

Just Ship lacks error logging and monitoring on VPS deployments. Operators have no visibility into application errors, performance issues, or system health. Debugging pipeline failures requires SSH + manual log inspection.

## Constraints

- VPS has 2-4 GB RAM (Hostinger), shared between the pipeline server and monitoring
- Docker-based deployment (Caddy + pipeline-server containers)
- Node.js HTTP server (`pipeline/server.ts`) + Claude Code child processes
- Must be self-hostable — no mandatory cloud dependency
- Should integrate with minimal code changes

---

## Solutions Evaluated

### Disqualified (resource requirements too high)

| Tool | Min RAM | Containers | Why Disqualified |
|---|---|---|---|
| **Sentry self-hosted** | 16-32 GB | 40+ (Kafka, ClickHouse, Snuba, etc.) | Requires 4-8x our total VPS RAM |
| **Highlight.io self-hosted** | 8-32 GB | Multiple (ClickHouse, OpenSearch, etc.) | Same class of resource usage as Sentry |
| **Uptrace** | 4 GB | 6 (ClickHouse, PostgreSQL, Redis, OTel Collector) | Consumes entire VPS budget, no headroom for the app |

### Viable Options

#### 1. GlitchTip (Error Tracking + Uptime)

| Dimension | Details |
|---|---|
| **RAM** | ~512 MB (all-in-one mode: web + worker + PostgreSQL + Redis) |
| **Containers** | 4 |
| **Node.js Integration** | Standard `@sentry/node` SDK — Sentry API-compatible. Change only the DSN |
| **Features** | Error tracking with stack traces, performance/transaction monitoring, OTLP log ingestion, uptime monitoring, MCP server for AI debugging (v6), full-text search |
| **Maintenance** | Low. Django app + PostgreSQL. Linear memory growth with event volume |
| **License** | MIT |
| **Maturity** | v6 released early 2026. Active community. Sentry SDK compatibility is a major advantage |

**Pros:**
- Richest feature set of all lightweight options
- Uses the standard `@sentry/node` SDK — same API as Sentry Cloud, zero learning curve
- Uptime monitoring built in (can monitor the pipeline server endpoint)
- OTLP log ingestion enables forwarding structured logs
- MCP server in v6 enables AI-assisted debugging

**Cons:**
- 4 containers adds complexity to `docker-compose.yml`
- PostgreSQL requires disk space for data retention
- 512 MB is significant on a 2 GB VPS (but fine on 4 GB)

#### 2. Bugsink (Pure Error Tracking)

| Dimension | Details |
|---|---|
| **RAM** | <256 MB |
| **Containers** | **1** (single binary, SQLite storage) |
| **Node.js Integration** | Sentry SDK-compatible — point `@sentry/node` at Bugsink DSN |
| **Features** | Error tracking, stack traces, error grouping, alerts |
| **Maintenance** | Minimal. Single container, no external database |
| **License** | Open source |
| **Maturity** | Newer project (active since 2024), growing community |

**Pros:**
- Absolute minimum footprint — 1 container, <256 MB RAM
- SQLite storage — no PostgreSQL to manage
- Setup under 10 minutes
- Same `@sentry/node` SDK as GlitchTip/Sentry
- Benchmarks: 30 events/sec on minimal hardware

**Cons:**
- Error tracking only — no performance monitoring, no uptime monitoring, no metrics
- No log aggregation
- Less mature than GlitchTip
- SQLite may not scale for very high event volumes

#### 3. Dozzle (Live Docker Log Viewer)

| Dimension | Details |
|---|---|
| **RAM** | <30 MB |
| **Containers** | **1** (mounts Docker socket) |
| **Node.js Integration** | None required — reads Docker stdout/stderr automatically |
| **Features** | Real-time log streaming, JSON colorization, per-container CPU/memory metrics (live), SQL queries on logs (browser-side DuckDB), alerting via Slack/Discord |
| **Maintenance** | Negligible |
| **License** | Apache 2.0 |
| **Maturity** | Actively maintained, popular in homelab/VPS communities |

**Pros:**
- Near-zero overhead
- Zero code changes required
- Instantly useful for operational debugging
- SQL queries on live logs via browser-side DuckDB

**Cons:**
- **No log persistence** — live viewer only, no historical search
- No error grouping or stack trace analysis
- No metrics storage
- Not a monitoring solution on its own — complementary tool

#### 4. Grafana + Loki + Promtail (Log Aggregation)

| Dimension | Details |
|---|---|
| **RAM** | ~900 MB total (Loki: 256-512 MB, Promtail: 50 MB, Grafana: 200-300 MB) |
| **Containers** | 3 |
| **Node.js Integration** | Promtail scrapes Docker logs automatically — zero code changes. Optionally push from Pino via `pino-loki` |
| **Features** | Log aggregation, search/filtering, dashboards, alerting |
| **Maintenance** | Low-medium. Well-documented, large community |
| **License** | AGPLv3 (Grafana/Loki) |
| **Maturity** | Industry standard. Massive community |

**Pros:**
- Industry-standard log aggregation
- Promtail auto-collects Docker logs — zero app changes
- Powerful query language (LogQL)
- Grafana dashboards are excellent
- Can add Prometheus for system metrics later

**Cons:**
- 900 MB is significant RAM overhead
- No error tracking (no grouping, no stack trace analysis)
- Three containers to manage
- Loki configuration can be complex

#### 5. Grafana + Prometheus + node_exporter (System Metrics)

| Dimension | Details |
|---|---|
| **RAM** | ~800 MB total (Prometheus: 200-500 MB, node_exporter: <10 MB, Grafana: 200-300 MB) |
| **Containers** | 3 |
| **Node.js Integration** | `prom-client` npm package to expose `/metrics` endpoint. Prometheus scrapes it |
| **Features** | System metrics (CPU, memory, disk, network), custom app metrics, dashboards, alerting |
| **License** | Apache 2.0 (Prometheus, node_exporter), AGPLv3 (Grafana) |

**Pros:**
- Industry-standard metrics collection
- Thousands of pre-built Grafana dashboards
- Custom metrics (pipeline duration, error rate, queue depth)

**Cons:**
- No error tracking, no log aggregation
- Complementary tool, not standalone

---

## Recommended Approach

### Option A: Minimal (Recommended for 2 GB VPS)

**Bugsink + Dozzle** — Total: ~286 MB, 2 containers

```
docker-compose.yml additions:
  bugsink:     # Error tracking    ~256 MB
  dozzle:      # Live log viewer   ~30 MB
```

- Error tracking via `@sentry/node` SDK pointed at Bugsink
- Live log visibility via Dozzle (zero config)
- Total overhead: <300 MB — leaves 1.7 GB for app on a 2 GB VPS

**Integration in pipeline/server.ts:**
```typescript
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.BUGSINK_DSN });
```

### Option B: Full Stack (Recommended for 4 GB VPS)

**GlitchTip + Dozzle + Prometheus + node_exporter** — Total: ~1.1 GB, 7 containers

```
docker-compose.yml additions:
  glitchtip-web:      # Error tracking UI     ~256 MB
  glitchtip-worker:   # Background processing ~128 MB
  glitchtip-postgres: # Data storage          ~128 MB
  dozzle:             # Live log viewer        ~30 MB
  prometheus:          # Metrics collection   ~300 MB
  node-exporter:       # System metrics        ~10 MB
  # Grafana shared with GlitchTip or run separately ~250 MB
```

- Error tracking + uptime monitoring via GlitchTip
- Live log visibility via Dozzle
- System metrics via Prometheus + node_exporter
- Custom app metrics via `prom-client`
- Total overhead: ~1.1 GB — leaves ~2.9 GB for app on a 4 GB VPS

### Option C: Cloud Hybrid (Budget-Constrained)

**Axiom (cloud, free tier) + Dozzle** — Total: ~30 MB, 1 container

- Axiom free tier: 500 GB/month ingest, 30-day retention
- Zero VPS resource overhead for log storage
- Dozzle for live operational visibility
- Tradeoff: data leaves the server, vendor dependency

---

## Security Considerations

### Authentication & Access Control
- **Monitoring UIs (Dozzle, Bugsink) must be protected** — both tools expose sensitive information (stack traces, application logs, error patterns)
- **Never expose without authentication** — all monitoring endpoints should be behind Caddy with:
  - Dozzle: Caddy `basicauth` middleware with strong credentials (environment variables or secrets manager)
  - Bugsink: Built-in admin account + password (set during first-run container initialization)
- **Separate credentials** — monitoring credentials should be distinct from application API keys

### Data Sensitivity
- Error stack traces may contain sensitive paths, database queries, or internal URLs
- Application logs captured by Dozzle/Grafana may contain business logic or configuration details
- All data remains on the VPS in self-hosted mode (no external cloud dependency)
- PostgreSQL in GlitchTip should use strong credentials and not be exposed outside Docker network

### Network Architecture
- All monitoring containers run in Docker — they communicate via internal Docker network
- No monitoring service should be directly exposed; always route through Caddy reverse proxy
- Caddy handles HTTPS termination and auth middleware
- Prometheus scrape endpoints should be restricted to internal Docker network (not exposed to internet)

---

## Recommendation

**Start with Option A (Bugsink + Dozzle)** for these reasons:

1. **Lowest integration cost:** 2 containers, <300 MB RAM, setup in minutes
2. **Sentry SDK compatibility:** If we outgrow Bugsink, switch to GlitchTip or Sentry Cloud by changing only the DSN
3. **Zero app changes for Dozzle:** Instant value for operational debugging
4. **Clear upgrade path:** Option A → Option B by adding GlitchTip (replaces Bugsink) and Prometheus

### Implementation Steps (separate ticket)

1. Add `bugsink` and `dozzle` services to `vps/docker-compose.yml`
2. Add `@sentry/node` SDK to `pipeline/package.json`
3. Initialize Sentry in `pipeline/server.ts` and `pipeline/worker.ts`
4. Add `BUGSINK_DSN` to VPS environment configuration
5. **Expose Dozzle on a Caddy route (e.g., `/logs/`) with reverse proxy auth** (use Caddy `basicauth` middleware with credentials in environment or vault)
6. **Expose Bugsink on a Caddy route (e.g., `/errors/`) with authentication** (Bugsink includes built-in user management; configure admin account during setup)
7. Update `vps/README.md` with monitoring documentation
8. Update `/just-ship-vps` command to include monitoring setup
9. **SECURITY:** Document how to configure authentication in `vps/README.md`:
   - Dozzle: Caddy `basicauth` configuration with strong credentials
   - Bugsink: Built-in admin account setup + recommend changing default credentials
   - Both: Monitoring UIs must NOT be exposed to the internet without authentication

### Resource Budget Summary

| Component | RAM | Containers |
|---|---|---|
| Pipeline server (existing) | ~500 MB | 2 (Caddy + pipeline-server) |
| Bugsink | ~256 MB | 1 |
| Dozzle | ~30 MB | 1 |
| **Total** | **~786 MB** | **4** |
| **Headroom on 4 GB VPS** | **~3.2 GB** | — |
| **Headroom on 2 GB VPS** | **~1.2 GB** | — |

---

## Sources

- [GlitchTip Installation](https://glitchtip.com/documentation/install/)
- [GlitchTip vs Sentry (March 2026)](https://earezki.com/ai-news/2026-03-14-glitchtip-vs-sentry/)
- [Bugsink — Alternative to Self-Hosted Sentry](https://www.bugsink.com/tired-of-self-hosting-sentry-try-bugsink/)
- [Bugsink GitHub](https://github.com/bugsink/bugsink)
- [Sentry Self-Hosted System Requirements](https://deepwiki.com/getsentry/self-hosted/3.1-system-requirements)
- [Highlight.io Self-Hosted Guide](https://www.highlight.io/docs/getting-started/self-host/self-hosted-hobby-guide)
- [Uptrace Docker Deployment](https://uptrace.dev/get/hosted/docker)
- [Dozzle — What is Dozzle?](https://dozzle.dev/guide/what-is-dozzle)
- [Dozzle GitHub](https://github.com/amir20/dozzle)
- [Grafana Loki Deployment Modes](https://grafana.com/docs/loki/latest/get-started/deployment-modes/)
- [Pino Logger Guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/)
- [Axiom Pricing & Limits](https://axiom.co/docs/reference/limits)
