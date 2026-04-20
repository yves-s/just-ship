import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  handleAttach,
  parseMultipart,
  validateFiles,
  uploadOne,
  AttachValidationError,
  AttachUploadError,
  MAX_FILES,
  MAX_FILE_SIZE_BYTES,
  BUCKET,
  type ParsedFile,
  type StorageConfig,
} from "./sidekick-attach.ts";

// ---------------------------------------------------------------------------
// Test helpers — synthesize realistic multipart bodies and a fake
// IncomingMessage stream from them, plus a mock fetch that returns scripted
// responses. We use a real Node stream so the parser exercises the same
// data-flow it would under a real HTTP server.
// ---------------------------------------------------------------------------

const BOUNDARY = "----JustShipTestBoundary";

// Fixture UUIDs used across tests — workspace_id / project_id / conversation_id
// must be UUIDs (enforced by the handler as a path-traversal guard). Keep them
// hand-rolled so any future change to UUID validation fails loudly here.
const WS_UUID = "11111111-1111-4111-8111-111111111111";
const PROJ_UUID = "22222222-2222-4222-8222-222222222222";
const CONV_UUID = "33333333-3333-4333-8333-333333333333";

interface FilePart {
  field?: string;
  filename: string;
  mimeType: string;
  data: Buffer | string;
}

interface FieldPart {
  name: string;
  value: string;
}

