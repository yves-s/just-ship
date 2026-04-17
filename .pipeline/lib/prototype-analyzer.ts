import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

export interface LaunchPlan {
  stack: {
    framework: string | null;
    database: string | null;
    styling: string | null;
    language: "typescript" | "javascript";
    packageManager: "npm" | "yarn" | "pnpm" | "bun";
  };
  gaps: {
    needsBuildFix: boolean;
    needsErrorHandling: boolean;
    needsTests: boolean;
    needsSecurity: boolean;
    needsLockfile: boolean;
  };
  envKeys: string[];
  steps: LaunchStep[];
}

export interface LaunchStep {
  id: string;
  label: string;
  status: "pending";
  parallel?: boolean;
}

/**
 * Recursively find files matching a test pattern in a directory.
 * Skips node_modules, .git, and dist directories.
 */
function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  const testPattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
  const ignoreDirs = new Set(["node_modules", ".git", "dist", ".next", "build", "coverage"]);

  function walk(currentDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoreDirs.has(entry)) continue;
      const fullPath = join(currentDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (testPattern.test(entry)) {
          results.push(fullPath);
        }
      } catch {
        // Permission errors or broken symlinks — skip
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Recursively find files matching a pattern (used for error boundary detection).
 */
function findFilesByPattern(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const ignoreDirs = new Set(["node_modules", ".git", "dist", ".next", "build"]);

  function walk(currentDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoreDirs.has(entry)) continue;
      const fullPath = join(currentDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (pattern.test(entry)) {
          results.push(fullPath);
        }
      } catch {
        // skip
      }
    }
  }

  walk(dir);
  return results;
}

