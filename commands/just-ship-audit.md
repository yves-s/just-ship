---
name: just-ship-audit
description: /just-ship-audit — Paralleles Security- und Quality-Audit via discovered Skills
---

# /just-ship-audit — Parallel Audit

Discovert alle `category: audit` Skills im Projekt und dispatcht sie parallel als Agents. Konsolidiert Findings in einem Report.

## Konfiguration

Keine Pipeline-Verbindung noetig. Der Command funktioniert standalone in jedem Projekt mit installierten Audit-Skills.

## CLI Interface

```
/just-ship-audit                                    # Full Audit, alle discovered Skills
/just-ship-audit --diff                             # Nur Branch-Diff gegen main
/just-ship-audit --skills security-review,find-bugs # Nur bestimmte Skills
/just-ship-audit --no-filter                        # Alle Findings ohne FP-Filter
```

`$ARGUMENTS` wird geparsed:
- Enthält `--diff` → Diff-Modus (nur `diff` und `both` Skills)
- Enthält `--skills skill1,skill2` → nur diese Skills ausfuehren
- Enthält `--no-filter` → FP-Filter deaktiviert, alle Findings werden reported
- Leer oder ohne Flags → Full-Modus (nur `full` und `both` Skills)

## Ausfuehrung

### 1. Skills discovern

Glob `.claude/skills/*.md` und lese jede Datei. Parse das YAML-Frontmatter.

**Zwei Wege, einen Skill als Audit-Skill zu erkennen:**

1. **Frontmatter** (Vorrang): Skill hat `category: audit` und optional `audit_scope` im Frontmatter
2. **Fallback-Tabelle**: Fuer bekannte Plugin-Skills die (noch) kein `category: audit` im Frontmatter haben, greift diese Zuordnung:

| Skill-Name (aus Frontmatter `name:`) | audit_scope |
|---|---|
| `security-review` | `full` |
| `find-bugs` | `diff` |
| `code-review` | `both` |
| `gha-security-review` | `full` |
| `differential-review` | `diff` |
| `insecure-defaults` | `full` |
| `plugin-security-gate` | `full` |

Falls ein Skill `category: audit` im Frontmatter hat, wird sein `audit_scope` aus dem Frontmatter genommen (Default: `both`). Falls er in der Fallback-Tabelle steht aber KEIN `category: audit` hat, wird der Scope aus der Tabelle genommen.

Extrahiere fuer jeden Audit-Skill:
- `name` — Skill-Name
- `audit_scope` — `full`, `diff` oder `both`
- Den gesamten Dateiinhalt als Skill-Instruktion

Falls `--skills` angegeben: filtere zusaetzlich nach den angegebenen Namen.

**Falls keine Audit-Skills gefunden:**

```
Keine Audit-Skills gefunden. Installiere Audit-Plugins in project.json:

  "plugins": {
    "dependencies": [
      {"plugin": "sentry-skills@sentry-skills", "skills": ["security-review", "find-bugs"]},
      "insecure-defaults@trailofbits"
    ]
  }

Dann fuehre setup.sh aus um die Skills zu installieren.
```

Stoppe hier — keine Agents dispatchen.

### 2. Scope bestimmen

- **Full-Modus** (Default): Filtere Skills mit `audit_scope: full` oder `audit_scope: both`
- **Diff-Modus** (`--diff`): Filtere Skills mit `audit_scope: diff` oder `audit_scope: both`

Falls Diff-Modus, hole den Diff:
```bash
git diff $(git merge-base HEAD main)...HEAD
```

Falls der Diff leer ist (kein Unterschied zu main), melde:
```
Kein Diff zu main — nichts zu auditen im Diff-Modus.
```
Stoppe hier.

Zeige dem User welche Skills ausgefuehrt werden:
```
Audit startet — {N} Skills discovered:
  - {skill_name} ({audit_scope})
  - ...

Scope: {Full project | Branch diff (X files changed)}
```

### 3. Agents parallel dispatchen

Dispatche **alle** Agents in einem einzigen Response-Block (parallel). Jeder Agent bekommt:

**Agent-Typ:** `general-purpose`

**Agent-Prompt (pro Skill):**

