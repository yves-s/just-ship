# Spike T-551: Hosting-Infrastruktur für Kundenprojekte

> **Status:** Abgeschlossen
> **Datum:** 2026-04-05
> **Autor:** Claude (Spike Agent)

---

## 1. Kontext

Als Agentur realisieren wir Projekte für Kunden End-to-End. Wir brauchen eine klare Hosting-Strategie, bei der wir die **komplette Infrastruktur ownen** — Hosting, Security, Maintenance, Updates — und dem Kunden ein Rundum-Sorglos-Paket bieten.

**Bestehendes Setup:** Wir betreiben bereits einen Hostinger VPS für die Just Ship Pipeline (Docker + Caddy, siehe `vps/`). Dieses Spike evaluiert das Hosting für **Kundenprojekte** (Websites, Web-Apps, APIs), nicht die Pipeline selbst.

---

## 2. Provider-Vergleich

### 2.1 Hetzner Cloud (Empfehlung)

| Aspekt | Details |
|--------|---------|
| **Standort** | Falkenstein, Nürnberg (DE), Helsinki (FI) — DSGVO-konform |
| **Einstieg** | CX22: 2 vCPU, 4 GB RAM, 40 GB SSD — **€4.35/mo** (nach April 2026 Preisanpassung) |
| **Sweet Spot** | CAX21 (ARM): 4 vCPU, 8 GB RAM, 80 GB — **€7.49/mo** |
| **Multi-Tenant** | CPX31: 4 vCPU, 8 GB RAM, 160 GB — **€14.49/mo** |
| **Traffic** | 20 TB/mo inklusive (5x DigitalOcean, 4x Vultr) |
| **Extras** | IPv4+IPv6, DDoS-Protection, Firewall, Snapshots inklusive |
| **API** | Vollständige REST API für Automatisierung |
| **Uptime** | 99.9% SLA |
| **Zahlung** | Stündliche Abrechnung möglich |

**Pro:** Bestes Preis-Leistungs-Verhältnis in EU, inklusive Traffic, DSGVO, starke API, ARM-Server (CAX) extrem günstig.
**Contra:** Preiserhöhung April 2026 (+30-35%), kein managed Kubernetes, Support nur auf Englisch/Deutsch.

### 2.2 Hostinger

| Aspekt | Details |
|--------|---------|
| **Standort** | Litauen (EU), USA, UK, Brasilien, Indien |
| **Einstieg** | KVM 1: 1 vCPU, 4 GB RAM, 50 GB NVMe — **$4.99/mo** |
| **Mid-Tier** | KVM 2: 2 vCPU, 8 GB RAM, 100 GB NVMe — **$6.99/mo** |
| **Traffic** | 4-8 TB/mo je nach Plan |
| **Extras** | NVMe SSDs, wöchentliche Backups, Snapshots |
| **Uptime** | 99.9% Garantie |

**Pro:** Günstiger Einstieg, NVMe-Storage, gutes Panel, bekannt durch bestehenden Pipeline-VPS.
**Contra:** Weniger Traffic inklusive, EU-Standort nur Litauen, keine ARM-Server, API-Automatisierung limitiert.

### 2.3 Contabo

| Aspekt | Details |
|--------|---------|
| **Standort** | Nürnberg (DE), München (DE), USA, Australien, Japan |
| **Einstieg** | VPS S: 4 vCPU, 8 GB RAM, 200 GB SSD — **€5.99/mo** |
| **Mid-Tier** | VPS M: 6 vCPU, 16 GB RAM, 400 GB SSD — **€10.49/mo** |
| **Traffic** | 32 TB/mo inklusive |
| **Extras** | Snapshots, DDoS-Protection Basic |

**Pro:** Extrem viel RAM/Storage/Traffic pro Euro, deutsche Rechenzentren.
**Contra:** Netzwerk-Performance schwächer als Hetzner, Support langsam, ältere Hardware, Community-Reputation gemischt.

### Provider-Matrix

