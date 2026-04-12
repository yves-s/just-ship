/**
 * Tests for Coolify Preview URL Poller (Coolify v4 Beta API)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForCoolifyPreview, type CoolifyConfig } from "./coolify-preview.js";

const BASE_CONFIG: CoolifyConfig = {
  coolifyUrl: "https://coolify.example.com",
  coolifyAppUuid: "v7ivmdiih5421n863927r8o0",
  coolifyPollIntervalMs: 50,
  coolifyMaxWaitMs: 300,
};

/** Helper to create a mock fetch that routes by URL pattern */
function mockFetch(handlers: Record<string, () => Promise<Response>>) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (urlStr.includes(pattern)) {
        return handler();
      }
    }
    return new Response("Not found", { status: 404 });
  });
}

/** Helper to create a JSON Response */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("coolify-preview", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COOLIFY_API_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("waitForCoolifyPreview — precondition checks", () => {
    it("returns null when COOLIFY_API_TOKEN is not set", async () => {
      const result = await waitForCoolifyPreview("main", BASE_CONFIG);
      expect(result).toBeNull();
    });

    it("returns null when coolifyUrl is missing", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";
      const result = await waitForCoolifyPreview("main", { ...BASE_CONFIG, coolifyUrl: "" });
      expect(result).toBeNull();
    });

    it("returns null when coolifyAppUuid is missing", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";
      const result = await waitForCoolifyPreview("main", { ...BASE_CONFIG, coolifyAppUuid: "" });
      expect(result).toBeNull();
    });
  });

  describe("waitForCoolifyPreview — deployment finished (production)", () => {
    it("returns production FQDN when deployment is finished with pull_request_id 0", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
            preview_url_template: "{{pr_id}}.{{domain}}",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 137,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "abc123",
              status: "finished",
              pull_request_id: 0,
              created_at: "2026-04-10T19:48:54.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("main", BASE_CONFIG);
      expect(result).toBe("https://board.just-ship.io");
    });
  });

  describe("waitForCoolifyPreview — PR preview URL", () => {
    it("returns PR preview URL using default template ({{pr_id}}.{{domain}})", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
            preview_url_template: "{{pr_id}}.{{domain}}",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 138,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "pr-deploy-42",
              status: "finished",
              pull_request_id: 42,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("feature/T-42-some-feature", BASE_CONFIG);
      expect(result).toBe("https://42.board.just-ship.io");
    });

    it("returns PR preview URL using custom template (board-{{pr_id}}.preview.just-ship.io)", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
            preview_url_template: "board-{{pr_id}}.preview.just-ship.io",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 139,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "pr-deploy-126",
              status: "finished",
              pull_request_id: 126,
              created_at: "2026-04-10T20:38:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("fix/T-126-pricing-ui", BASE_CONFIG);
      expect(result).toBe("https://board-126.preview.just-ship.io");
    });

    it("returns production FQDN when PR but no preview_url_template", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 140,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "pr-deploy-no-template",
              status: "finished",
              pull_request_id: 50,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("feature/T-50-test", BASE_CONFIG);
      expect(result).toBe("https://board.just-ship.io");
    });
  });

  describe("waitForCoolifyPreview — failure states", () => {
    it("returns null when deployment status is failed", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 139,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "failed-deploy",
              status: "failed",
              pull_request_id: 0,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("main", BASE_CONFIG);
      expect(result).toBeNull();
    });

    it("returns null when deployment status is cancelled", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 140,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "cancelled-deploy",
              status: "cancelled",
              pull_request_id: 0,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("main", BASE_CONFIG);
      expect(result).toBeNull();
    });

    it("returns null when FQDN is not set on the application", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: null,
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 141,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "no-fqdn-deploy",
              status: "finished",
              pull_request_id: 0,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("main", BASE_CONFIG);
      expect(result).toBeNull();
    });
  });

  describe("waitForCoolifyPreview — timeout and errors", () => {
    it("returns production FQDN when deployment timeout occurs and no PR available (AC#2: works without API data)", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 142,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "stuck-deploy",
              status: "in_progress",
              pull_request_id: 0,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("main", {
        ...BASE_CONFIG,
        coolifyMaxWaitMs: 120,
        coolifyPollIntervalMs: 50,
      });
      expect(result).toBe("https://board.just-ship.io");
    });

    it("returns production FQDN when deployments API returns empty array for app (AC#2: works when API provides no data)", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = mockFetch({
        "/api/v1/applications/": async () =>
          jsonResponse({
            uuid: "v7ivmdiih5421n863927r8o0",
            name: "just-ship-board",
            fqdn: "https://board.just-ship.io",
          }),
        "/api/v1/deployments": async () =>
          jsonResponse([
            {
              id: 143,
              application_id: "2",
              application_name: "some-other-app",
              deployment_uuid: "other-deploy",
              status: "finished",
              pull_request_id: 0,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]),
      });

      const result = await waitForCoolifyPreview("main", {
        ...BASE_CONFIG,
        coolifyMaxWaitMs: 120,
        coolifyPollIntervalMs: 50,
      });
      expect(result).toBe("https://board.just-ship.io");
    });

    it("handles fetch timeout gracefully", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = vi.fn().mockRejectedValue(new Error("AbortError: The operation was aborted"));

      const result = await waitForCoolifyPreview("main", {
        ...BASE_CONFIG,
        coolifyMaxWaitMs: 120,
        coolifyPollIntervalMs: 50,
      });
      expect(result).toBeNull();
    });

    it("returns null when app API returns non-OK status (graceful failure, AC#4)", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      global.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/api/v1/applications/")) {
          return new Response("Server error", { status: 500 });
        }
        if (urlStr.includes("/api/v1/deployments")) {
          return jsonResponse([
            {
              id: 144,
              application_id: "1",
              application_name: "just-ship-board",
              deployment_uuid: "retry-deploy",
              status: "finished",
              pull_request_id: 0,
              created_at: "2026-04-10T20:00:00.000000Z",
            },
          ]);
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await waitForCoolifyPreview("main", BASE_CONFIG);
      expect(result).toBeNull();
    });
  });

  describe("CoolifyConfig interface", () => {
    it("has all required fields", () => {
      const config: CoolifyConfig = {
        coolifyUrl: "https://coolify.example.com",
        coolifyAppUuid: "app123",
        coolifyPollIntervalMs: 10000,
        coolifyMaxWaitMs: 300000,
      };

      expect(config.coolifyUrl).toBeDefined();
      expect(config.coolifyAppUuid).toBeDefined();
      expect(config.coolifyPollIntervalMs).toBeDefined();
      expect(config.coolifyMaxWaitMs).toBeDefined();
    });
  });
});