```
Du fuehrst ein Audit dieses Projekts durch mit dem "{skill_name}" Skill.

## Scope
{Im Full-Modus: "Analysiere die gesamte Codebase. Lies relevante Dateien, verstehe die Architektur, und fuehre das Audit gemaess den Skill-Instruktionen durch."
 Im Diff-Modus: "Analysiere NUR den Branch-Diff gegen main. Hier ist der Diff:\n\n{diff_output}"}

## Skill-Instruktionen
{gesamter Skill-Dateiinhalt}

## Output-Format

Gib deine Findings als JSON-Array zurueck. Wrape das JSON in einen ```json Code-Block.
Jedes Finding hat diese Struktur:

[
  {
    "id": "{SKILL-PREFIX}-001",
    "severity": "critical|high|medium|low",
    "title": "Kurze Beschreibung",
    "location": "pfad/zur/datei.ts:42",
    "description": "Was ist falsch und warum",
    "fix": "Wie man es behebt",
    "confidence": "high|medium",
    "source": "{skill_name}"
  }
]

Regeln:
- Prefix fuer IDs: Verwende einen kurzen Prefix basierend auf dem Skill-Namen (z.B. SEC fuer security-review, BUG fuer find-bugs, DEF fuer insecure-defaults, GHA fuer gha-security-review, DIFF fuer differential-review, CR fuer code-review)
- Nur HIGH und MEDIUM Confidence Findings reporten
- Falls keine Findings: gib ein leeres Array zurueck: []
- Kein zusaetzlicher Text ausserhalb des JSON-Blocks
```

### 4. Findings konsolidieren

Nachdem alle Agents fertig sind:

1. **JSON extrahieren:** Fuer jeden Agent-Output, extrahiere das JSON aus dem ```json Code-Block. Falls kein Code-Block vorhanden, versuche den gesamten Output als JSON zu parsen. Falls beides scheitert, logge eine Warnung fuer diesen Skill.

2. **Deduplizieren:** Zwei Ebenen:
   - **Identitaet:** Jedes Finding ist eindeutig via `source + id` (z.B. `security-review/SEC-001` ist verschieden von `find-bugs/SEC-001`)
   - **Cross-Skill-Duplikate:** Falls zwei Findings von verschiedenen Skills die gleiche `location + title` haben, behalte das mit der hoeheren Severity und notiere den Duplikat-Source.

3. **Sortieren:** Critical → High → Medium → Low. Innerhalb einer Severity-Stufe nach Location sortieren.

4. **Zaehlen:** Findings pro Severity-Stufe zaehlen.

### 4a. False-Positive Filter

Nach der Konsolidierung wird jedes Finding gegen eine Exclusion-Tabelle geprueft. Findings die matchen werden als `filtered: true` markiert und erscheinen NICHT im Report, aber werden im Summary als "Filtered" gezaehlt.

**Exclusion Precedents** (basierend auf Anthropic Security Review + Framework-Kontext):

| Regel | Beschreibung | Beispiel |
|---|---|---|
| ENV_TRUSTED | Umgebungsvariablen (`process.env.*`, `os.environ.*`, `env.get()`) sind server-kontrolliert, kein Attacker-Input | `const url = process.env.API_URL` ist kein SSRF |
| UUID_UNGUESSABLE | UUIDs/ULIDs als Identifier sind nicht brute-forceable | `findById(uuid)` ist kein IDOR |
| FRAMEWORK_ESCAPING | React JSX, Angular Templates, Vue Templates escapen per Default — kein XSS ohne `dangerouslySetInnerHTML` / `v-html` / `[innerHTML]` | `<div>{userInput}</div>` in React ist safe |
| ORM_PARAMETERIZED | ORM Queries (Prisma, Drizzle, SQLAlchemy, ActiveRecord) parametrisieren per Default | `prisma.user.findMany({ where: { name } })` ist kein SQLi |
| SHELL_TRUSTED | Shell-Scripts die nicht via HTTP/WebSocket aufgerufen werden, verarbeiten keinen Attacker-Input | `setup.sh` ist kein Command Injection Vector |
| TEST_FIXTURE | Findings in Test-Dateien (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `tests/`) sind keine Production-Vulnerabilities | Hardcoded Token in `auth.test.ts` ist kein Secret Leak |
| EXAMPLE_FILE | Findings in Example/Template-Dateien (`.example`, `.template`, `.sample`, `templates/`) | Default-Passwort in `env.example` ist expected |
| DOCS_ONLY | Findings in Dokumentation (`docs/`, `*.md`, `README*`) sind keine Code-Vulnerabilities | SQL-Beispiel in README ist kein SQLi |
| CONFIG_BUILDTIME | Build-Time Config die zur Deployment-Zeit ersetzt wird (Docker ARG, CI/CD Substitution) | `ARG NODE_ENV=development` in Dockerfile |
| INTERNAL_API | Endpoints die nur von internen Services aufgerufen werden (Webhook-Handler mit Signature-Verification, localhost-only) | Webhook mit HMAC-Verification ist kein Auth-Bypass |
| CLIENT_ONLY | Client-seitiger Code braucht keine Server-Auth-Checks | React-Komponente ohne Auth-Check ist kein Auth-Bypass |
| SKILL_MARKDOWN | Findings in Skill-Definitionen (`.claude/skills/*.md`, `skills/*/SKILL.md`) sind Agent-Instruktionen, kein ausfuehrbarer Code | SQL-Pattern in security-review Skill ist kein SQLi |
| GENERATED_CODE | Auto-generierte Dateien (Lock-Files, Type-Defs, Build-Output) | `package-lock.json`, `*.d.ts`, `dist/` |