| Kriterium | Hetzner | Hostinger | Contabo |
|-----------|---------|-----------|---------|
| Preis (8 GB RAM) | €7.49/mo | $6.99/mo | €5.99/mo |
| EU-Standort (DE) | Falkenstein, Nürnberg | Litauen | Nürnberg, München |
| Traffic inklusive | 20 TB | 8 TB | 32 TB |
| API-Automatisierung | Excellent | Basic | Basic |
| ARM-Server | Ja (CAX) | Nein | Nein |
| Network Performance | Excellent | Good | Acceptable |
| DSGVO | Ja (DE) | Ja (LT) | Ja (DE) |

**Empfehlung: Hetzner Cloud** — Bestes Gesamtpaket aus Preis, Performance, Standort (DE), API und inklusivem Traffic.

---

## 3. Server-Setup: Multi-Tenant vs. Isoliert

### Empfehlung: Multi-Tenant mit Container-Isolation

Ein einzelner, leistungsfähiger Server mit Docker-Containern pro Kunde-Projekt. Nicht ein VPS pro Kunde.

**Warum Multi-Tenant:**

| Aspekt | Multi-Tenant (1 Server) | Isoliert (1 VPS/Kunde) |
|--------|------------------------|----------------------|
| **Kosten** | €14-30/mo für 5-10 Projekte | €7-15/mo × N Kunden |
| **Management** | 1 Server, 1 Coolify-Instanz | N Server, N Logins |
| **Resource-Nutzung** | Shared idle resources | Jeder VPS idle |
| **Security** | Docker-Isolation | VM-Isolation |
| **Skalierung** | Vertical → Worker Nodes | Pro-Kunde trivial |
| **SSL** | 1 Wildcard oder auto per Domain | N × Lets Encrypt |
| **Monitoring** | 1 Dashboard | N Dashboards |
| **Break-Even** | Ab Projekt 2 günstiger | Nie günstiger |

**Starter-Setup (5-10 Kundenprojekte):**
- 1× Hetzner CPX41: 8 vCPU, 16 GB RAM, 240 GB SSD — **€27.49/mo**
- Coolify als Deployment-Platform
- Jedes Projekt als eigener Docker-Container mit eigenem Netzwerk
- Eigene PostgreSQL-Instanz pro Projekt (Container, nicht shared DB)

**Wachstum (10-20+ Projekte):**
- Coolify Worker Nodes: Zweiter Server als Worker hinzufügen
- Coolify managed die Verteilung automatisch via SSH + Docker API
- Kein Kubernetes nötig — Docker Swarm oder einfach Coolify Multi-Server

### Wann ein separater VPS sinnvoll ist

- Kunde hat regulatorische Anforderungen (Gesundheitswesen, Finanzen)
- Kunde braucht eigene IP-Adresse (E-Mail-Reputation, Compliance)
- Projekt hat extrem hohen Resource-Bedarf (>4 GB RAM, >2 vCPU dauerhaft)
- Kunde möchte nach Projektende die Infrastruktur übernehmen

→ Diese Fälle sind Ausnahmen (<10% der Kundenprojekte). Standard ist Multi-Tenant.

---

## 4. Deployment-Tooling

### Empfehlung: Coolify

| Tool | UI | Docker Compose | Multi-Server | DB Management | Maintenance |
|------|----|---------------|--------------|---------------|-------------|
| **Coolify** | Modern, polished | Full support | Ja (Worker Nodes) | Built-in (PG, MySQL, Redis, MongoDB) | Aktiv entwickelt |
| **CapRover** | Functional, dated | Limited | Ja (Cluster) | Via One-Click Apps | Langsam, stagniert |
| **Dokku** | CLI only | Plugin | Nein (Single Server) | Via Plugins | Stabil, wenig Updates |
| **Custom (Docker + Caddy)** | Keine | Full | Manuell | Manuell | Selbst pflegen |

### Warum Coolify