function buildMultipartBody(parts: Array<FilePart | FieldPart>): Buffer {
  const pieces: Buffer[] = [];
  for (const part of parts) {
    pieces.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ("filename" in part) {
      const field = part.field ?? "files";
      pieces.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${field}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.mimeType}\r\n\r\n`,
        ),
      );
      pieces.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data));
      pieces.push(Buffer.from("\r\n"));
    } else {
      pieces.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    }
  }
  pieces.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(pieces);
}

function makeRequest(body: Buffer, contentType = `multipart/form-data; boundary=${BOUNDARY}`): IncomingMessage {
  const stream = new PassThrough();
  stream.end(body);
  const req = stream as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = {
    "content-type": contentType,
  };
  // Some internals on IncomingMessage the parser never touches, but TS will
  // want them on fake casts. Leaving them undefined is fine because the
  // handler only touches .headers and the stream interface.
  return req;
}

// A tiny PNG byte signature — not a valid image but indistinguishable to
// our validator, which only cares about MIME type + size.
function pngBytes(size: number): Buffer {
  const buf = Buffer.alloc(size, 0xab);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buf, 0);
  return buf;
}

function storageCfgWithOk(): { cfg: StorageConfig; calls: Array<{ url: string; method: string; headers: Record<string, string>; bodyLen: number }> } {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; bodyLen: number }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const body = init?.body;
    const bodyLen = body instanceof Uint8Array ? body.byteLength : Buffer.isBuffer(body) ? body.length : typeof body === "string" ? body.length : 0;
    calls.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      bodyLen,
    });
    return { ok: true, status: 200, statusText: "OK", async text() { return ""; } } as unknown as Response;
  };
  return {
    cfg: { url: "https://storage.example.com", serviceKey: "service-key", fetchFn },
    calls,
  };
}

function storageCfgWithError(status: number): StorageConfig {
  const fetchFn: typeof fetch = async () => {
    return {
      ok: false,
      status,
      statusText: "Error",
      async text() { return `upload failed: ${status}`; },
    } as unknown as Response;
  };
  return { url: "https://storage.example.com", serviceKey: "service-key", fetchFn };
}

// ---------------------------------------------------------------------------
// parseMultipart — raw parser tests
// ---------------------------------------------------------------------------

describe("parseMultipart", () => {
  it("parses a single file part with fields", () => {
    const body = buildMultipartBody([
      { name: "project_id", value: "proj-123" },
      { name: "workspace_id", value: "ws-abc" },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(100) },
    ]);
    const parsed = parseMultipart(body, BOUNDARY);
    expect(parsed.fields.project_id).toBe("proj-123");
    expect(parsed.fields.workspace_id).toBe("ws-abc");
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].filename).toBe("a.png");
    expect(parsed.files[0].mimeType).toBe("image/png");
    expect(parsed.files[0].data.length).toBe(100);
  });

  it("parses multiple file parts", () => {
    const body = buildMultipartBody([
      { filename: "a.png", mimeType: "image/png", data: pngBytes(50) },
      { filename: "b.webp", mimeType: "image/webp", data: pngBytes(60) },
      { filename: "c.gif", mimeType: "image/gif", data: pngBytes(70) },
    ]);
    const parsed = parseMultipart(body, BOUNDARY);
    expect(parsed.files).toHaveLength(3);
    expect(parsed.files.map((f) => f.filename)).toEqual(["a.png", "b.webp", "c.gif"]);
  });

  it("rejects per-part bodies over MAX_FILE_SIZE_BYTES", () => {
    const body = buildMultipartBody([
      { filename: "big.jpg", mimeType: "image/jpeg", data: pngBytes(MAX_FILE_SIZE_BYTES + 1) },
    ]);
    expect(() => parseMultipart(body, BOUNDARY)).toThrow(AttachValidationError);
    try {
      parseMultipart(body, BOUNDARY);
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).status).toBe(413);
    }
  });

  it("throws on malformed body", () => {
    // Missing boundary entirely
    expect(() => parseMultipart(Buffer.from("not multipart at all"), BOUNDARY)).toThrow(AttachValidationError);
  });
});

// ---------------------------------------------------------------------------
// validateFiles
// ---------------------------------------------------------------------------

describe("validateFiles", () => {
  function file(filename: string, mimeType: string, size = 100): ParsedFile {
    return { field: "files", filename, mimeType, data: pngBytes(size) };
  }

  it("accepts all allowed MIME types", () => {
    expect(() =>
      validateFiles([
        file("a.jpg", "image/jpeg"),
        file("b.png", "image/png"),
        file("c.webp", "image/webp"),
        file("d.gif", "image/gif"),
      ]),
    ).not.toThrow();
  });

  it("rejects disallowed MIME types with 415", () => {
    try {
      validateFiles([file("evil.svg", "image/svg+xml")]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).status).toBe(415);
      expect((err as AttachValidationError).message).toMatch(/Invalid file type/);
    }
  });

  it("rejects zero files", () => {
    expect(() => validateFiles([])).toThrow(AttachValidationError);
  });

  it(`rejects more than ${MAX_FILES} files with 400`, () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`f${i}.png`, "image/png"));
    try {
      validateFiles(files);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).status).toBe(400);
      expect((err as AttachValidationError).message).toMatch(/Maximum 5 files/);
    }
  });

  it("rejects oversize files with 413", () => {
    try {
      validateFiles([file("big.png", "image/png", MAX_FILE_SIZE_BYTES + 1)]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).status).toBe(413);
    }
  });
});

// ---------------------------------------------------------------------------
// uploadOne — storage REST contract
// ---------------------------------------------------------------------------

describe("uploadOne", () => {
  it("uploads to the correct bucket path and returns a public URL", async () => {
    const { cfg, calls } = storageCfgWithOk();
    const file: ParsedFile = {
      field: "files",
      filename: "picture.png",
      mimeType: "image/png",
      data: pngBytes(256),
    };
    const result = await uploadOne(file, "ws-xyz", "conv-1", cfg);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toContain(`/storage/v1/object/${BUCKET}/ws-xyz/conv-1/`);
    expect(call.url).toMatch(/\.png$/);
    expect(call.headers["Authorization"]).toBe("Bearer service-key");
    expect(call.headers["apikey"]).toBe("service-key");
    expect(call.headers["Content-Type"]).toBe("image/png");
    expect(call.headers["x-upsert"]).toBe("false");
    expect(call.bodyLen).toBe(256);

    expect(result.name).toBe("picture.png");
    expect(result.type).toBe("image/png");
    expect(result.url).toMatch(
      new RegExp(
        `^https://storage\\.example\\.com/storage/v1/object/public/${BUCKET}/ws-xyz/conv-1/[0-9a-f-]+\\.png$`,
      ),
    );
  });

  it("throws AttachUploadError on storage failure", async () => {
    const cfg = storageCfgWithError(500);
    const file: ParsedFile = {
      field: "files",
      filename: "x.png",
      mimeType: "image/png",
      data: pngBytes(100),
    };
    await expect(uploadOne(file, "ws", "folder", cfg)).rejects.toThrow(AttachUploadError);
  });
});

// ---------------------------------------------------------------------------
// handleAttach — end-to-end handler
// ---------------------------------------------------------------------------

