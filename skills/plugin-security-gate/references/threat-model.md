# Plugin Security Gate — Threat Model

## Overview

Just-ship loads third-party skills as agent instructions. A skill file has the same privilege level as the agent executing it — it can read files, execute commands, and interact with external services. This makes skill installation a trust boundary.

## Threat Actors

1. **Malicious Publisher**: Creates a plugin that appears useful but contains hidden malicious behavior
2. **Compromised Publisher**: A legitimate plugin is updated with malicious code (supply chain attack)
3. **Accidental Risk**: A well-intentioned plugin uses patterns that are dangerous in the just-ship context

## Attack Surfaces

### Surface 1: Skill Markdown Files

Skills are loaded directly into the agent's system prompt. Any text in a skill file becomes an instruction the agent follows. This means:
- A prompt injection in a skill file IS a code execution vulnerability
- "Ignore previous instructions" in a skill bypasses ALL safety rules in CLAUDE.md
- Data extraction directives can exfiltrate secrets via agent actions

### Surface 2: Plugin Scripts

Scripts in `scripts/` directories are executed via the Bash tool. They run with the user's full permissions:
- File system access (read/write any file the user can access)
- Network access (can exfiltrate data)
- Process execution (can spawn background processes)
- Shell modification (can add persistence mechanisms)

### Surface 3: Plugin Dependencies

Plugins may declare or install dependencies:
- NPM/pip packages can execute arbitrary code at install time
- Unpinned versions are vulnerable to version confusion attacks
- Typosquatting targets common package names

## Detection Philosophy

**Two-layer detection:**
1. **Pattern scanning** (fast, deterministic): Grep for known dangerous patterns
2. **Contextual analysis** (semantic, LLM-powered): Read surrounding code to distinguish legitimate use from exploitation

A `subprocess.call()` in a build script is different from `subprocess.call(user_input)` in a web handler. Pattern scanning catches both; contextual analysis distinguishes them.

## False Positive Mitigation

Known safe patterns that should NOT trigger alerts:
- Shell scripts that only use `echo`, `mkdir`, `cp`, `cat`, `grep` (basic file operations)
- Network requests in test/example files
- Base64 encoding for non-executable content (images, fonts)
- `chmod 600` or `chmod 400` (restrictive permissions, not SUID)
- Documentation that describes attack patterns (e.g., security review skills)
