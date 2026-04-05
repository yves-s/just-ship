/**
 * Tests for Coolify Preview URL Poller
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitForCoolifyPreview, type CoolifyConfig } from "./coolify-preview.js";

describe("coolify-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COOLIFY_API_TOKEN;
  });

  describe("waitForCoolifyPreview", () => {
    it("returns null when COOLIFY_API_TOKEN is not set", async () => {
      const config: CoolifyConfig = {
        coolifyUrl: "https://coolify.example.com",
        coolifyAppUuid: "app123",
        coolifyPollIntervalMs: 100,
        coolifyMaxWaitMs: 500,
      };

      const result = await waitForCoolifyPreview("main", config);
      expect(result).toBeNull();
    });

    it("returns null when coolifyUrl is missing", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";
      const config: CoolifyConfig = {
        coolifyUrl: "",
        coolifyAppUuid: "app123",
        coolifyPollIntervalMs: 100,
        coolifyMaxWaitMs: 500,
      };

      const result = await waitForCoolifyPreview("main", config);
      expect(result).toBeNull();
    });

    it("returns null when coolifyAppUuid is missing", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";
      const config: CoolifyConfig = {
        coolifyUrl: "https://coolify.example.com",
        coolifyAppUuid: "",
        coolifyPollIntervalMs: 100,
        coolifyMaxWaitMs: 500,
      };

      const result = await waitForCoolifyPreview("main", config);
      expect(result).toBeNull();
    });

    it("handles fetch timeout gracefully", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      // Mock fetch to simulate timeout
      global.fetch = vi.fn().mockRejectedValue(new Error("AbortError: The operation was aborted"));

      const config: CoolifyConfig = {
        coolifyUrl: "https://coolify.example.com",
        coolifyAppUuid: "app123",
        coolifyPollIntervalMs: 50,
        coolifyMaxWaitMs: 100,
      };

      const result = await waitForCoolifyPreview("main", config);
      expect(result).toBeNull();
    });

    it("returns null when max wait time is exceeded", async () => {
      process.env.COOLIFY_API_TOKEN = "token123";

      // Mock fetch to return incomplete deployment
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fqdn: null }),
      });

      const config: CoolifyConfig = {
        coolifyUrl: "https://coolify.example.com",
        coolifyAppUuid: "app123",
        coolifyPollIntervalMs: 50,
        coolifyMaxWaitMs: 100,
      };

      const result = await waitForCoolifyPreview("main", config);
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
