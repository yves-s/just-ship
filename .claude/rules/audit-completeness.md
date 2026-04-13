Every agent dispatched by `/just-ship-audit` must include a Pre-Conclusion Audit section in its output, BEFORE the JSON findings block.

**Mandatory structure (append after analysis, before JSON output):**

```
## Pre-Conclusion Audit

### Files Reviewed
- path/to/file1.ts (lines 1-150)
- path/to/file2.ts (lines 20-80)
- ...

### Checklist Items Checked
- [ ] {checklist item from skill instructions} — checked
- [ ] {checklist item from skill instructions} — checked
- ...

### Areas NOT Verified
- {area} — reason (e.g. "no access to runtime config", "binary file", "minified code")
```

**Rules:**

1. **Files Reviewed** must list every file the agent read during the audit. If zero files were read, the audit is invalid — do not return findings.
2. **Checklist Items Checked** must reference specific checks from the skill instructions (e.g. "SQL injection — checked", "Hardcoded secrets — checked"). Generic items like "security — checked" are insufficient.
3. **Areas NOT Verified** must explicitly name anything the agent could not check and why. An empty list is acceptable only if the agent genuinely verified everything. "None" without explanation is not acceptable for full-codebase audits.
4. An audit that reports zero findings without listing reviewed files is a false negative, not a clean bill of health.

**Why:** Agents tend to claim completeness without actually checking everything. This forces explicit accountability — the consolidation step can verify that findings are backed by actual file reads, and gaps are visible in the report.
