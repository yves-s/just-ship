interface BudgetConfig {
  apiUrl: string;
  apiKey: string;
}

interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  currentCost?: number;
  ceiling?: number;
  thresholdReached?: boolean;
}

/**
 * Check if the workspace has exceeded its monthly budget ceiling.
 * Returns allowed: true if no ceiling set or under budget.
 * Fails open — API errors allow the pipeline to proceed.
 */
export async function checkBudget(
  config: BudgetConfig,
  workspaceId: string,
): Promise<BudgetCheckResult> {
  try {
    const wsRes = await fetch(`${config.apiUrl}/api/workspaces/${workspaceId}`, {
      headers: { "X-Pipeline-Key": config.apiKey },
      signal: AbortSignal.timeout(8000),
    });

    if (!wsRes.ok) {
      console.error(`[Budget] Failed to fetch workspace: ${wsRes.status}`);
      return { allowed: true };
    }

    const workspace = (await wsRes.json()) as { data?: Record<string, unknown> };
    const wsData = (workspace.data ?? workspace) as Record<string, unknown>;
    const ceiling = Number(wsData.budget_ceiling_usd) || 0;

    if (!ceiling) return { allowed: true };

    const costRes = await fetch(
      `${config.apiUrl}/api/workspaces/${workspaceId}/costs?period=current_month`,
      {
        headers: { "X-Pipeline-Key": config.apiKey },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!costRes.ok) {
      console.error(`[Budget] Failed to fetch costs: ${costRes.status}`);
      return { allowed: true };
    }

    const costs = (await costRes.json()) as { data?: { total_cost_usd?: number }; total_cost_usd?: number };
    const currentCost = Number(costs.data?.total_cost_usd ?? costs.total_cost_usd ?? 0);
    const threshold = Number(wsData.budget_alert_threshold) || 0.8;

    if (currentCost >= ceiling) {
      return {
        allowed: false,
        reason: `Budget exceeded: $${currentCost.toFixed(2)} / $${ceiling.toFixed(2)}`,
        currentCost,
        ceiling,
      };
    }

    return {
      allowed: true,
      currentCost,
      ceiling,
      thresholdReached: currentCost >= ceiling * threshold,
    };
  } catch (error) {
    console.error(`[Budget] Check failed: ${error instanceof Error ? error.message : String(error)}`);
    return { allowed: true };
  }
}