1. **Self-Hosted Vercel-Alternative** — Git-Push-Deployments, Preview-Branches, Rollbacks
2. **Docker Compose native** — Ganze Stacks deployen (App + DB + Redis + Worker)
3. **Multi-Server** — Worker Nodes via SSH, kein Agent nötig auf dem Worker
4. **Automatic SSL** — Let's Encrypt pro Domain, automatische Renewal
5. **Database Backups** — S3-kompatible Backups (Hetzner Object Storage, Backblaze B2)
6. **Open Source** — Kein Vendor Lock-in, selbst gehostet, keine monatlichen Kosten
7. **One-Click Apps** — WordPress, Ghost, Plausible, Umami, etc. vorkonfiguriert
8. **Setup** — 15-30 Minuten Erstinstallation, danach Git-Push für Deployments

### Integration mit Just Ship Pipeline

Coolify und die Pipeline laufen auf **separaten Servern**:

```
Hetzner Server 1 (Pipeline)          Hetzner Server 2 (Kundenhosting)
┌─────────────────────────┐          ┌─────────────────────────────┐
│ Docker                  │          │ Coolify                     │
│ ├─ Caddy (HTTPS)        │          │ ├─ Traefik (Reverse Proxy)  │
│ ├─ Pipeline Server      │          │ ├─ Kunde-A (Next.js)        │
│ ├─ Bugsink              │          │ ├─ Kunde-A-DB (PostgreSQL)  │
│ └─ Dozzle               │          │ ├─ Kunde-B (WordPress)      │
│                         │          │ ├─ Kunde-B-DB (MySQL)       │
│ Projekte: Git Repos     │          │ ├─ Kunde-C (Remix + Redis)  │
│ (Development)           │          │ └─ Monitoring (Plausible)   │
└─────────────────────────┘          └─────────────────────────────┘
```

Pipeline-Server deployed nicht direkt auf den Hosting-Server — der PR-Merge triggert ein Git-Push-Deployment via Coolify Webhook oder GitHub Integration.

---

## 5. Security-Baseline

### Pflicht (Day 1)

| Kategorie | Massnahme | Tool/Methode |
|-----------|-----------|--------------|
| **SSH** | Key-only Auth, Root-Login disabled, Port ändern (optional) | `sshd_config` |
| **Firewall** | Nur 80, 443, SSH offen | `ufw` oder Hetzner Cloud Firewall |
| **SSL/TLS** | Automatisch via Coolify/Traefik + Let's Encrypt | Coolify built-in |
| **Updates** | Unattended Upgrades für Security-Patches | `unattended-upgrades` |
| **Backups** | Tägliche DB-Backups auf S3, wöchentliche Server-Snapshots | Coolify + Hetzner Snapshots |
| **Docker** | Non-root User in Containern, read-only filesystems wo möglich | Dockerfile `USER` directive |
| **Secrets** | Environment Variables via Coolify, nie im Code | Coolify Environment Management |

### Empfohlen (Day 30)

| Kategorie | Massnahme | Tool/Methode |
|-----------|-----------|--------------|
| **Monitoring** | Uptime-Checks, Resource-Alerts | Uptime Kuma (self-hosted) oder Better Stack |
| **Log Management** | Centralized Logging | Dozzle (bereits im Stack) oder Loki |
| **Fail2Ban** | SSH Brute-Force Protection | `fail2ban` |
| **WAF** | Basic Web Application Firewall | Cloudflare Free (DNS-Level) |
| **Vulnerability Scanning** | Container Image Scanning | Trivy (CLI, in CI) |

### Backup-Strategie

```
Tägliche DB-Backups → S3 (Hetzner Object Storage: €0.0065/GB/mo)
  ├─ Retention: 30 Tage
  ├─ Coolify automatisiert pg_dump/mysqldump
  └─ Restore: 1-Click via Coolify UI

Wöchentliche Server-Snapshots → Hetzner Snapshots (€0.0119/GB/mo)
  ├─ Retention: 4 Snapshots
  └─ Restore: Neuer Server aus Snapshot in <5 Min

Code → Git (GitHub)
  └─ Immer recoverable via git clone + Coolify redeploy
```