**Anwendung:**

Fuer jedes Finding nach der Deduplizierung:
1. Pruefe ob die `location` auf eine der Exclusion-Regeln matcht (Dateipfad-basiert: TEST_FIXTURE, EXAMPLE_FILE, DOCS_ONLY, SKILL_MARKDOWN, GENERATED_CODE)
2. Pruefe ob die `description` auf eine der semantischen Regeln matcht (ENV_TRUSTED, UUID_UNGUESSABLE, FRAMEWORK_ESCAPING, ORM_PARAMETERIZED, SHELL_TRUSTED, CONFIG_BUILDTIME, INTERNAL_API, CLIENT_ONLY)
3. Falls eine Regel matcht: markiere als `"filtered": true, "filter_reason": "{REGEL_NAME}"` und entferne aus der Report-Liste
4. Falls keine Regel matcht: Finding bleibt im Report

**Confidence Gate:**
Zusaetzlich zur Exclusion-Tabelle wird der Confidence-Level geprueft:
- `confidence: "high"` → bleibt im Report
- `confidence: "medium"` → bleibt im Report, aber nur in Severity `critical` oder `high`. Medium-Confidence Findings mit Severity `medium` oder `low` werden gefiltert mit `filter_reason: "LOW_SIGNAL"` (medium confidence + low severity = zu viel Noise)

**Im Report:**
Die Summary-Tabelle bekommt eine neue Zeile:
```
| Filtered (FP) | {count} |
```

Am Ende des Reports, nach allen Severity-Sektionen, eine neue Sektion:
```markdown
## Filtered (False Positives)
{count} findings were filtered by the false-positive heuristic. To see all unfiltered findings, run `/just-ship-audit --no-filter`.
```

### 5. Report schreiben

Erstelle `docs/audit/` Verzeichnis falls es nicht existiert:
```bash
mkdir -p docs/audit
```

Schreibe den Report nach `docs/audit/{YYYY-MM-DD}-audit-report.md`:

```markdown
# Audit Report — {YYYY-MM-DD}

## Summary
| Metric | Value |
|---|---|
| Skills executed | {N} |
| Skills failed | {M} (falls > 0) |
| Scope | Full project / Branch diff |
| Findings | {total} |
| Critical | {count} |
| High | {count} |
| Medium | {count} |
| Low | {count} |

## Skills Executed
- {skill_name_1} (scope: {audit_scope})
- {skill_name_2} (scope: {audit_scope})
{Falls Skills gefailed: }
- ⚠ {skill_name} — FAILED: {grund}

## Critical

### [{id}] {title}
- **Source:** {source}
- **Location:** `{location}`
- **Confidence:** {confidence}
- **Description:** {description}
- **Fix:** {fix}

## High
{gleiche Struktur}

## Medium
{gleiche Struktur}

## Low
{gleiche Struktur}
```

### 6. Terminal Summary

Zeige eine kompakte Zusammenfassung:

```
Audit complete — {N} skills, {total} findings

  {X} Critical  {bar}
  {Y} High      {bar}
  {Z} Medium    {bar}
  {W} Low       {bar}

  Full report: docs/audit/{YYYY-MM-DD}-audit-report.md
```

Die Bars sind proportionale Unicode-Bloecke (█). Laengster Bar = 20 Zeichen, andere proportional.

Falls keine Findings:
```
Audit complete — {N} skills, 0 findings

  Clean bill of health.

  Full report: docs/audit/{YYYY-MM-DD}-audit-report.md
```
