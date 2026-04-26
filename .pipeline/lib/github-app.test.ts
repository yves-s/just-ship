import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateAppJwt, clearTokenCache, loadGitHubAppConfig, resolveGitHubToken, getInstallationToken } from "./github-app.ts";
import { generateKeyPairSync } from "node:crypto";

// Generate a test RSA key pair
const { privateKey: testPrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

describe("github-app", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  describe("generateAppJwt", () => {
    it("generates a valid JWT with three segments", () => {
      const jwt = generateAppJwt({ appId: "12345", privateKey: testPrivateKey });
      const parts = jwt.split(".");
      expect(parts).toHaveLength(3);

      // Decode header
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      expect(header.alg).toBe("RS256");
      expect(header.typ).toBe("JWT");

      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      expect(payload.iss).toBe("12345");
      expect(payload.exp).toBeGreaterThan(payload.iat);
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(660); // ~10 min + 60s clock skew
    });

    it("uses RS256 algorithm", () => {
      const jwt = generateAppJwt({ appId: "99999", privateKey: testPrivateKey });
      const header = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString());
      expect(header.alg).toBe("RS256");
    });
  });

  describe("loadGitHubAppConfig", () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...origEnv };
    });

    it("returns null when GITHUB_APP_ID is not set", () => {
      delete process.env.GITHUB_APP_ID;
      delete process.env.GITHUB_APP_PRIVATE_KEY;
      delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;
      expect(loadGitHubAppConfig()).toBeNull();
    });

    it("loads config from GITHUB_APP_PRIVATE_KEY env var", () => {
      process.env.GITHUB_APP_ID = "12345";
      process.env.GITHUB_APP_PRIVATE_KEY = testPrivateKey;
      delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;

      const config = loadGitHubAppConfig();
      expect(config).not.toBeNull();
      expect(config!.appId).toBe("12345");
      expect(config!.privateKey).toBe(testPrivateKey);
    });

    it("returns null when only GITHUB_APP_ID is set without key", () => {
      process.env.GITHUB_APP_ID = "12345";
      delete process.env.GITHUB_APP_PRIVATE_KEY;
      delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;

      expect(loadGitHubAppConfig()).toBeNull();
    });
  });

  describe("getInstallationToken", () => {
    it("generates and caches installation token", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      const mockResponse = {
        ok: true,
        json: async () => ({
          token: "ghu_test_token_123",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        text: async () => "",
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const token = await getInstallationToken(
        { appId: "12345", privateKey: testPrivateKey },
        789
      );

      expect(token).toBe("ghu_test_token_123");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const token2 = await getInstallationToken(
        { appId: "12345", privateKey: testPrivateKey },
        789
      );
      expect(token2).toBe("ghu_test_token_123");
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it("handles token expiry and refreshes with margin", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      // First token expires in 2 minutes
      const mockResponse1 = {
        ok: true,
        json: async () => ({
          token: "ghu_first_token",
          expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
        }),
        text: async () => "",
      };
      mockFetch.mockResolvedValueOnce(mockResponse1);

      const token1 = await getInstallationToken(
        { appId: "12345", privateKey: testPrivateKey },
        789
      );
      expect(token1).toBe("ghu_first_token");

      // Second call should refresh because margin is 5 minutes (token expires in 2 min)
      const mockResponse2 = {
        ok: true,
        json: async () => ({
          token: "ghu_refreshed_token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        text: async () => "",
      };
      mockFetch.mockResolvedValueOnce(mockResponse2);

      const token2 = await getInstallationToken(
        { appId: "12345", privateKey: testPrivateKey },
        789
      );
      expect(token2).toBe("ghu_refreshed_token");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws error on GitHub API failure", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      const mockResponse = {
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(
        getInstallationToken(
          { appId: "12345", privateKey: testPrivateKey },
          789
        )
      ).rejects.toThrow(/GitHub installation token request failed/);
    });
  });

  describe("resolveGitHubToken", () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...origEnv };
    });

    it("returns explicit githubToken when provided", async () => {
      const token = await resolveGitHubToken({ githubToken: "ghp_test123" });
      expect(token).toBe("ghp_test123");
    });

    it("falls back to GH_TOKEN env var", async () => {
      process.env.GH_TOKEN = "ghp_env_token";
      const token = await resolveGitHubToken({});
      expect(token).toBe("ghp_env_token");
    });

    it("returns null when no token source available", async () => {
      delete process.env.GH_TOKEN;
      const token = await resolveGitHubToken({});
      expect(token).toBeNull();
    });

    it("prefers explicit token over env var", async () => {
      process.env.GH_TOKEN = "ghp_env";
      const token = await resolveGitHubToken({ githubToken: "ghp_explicit" });
      expect(token).toBe("ghp_explicit");
    });

    it("generates installation token when installationId and appConfig provided", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      const mockResponse = {
        ok: true,
        json: async () => ({
          token: "ghu_app_token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        text: async () => "",
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const token = await resolveGitHubToken({
        installationId: 456,
        appConfig: { appId: "12345", privateKey: testPrivateKey },
      });

      expect(token).toBe("ghu_app_token");
    });

    it("falls back to GH_TOKEN when installation token generation fails", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      const mockResponse = {
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      };
      mockFetch.mockResolvedValueOnce(mockResponse);
      process.env.GH_TOKEN = "ghp_fallback";

      const token = await resolveGitHubToken({
        installationId: 456,
        appConfig: { appId: "12345", privateKey: testPrivateKey },
      });

      expect(token).toBe("ghp_fallback");
    });

    it("prefers installation token over explicit token", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      const mockResponse = {
        ok: true,
        json: async () => ({
          token: "ghu_app_token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        text: async () => "",
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const token = await resolveGitHubToken({
        installationId: 456,
        githubToken: "ghp_explicit",
        appConfig: { appId: "12345", privateKey: testPrivateKey },
      });

      // Should prefer app token over explicit
      expect(token).toBe("ghu_app_token");
    });
  });
});