---

## 6. Kosten-Kalkulation

### Setup-Kosten (einmalig)

| Position | Aufwand | Kosten (intern) |
|----------|---------|-----------------|
| Hetzner-Server aufsetzen | 1h | — |
| Coolify installieren + konfigurieren | 1h | — |
| Security-Baseline implementieren | 2h | — |
| Monitoring aufsetzen | 1h | — |
| Dokumentation | 1h | — |
| **Gesamt** | **~6h** | **Interne Arbeitszeit** |

### Laufende Kosten (monatlich)

#### Variante A: Starter (3-5 Kundenprojekte)

| Position | Kosten/mo |
|----------|-----------|
| Hetzner CPX31 (4 vCPU, 8 GB, 160 GB) | €14.49 |
| Hetzner Object Storage (Backups, ~50 GB) | €0.33 |
| Domain (Cloudflare DNS, kostenlos) | €0.00 |
| **Gesamt** | **~€15/mo** |
| **Pro Kunde (bei 4 Kunden)** | **~€3.75/mo** |

#### Variante B: Wachstum (5-10 Kundenprojekte)

| Position | Kosten/mo |
|----------|-----------|
| Hetzner CPX41 (8 vCPU, 16 GB, 240 GB) | €27.49 |
| Hetzner Object Storage (Backups, ~100 GB) | €0.65 |
| Uptime Monitoring (Better Stack Free oder Uptime Kuma) | €0.00 |
| **Gesamt** | **~€28/mo** |
| **Pro Kunde (bei 8 Kunden)** | **~€3.50/mo** |

#### Variante C: Scale (10-20+ Kundenprojekte)

| Position | Kosten/mo |
|----------|-----------|
| Hetzner CPX41 (Main) | €27.49 |
| Hetzner CAX21 (Worker Node, ARM) | €7.49 |
| Hetzner Object Storage (Backups, ~200 GB) | €1.30 |
| **Gesamt** | **~€36/mo** |
| **Pro Kunde (bei 15 Kunden)** | **~€2.40/mo** |

### Kunden-Pricing-Empfehlung

| Paket | Enthält | Empfohlener Preis |
|-------|---------|-------------------|
| **Basic** | Hosting, SSL, tägliche Backups, monatliche Updates | **€29-49/mo** |
| **Standard** | + Monitoring, wöchentliche Updates, Priority Support | **€49-99/mo** |
| **Premium** | + Dedizierte Resources, SLA, On-Call | **€99-199/mo** |

**Marge bei 8 Kunden (Standard-Mix):**
- Kosten: ~€28/mo
- Umsatz: 8 × €49 = €392/mo
- **Marge: ~93%** (€364/mo)

---

## 7. Comparison Matrix: Eigener Server vs. Managed

### Kosten-Vergleich (8 Kundenprojekte)