describe("handleAttach (happy path)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://storage.example.com";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
  });

  it("uploads 1 file and returns a URL in the files array", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      { filename: "hello.png", mimeType: "image/png", data: pngBytes(200) },
    ]);
    const { cfg, calls } = storageCfgWithOk();
    const req = makeRequest(body);
    const result = await handleAttach(req, { storage: cfg });

    expect(calls).toHaveLength(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("hello.png");
    expect(result.files[0].type).toBe("image/png");
    expect(result.files[0].url).toContain(`/public/${BUCKET}/${WS_UUID}/pending/`);
  });

  it("uses conversation_id as folder when provided", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      { name: "conversation_id", value: CONV_UUID },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(100) },
    ]);
    const { cfg, calls } = storageCfgWithOk();
    const result = await handleAttach(makeRequest(body), { storage: cfg });
    expect(calls[0].url).toContain(`/${WS_UUID}/${CONV_UUID}/`);
    expect(result.files[0].url).toContain(`/${WS_UUID}/${CONV_UUID}/`);
  });

  it("uploads 5 files and preserves MIME types", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      { filename: "a.jpg", mimeType: "image/jpeg", data: pngBytes(50) },
      { filename: "b.png", mimeType: "image/png", data: pngBytes(60) },
      { filename: "c.webp", mimeType: "image/webp", data: pngBytes(70) },
      { filename: "d.gif", mimeType: "image/gif", data: pngBytes(80) },
      { filename: "e.jpg", mimeType: "image/jpeg", data: pngBytes(90) },
    ]);
    const { cfg, calls } = storageCfgWithOk();
    const result = await handleAttach(makeRequest(body), { storage: cfg });
    expect(calls).toHaveLength(5);
    expect(result.files).toHaveLength(5);
    expect(result.files.map((f) => f.type)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/jpeg",
    ]);
  });
});

describe("handleAttach (rejections)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://storage.example.com";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
  });

  it("rejects non-multipart content types with 400", async () => {
    const req = makeRequest(Buffer.from("{}"), "application/json");
    await expect(handleAttach(req)).rejects.toThrow(AttachValidationError);
  });

  it("rejects 6 files with 400", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      ...Array.from({ length: 6 }, (_, i) => ({
        filename: `f${i}.png`,
        mimeType: "image/png",
        data: pngBytes(100),
      })),
    ]);
    const { cfg } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).status).toBe(400);
    }
  });

  it("rejects a file > 5 MB with 413", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      {
        filename: "big.png",
        mimeType: "image/png",
        data: pngBytes(MAX_FILE_SIZE_BYTES + 1),
      },
    ]);
    const { cfg } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).status).toBe(413);
    }
  });

  it("rejects wrong MIME types with 415", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      { filename: "evil.svg", mimeType: "image/svg+xml", data: pngBytes(100) },
    ]);
    const { cfg } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).status).toBe(415);
    }
  });

  it("rejects missing project_id with 400", async () => {
    const body = buildMultipartBody([
      { name: "workspace_id", value: WS_UUID },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(100) },
    ]);
    const { cfg } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).message).toMatch(/project_id/);
    }
  });

  it("rejects missing workspace_id with 400", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(100) },
    ]);
    const { cfg } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).message).toMatch(/workspace_id/);
    }
  });

  it("rejects non-UUID workspace_id (path-traversal guard)", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: "../other-workspace" },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(100) },
    ]);
    const { cfg, calls } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).message).toMatch(/workspace_id/);
    }
    // Must NOT reach storage — reject before any network call.
    expect(calls).toHaveLength(0);
  });

  it("rejects non-UUID project_id (path-traversal guard)", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: "../../admin" },
      { name: "workspace_id", value: WS_UUID },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(100) },
    ]);
    const { cfg, calls } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).message).toMatch(/project_id/);
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects non-UUID conversation_id (path-traversal guard)", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      { name: "conversation_id", value: "../../../etc/passwd" },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(100) },
    ]);
    const { cfg, calls } = storageCfgWithOk();
    try {
      await handleAttach(makeRequest(body), { storage: cfg });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachValidationError);
      expect((err as AttachValidationError).message).toMatch(/conversation_id/);
    }
    expect(calls).toHaveLength(0);
  });

  it("surfaces storage failures as AttachUploadError", async () => {
    const body = buildMultipartBody([
      { name: "project_id", value: PROJ_UUID },
      { name: "workspace_id", value: WS_UUID },
      { filename: "a.png", mimeType: "image/png", data: pngBytes(200) },
    ]);
    const cfg = storageCfgWithError(500);
    await expect(handleAttach(makeRequest(body), { storage: cfg })).rejects.toThrow(AttachUploadError);
  });
});