export async function analyzePrototype(repoDir: string): Promise<LaunchPlan> {
  // 1. Read package.json
  const pkgPath = join(repoDir, "package.json");
  const pkg = existsSync(pkgPath)
    ? JSON.parse(readFileSync(pkgPath, "utf-8"))
    : {};
  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // 2. Detect framework
  let framework: string | null = null;
  if (allDeps.next) framework = "next";
  else if (allDeps.astro) framework = "astro";
  else if (allDeps.svelte || allDeps["@sveltejs/kit"]) framework = "svelte";
  else if (allDeps.vue || allDeps.nuxt) framework = "vue";
  else if (allDeps.react) framework = "react";
  else if (allDeps.express) framework = "express";

  // 3. Detect database
  let database: string | null = null;
  if (allDeps["@supabase/supabase-js"] || allDeps["@supabase/ssr"])
    database = "supabase";
  else if (allDeps.prisma || allDeps["@prisma/client"]) database = "prisma";
  else if (allDeps.drizzle || allDeps["drizzle-orm"]) database = "drizzle";
  else if (allDeps.mongoose) database = "mongoose";

  // 4. Detect styling
  let styling: string | null = null;
  if (
    allDeps.tailwindcss ||
    existsSync(join(repoDir, "tailwind.config.js")) ||
    existsSync(join(repoDir, "tailwind.config.ts"))
  )
    styling = "tailwind";
  else if (allDeps["styled-components"]) styling = "styled-components";
  else if (allDeps["@emotion/react"]) styling = "emotion";

  // 5. Detect language
  const language: "typescript" | "javascript" = existsSync(
    join(repoDir, "tsconfig.json"),
  )
    ? "typescript"
    : "javascript";

  // 6. Detect package manager
  let packageManager: "npm" | "yarn" | "pnpm" | "bun" = "npm";
  if (
    existsSync(join(repoDir, "bun.lockb")) ||
    existsSync(join(repoDir, "bun.lock"))
  )
    packageManager = "bun";
  else if (existsSync(join(repoDir, "pnpm-lock.yaml")))
    packageManager = "pnpm";
  else if (existsSync(join(repoDir, "yarn.lock"))) packageManager = "yarn";

  // 7. Check for tests
  const testFiles = findTestFiles(repoDir);
  const testDirs =
    existsSync(join(repoDir, "__tests__")) ||
    existsSync(join(repoDir, "tests")) ||
    existsSync(join(repoDir, "test"));
  const needsTests = testFiles.length === 0 && !testDirs;

  // 8. Check for ENV keys
  const envKeys: string[] = [];
  for (const envFile of [".env.example", ".env.local", ".env"]) {
    const envPath = join(repoDir, envFile);
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      const keys = content
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#"))
        .map((line) => line.split("=")[0].trim())
        .filter((key) => key.length > 0);
      for (const key of keys) {
        if (!envKeys.includes(key)) envKeys.push(key);
      }
    }
  }

  // 9. Check for hardcoded secrets (simple heuristic)
  let needsSecurity = false;
  try {
    const grepResult = execSync(
      `grep -r -l --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "(sk_live_|sk_test_|SUPABASE_URL\\s*=\\s*['\\"']https|SUPABASE_ANON_KEY\\s*=\\s*['\\"']ey|Bearer ['\\"']ey)" "${repoDir}" 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();
    needsSecurity = grepResult.length > 0;
  } catch {
    // grep failure is non-fatal
  }

  // 10. Check if .env is committed (security issue)
  if (existsSync(join(repoDir, ".env"))) {
    needsSecurity = true;
  }

  // 11. Check for lockfile
  const needsLockfile =
    !existsSync(join(repoDir, "package-lock.json")) &&
    !existsSync(join(repoDir, "yarn.lock")) &&
    !existsSync(join(repoDir, "pnpm-lock.yaml")) &&
    !existsSync(join(repoDir, "bun.lockb")) &&
    !existsSync(join(repoDir, "bun.lock"));

  // 12. Check if project builds
  let needsBuildFix = false;
  const buildScript = pkg.scripts?.build;
  if (buildScript) {
    try {
      const installCmd =
        packageManager === "bun" ? "bun install" : `${packageManager} install`;
      execSync(installCmd, {
        cwd: repoDir,
        stdio: "pipe",
        timeout: 120_000,
      });

      const buildCmd =
        packageManager === "bun"
          ? "bun run build"
          : `${packageManager} run build`;
      execSync(buildCmd, { cwd: repoDir, stdio: "pipe", timeout: 120_000 });
    } catch {
      needsBuildFix = true;
    }
  }

  // 13. Check for error handling
  let needsErrorHandling = false;
  if (framework === "next") {
    const errorBoundaries = findFilesByPattern(
      repoDir,
      /^error\.(tsx|jsx|ts|js)$/,
    );
    const globalError = findFilesByPattern(
      repoDir,
      /^global-error\.(tsx|jsx|ts|js)$/,
    );
    needsErrorHandling =
      errorBoundaries.length === 0 && globalError.length === 0;
  } else if (framework === "react") {
    try {
      const result = execSync(
        `grep -r -l --include="*.tsx" --include="*.jsx" "ErrorBoundary\\|componentDidCatch" "${repoDir}" 2>/dev/null || true`,
        { encoding: "utf-8", timeout: 10_000 },
      ).trim();
      needsErrorHandling = result.length === 0;
    } catch {
      needsErrorHandling = true;
    }
  }

  // 14. Build steps list
  const steps: LaunchStep[] = [
    { id: "analyze", label: "Analyze prototype", status: "pending" },
  ];

  if (needsBuildFix) {
    steps.push({
      id: "build-fix",
      label: "Fix build errors",
      status: "pending",
    });
  }

  if (needsErrorHandling) {
    steps.push({
      id: "error-handling",
      label: "Add error handling",
      status: "pending",
      parallel: true,
    });
  }
  if (needsTests) {
    steps.push({
      id: "tests",
      label: "Write tests",
      status: "pending",
      parallel: true,
    });
  }
  if (needsSecurity) {
    steps.push({
      id: "security",
      label: "Security hardening",
      status: "pending",
      parallel: true,
    });
  }

  if (envKeys.length > 0) {
    steps.push({
      id: "env-input",
      label: `Configure environment (${envKeys.length} variables)`,
      status: "pending",
    });
  }

  steps.push({
    id: "deploy",
    label: "Deploy to Just Ship Cloud",
    status: "pending",
  });

  return {
    stack: { framework, database, styling, language, packageManager },
    gaps: {
      needsBuildFix,
      needsErrorHandling,
      needsTests,
      needsSecurity,
      needsLockfile,
    },
    envKeys,
    steps,
  };
}
