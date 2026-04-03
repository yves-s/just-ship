/**
 * Env Scoping — only pass necessary env vars to agent subprocesses
 *
 * Instead of spreading the entire process.env (which leaks all secrets
 * to agent subprocesses), pickEnv selects only the keys needed for
 * Claude Code and pipeline infrastructure to function.
 */

const ALLOWED_ENV_KEYS = [
  // System essentials
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "TERM",
  // Node.js
  "NODE_PATH",
  "npm_config_prefix",
  // Claude Code / LLM provider
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  // GitHub
  "GH_TOKEN",
  // Pipeline infrastructure
  "PIPELINE_TIMEOUT_MS",
  "BUGSINK_DSN",
  "NODE_ENV",
  // Vercel (preview deploys)
  "VERCEL_TOKEN",
  // Server config (needed when run from server.ts)
  "SERVER_CONFIG_PATH",
];

/**
 * Pick only allowed env vars from the given environment.
 * Any extra keys passed via `extraKeys` are also included.
 */
export function pickEnv(env: NodeJS.ProcessEnv, extraKeys?: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const keys = extraKeys ? [...ALLOWED_ENV_KEYS, ...extraKeys] : ALLOWED_ENV_KEYS;
  for (const key of keys) {
    if (env[key] !== undefined) result[key] = env[key] as string;
  }
  return result;
}