| Aspekt | Eigener Server (Hetzner + Coolify) | Vercel Pro | Railway Pro | Render Pro |
|--------|-----------------------------------|------------|-------------|------------|
| **Basis-Kosten** | €28/mo (1 Server) | $160/mo (8 × $20) | $160/mo (8 × $20) | $152/mo (8 × $19) |
| **Bandwidth (je 1 TB)** | Inklusive (20 TB) | +$120 (8 × $15) | Nutzungsbasiert | +$80 |
| **Datenbank** | Inklusive (Container) | Extern (Supabase/Neon) | +$5-20/Projekt | +$7-25/Projekt |
| **SSL** | Inklusive (Let's Encrypt) | Inklusive | Inklusive | Inklusive |
| **Backups** | ~€1/mo (S3) | Nicht enthalten | Basic | Basic |
| **Geschätzt Total** | **~€30/mo** | **~$300-500/mo** | **~$200-350/mo** | **~$200-400/mo** |
| **Pro Kunde** | **~€3.75** | **~$40-60** | **~$25-45** | **~$25-50** |

### Kostenvorteil ab wann?

```
Break-Even: Ab Projekt 1 (!)

1 Projekt:  Eigener Server €15/mo  vs.  Vercel $20+/mo
3 Projekte: Eigener Server €15/mo  vs.  Vercel $60+/mo   → 75% günstiger
8 Projekte: Eigener Server €28/mo  vs.  Vercel $300+/mo  → 90% günstiger
```

### Qualitative Vergleiche

| Aspekt | Eigener Server | Managed (Vercel/Railway/Render) |
|--------|---------------|-------------------------------|
| **DX (Developer Experience)** | Gut (Coolify ≈ 80% von Vercel DX) | Exzellent |
| **Control** | Voll (Root-Access, Custom Config) | Limitiert (Platform-Constraints) |
| **Vendor Lock-in** | Keiner | Mittel bis Hoch |
| **DSGVO** | Volle Kontrolle (DE-Server) | Abhängig vom Provider (meist US) |
| **Skalierung** | Manuell (Worker Node hinzufügen) | Automatisch |
| **Edge/CDN** | Via Cloudflare (gratis) | Built-in |
| **Downtime-Risiko** | Selbst verantwortlich | Provider-managed |
| **Support** | Self-managed | Provider-Support |
| **Ops-Aufwand** | ~2-4h/mo (Updates, Monitoring) | ~0h/mo |

### Wann Managed sinnvoll bleibt

- **Vercel:** Für Projekte, die Edge Functions, ISR, oder Vercel-spezifische Features brauchen
- **Railway:** Für schnelle Prototypen oder wenn der Kunde Railway bereits nutzt
- **Render:** Für Projekte mit Cron Jobs oder Background Workers als Hauptfeature
- **Shopify:** Themes werden immer auf Shopify gehostet (kein Self-Hosting möglich)

→ Managed als **Ausnahme**, nicht als Standard. Self-Hosted ist der Default für Kundenprojekte.

---

## 8. Domain/DNS

### Empfehlung: Cloudflare (Free Plan)

| Feature | Cloudflare Free |
|---------|----------------|
| **DNS** | Unlimitierte Domains, schnelle Propagation |
| **CDN** | Globales CDN inklusive |
| **SSL** | Universal SSL (zusätzlich zu Let's Encrypt auf Server) |
| **DDoS** | Layer 3/4/7 DDoS Protection |
| **WAF** | Basic WAF Rules inklusive |
| **Analytics** | Basic Web Analytics |
| **Kosten** | **€0/mo** |

### DNS-Management

Wir verwalten DNS zentral über unseren Cloudflare-Account:
1. Kunde registriert Domain bei beliebigem Registrar
2. Kunde ändert Nameservers auf Cloudflare (wir geben die NS-Records)
3. Wir konfigurieren A/AAAA-Records auf unseren Hosting-Server
4. Coolify + Traefik erkennt die Domain automatisch und provisioniert SSL

Alternativ: Kunde behält DNS-Kontrolle und setzt A-Record auf unsere Server-IP. Funktioniert auch, aber wir verlieren CDN/DDoS-Protection.

---

## 9. Architektur-Skizze

```
                    Cloudflare (DNS + CDN + DDoS)
                              │
                              │ A-Record → Server IP
                              ▼
                    ┌─────────────────────────┐
                    │    Hetzner Cloud VPS     │
                    │    (CPX41 / 8 vCPU)     │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │     Coolify       │  │
                    │  │  (Management UI)  │  │
                    │  │  coolify.agency.  │  │
                    │  │  de:8000          │  │
                    │  └───────────────────┘  │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │     Traefik       │  │
                    │  │  (Reverse Proxy)  │  │
                    │  │  :80 / :443       │  │
                    │  └─────────┬─────────┘  │
                    │            │             │
                    │     ┌──────┼──────┐      │
                    │     ▼      ▼      ▼     │
                    │  ┌─────┐┌─────┐┌─────┐  │
                    │  │App A││App B││App C│  │
                    │  │Next ││WP   ││Remix│  │
                    │  │.js  ││     ││     │  │
                    │  └──┬──┘└──┬──┘└──┬──┘  │
                    │     │      │      │     │
                    │  ┌──┴──┐┌──┴──┐┌──┴──┐  │
                    │  │PG A ││MY B ││PG C │  │
                    │  │     ││     ││+Red.│  │
                    │  └─────┘└─────┘└─────┘  │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │  Backups → S3     │  │
                    │  │  (Hetzner Object  │  │
                    │  │   Storage)        │  │
                    │  └───────────────────┘  │
                    └─────────────────────────┘

                    ┌─────────────────────────┐
                    │  Coolify Worker Node     │
                    │  (Hetzner CAX21, ARM)    │
                    │  Overflow-Projekte       │
                    │  (via SSH, kein Coolify) │
                    └─────────────────────────┘
```

### Deployment-Flow

```
Developer pushes to GitHub
         │
         ▼
GitHub Webhook → Coolify
         │
         ▼
Coolify: docker build → deploy
         │
         ▼
Traefik: Route domain → Container
         │
         ▼
Let's Encrypt: Auto-SSL
         │
         ▼
Live auf kunde.de ✓
```

---

## 10. Empfehlung (Zusammenfassung)

### Entscheid

| Frage | Entscheid | Begründung |
|-------|-----------|------------|
| **Provider** | Hetzner Cloud | Bestes Preis-Leistungs-Verhältnis, DE-Standort, 20 TB Traffic, starke API |
| **Setup** | Multi-Tenant (1 Server, Container pro Kunde) | 90%+ Kostenersparnis vs. isolierte VPS, einfacheres Management |
| **Deployment** | Coolify | Feature-reichste Self-Hosted PaaS, Docker Compose native, Multi-Server, aktiv entwickelt |
| **Security** | SSH-Hardening + UFW + Let's Encrypt + Backups → S3 | Solide Baseline, erweiterbar |
| **DNS** | Cloudflare Free | Gratis CDN + DDoS + DNS Management |
| **Datenbanken** | PostgreSQL/MySQL Container pro Projekt (nicht shared) | Isolation + einfache Backups, kein Crosstalk |
| **Skalierung** | Vertikal → Coolify Worker Nodes | Kein Kubernetes nötig bis 20+ Projekte |
| **Managed** | Nur bei Feature-Bedarf (Vercel Edge, Shopify Themes) | Self-Hosted als Default, Managed als Ausnahme |

### Nächste Schritte (Follow-Up-Tickets)

1. **Server provisionieren** — Hetzner CPX41 bestellen, Coolify installieren, Security-Baseline
2. **Erstes Kundenprojekt migrieren** — Pilot mit kleinstem/unkritischstem Projekt
3. **Monitoring aufsetzen** — Uptime Kuma + Alerting (Telegram/E-Mail)
4. **Backup verifizieren** — S3-Backup testen, Restore-Prozess dokumentieren
5. **Kunden-Onboarding-Prozess** — DNS-Anleitung, Domain-Übergabe, SLA-Template
6. **Pricing-Packages definieren** — Basic/Standard/Premium mit klaren Leistungsbeschreibungen

### Risiken

| Risiko | Mitigation |
|--------|-----------|
| Server-Ausfall | Hetzner Snapshots (wöchentlich), schneller Restore auf neuen Server |
| Coolify-Bug | Coolify ist aktiv maintained, Community-Support, Fallback: manuelles Docker |
| Überlastung | Monitoring + Alerting, Worker Node bei Bedarf |
| Kundenprojekt crasht andere | Docker-Isolation, Resource Limits pro Container |
| Hetzner-Preiserhöhung | Kosten immer noch 90% unter Managed, einfache Migration zu anderem Provider |
