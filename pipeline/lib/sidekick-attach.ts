import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { logger } from "./logger.ts";

/**
 * Sidekick image upload proxy — T-925.
 *
 * Accepts a multipart/form-data request with 1–5 image files, validates each
 * against the MIME whitelist and a 5 MB per-file cap, then uploads to the
 * Board's `ticket-attachments` Supabase Storage bucket using the service-role
 * key. Returns public URLs to the caller in the same shape Board's own
 * `POST /api/sidekick/upload` uses, so the Board widget can switch to this
 * endpoint without a client-side refactor and the terminal Sidekick can reuse
 * the same response contract.
 *
 * Why a bespoke multipart parser instead of busboy / formidable: the server
 * currently has zero HTTP-layer dependencies (native `node:http`). For a
 * single endpoint with a tiny file count and strict size caps (5×5 MB), a
 * ~120-line streaming parser keeps the dep graph and attack surface small.
 */

// ---------------------------------------------------------------------------
// Limits + MIME whitelist — enforced for every request. Kept as module
// constants rather than env vars because these are product decisions, not
// deployment config; changing them is a code review, not an ops toggle.
// ---------------------------------------------------------------------------

export const MAX_FILES = 5;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// Storage-path IDs are interpolated into the URL `{workspace_id}/{folder}/{uuid}.{ext}`.
// A caller that controls either field could escape the intended namespace
// (e.g. `workspace_id=../other-ws`), so we require a strict UUID shape
// before any value flows into the path. Matches the server-side Board
// contract where workspace_id / project_id / conversation_id are all UUIDs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string | undefined | null): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Hard ceiling on the *entire* request: 5 files × 5 MB + slack for form
// framing, field names, boundaries. Anything bigger is either an abuse
// attempt or a client bug — we refuse upfront rather than buffer megabytes
// of a request that will fail validation anyway.
export const MAX_TOTAL_REQUEST_BYTES = MAX_FILES * MAX_FILE_SIZE_BYTES + 64 * 1024;

// Supabase Storage bucket the Board uses today — DO NOT change without also
// migrating existing attachments; the Board widget still reads public URLs
// from this bucket.
export const BUCKET = "ticket-attachments";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Client-facing validation failure. `status` determines the HTTP response
 * code. 400 for wrong-shape requests, 413 for oversized files (one of the
 * explicit ACs from T-925).
 */
export class AttachValidationError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415 = 400) {
    super(message);
    this.name = "AttachValidationError";
  }
}

/**
 * Storage upload failure. 502 (bad gateway) since the Engine proxies to
 * Supabase — from the caller's perspective the upstream is unreachable.
 */
export class AttachUploadError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "AttachUploadError";
  }
}

// ---------------------------------------------------------------------------
// Parsed multipart representation
// ---------------------------------------------------------------------------

export interface ParsedFile {
  field: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface ParsedForm {
  fields: Record<string, string>;
  files: ParsedFile[];
}

// ---------------------------------------------------------------------------
// Multipart parser — streams the request, enforces total-size cap and
// per-file cap as bytes flow in. Does NOT attempt to parse nested multipart
// bodies, transfer-encoding chunking, or RFC 2231 continuations; the Board
// widget and terminal Sidekick both produce plain top-level multipart with
// simple UTF-8 filenames.
// ---------------------------------------------------------------------------

function extractBoundary(contentType: string): string {
  // Accept both `boundary=abc` and `boundary="abc"` (quoted form). Anything
  // else is malformed as far as this endpoint is concerned.
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  if (!match) {
    throw new AttachValidationError("Invalid Content-Type: missing multipart boundary");
  }
  return match[1];
}

function readRequestBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new AttachValidationError("Request body too large", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
}

function indexOfBuffer(haystack: Buffer, needle: Buffer, from: number): number {
  return haystack.indexOf(needle, from);
}

function parseHeaders(headerBlock: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[name] = value;
  }
  return headers;
}

function parseContentDisposition(value: string): { name?: string; filename?: string } {
  const result: { name?: string; filename?: string } = {};
  // content-disposition: form-data; name="files"; filename="a.png"
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith("\"") && val.endsWith("\"")) val = val.slice(1, -1);
    if (key === "name") result.name = val;
    else if (key === "filename") result.filename = val;
  }
  return result;
}

/**
 * Parse a multipart/form-data body. Throws AttachValidationError on any
 * per-file cap breach or structural failure. Callers should rely on this
 * to enforce both MIME and size invariants before any upload happens.
 */
export function parseMultipart(body: Buffer, boundary: string): ParsedForm {
  const delimiter = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from("\r\n");
  const closeDelimiter = Buffer.from(`--${boundary}--`);

  // Find start of first part
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) {
    throw new AttachValidationError("Malformed multipart body: no boundary found");
  }

  const fields: Record<string, string> = {};
  const files: ParsedFile[] = [];

  while (true) {
    // Either we are at a boundary or closing-boundary. Advance past it.
    if (body.slice(cursor, cursor + closeDelimiter.length).equals(closeDelimiter)) {
      // Final boundary — done.
      return { fields, files };
    }
    // Skip "--boundary\r\n"
    cursor += delimiter.length;
    // Tolerate either CRLF or LF after the boundary line.
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;
    else if (body[cursor] === 0x0a) cursor += 1;
    else {
      // Could be the immediate trailing "--" of the final boundary
      if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) {
        return { fields, files };
      }
      throw new AttachValidationError("Malformed multipart body: expected CRLF after boundary");
    }

    // Find header/body separator (blank line).
    const headerEnd = indexOfBuffer(body, Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0) {
      throw new AttachValidationError("Malformed multipart body: unterminated headers");
    }
    const rawHeaders = body.slice(cursor, headerEnd).toString("utf-8");
    const headers = parseHeaders(rawHeaders);
    const disposition = parseContentDisposition(headers["content-disposition"] ?? "");
    if (!disposition.name) {
      throw new AttachValidationError("Malformed multipart body: part missing name");
    }
    const contentType = headers["content-type"] ?? "text/plain";

    // Payload starts after the blank line.
    const payloadStart = headerEnd + 4;
    // Find next boundary marker in the body.
    const nextBoundary = indexOfBuffer(body, delimiter, payloadStart);
    if (nextBoundary < 0) {
      throw new AttachValidationError("Malformed multipart body: unterminated part");
    }
    // Payload ends 2 bytes before the boundary (the trailing CRLF between
    // payload and boundary). Tolerate bare LF too.
    let payloadEnd = nextBoundary;
    if (payloadEnd >= 2 && body[payloadEnd - 2] === 0x0d && body[payloadEnd - 1] === 0x0a) {
      payloadEnd -= 2;
    } else if (payloadEnd >= 1 && body[payloadEnd - 1] === 0x0a) {
      payloadEnd -= 1;
    }
    const payload = body.slice(payloadStart, payloadEnd);

    if (disposition.filename !== undefined) {
      // File part. Size check happens here — the global readRequestBuffer
      // cap is an outer safety net, but a single-file cap is the product
      // requirement from the AC list.
      if (payload.length > MAX_FILE_SIZE_BYTES) {
        throw new AttachValidationError(
          `File too large: ${disposition.filename}. Maximum: ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
          413,
        );
      }
      files.push({
        field: disposition.name,
        filename: disposition.filename,
        mimeType: contentType,
        data: Buffer.from(payload),
      });
    } else {
      fields[disposition.name] = payload.toString("utf-8");
    }

    cursor = nextBoundary;
  }
}

// ---------------------------------------------------------------------------
// File-list validation — runs BEFORE any Supabase call so we never waste a
// network round-trip on a request we're about to reject.
// ---------------------------------------------------------------------------

export function validateFiles(files: ParsedFile[]): void {
  if (files.length === 0) {
    throw new AttachValidationError("No files provided");
  }
  if (files.length > MAX_FILES) {
    throw new AttachValidationError(`Maximum ${MAX_FILES} files per request`);
  }
  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
      throw new AttachValidationError(
        `Invalid file type: ${file.filename}. Allowed: JPG, PNG, WebP, GIF`,
        415,
      );
    }
    if (file.data.length > MAX_FILE_SIZE_BYTES) {
      // Redundant with the per-part check in parseMultipart, but defensive
      // against a future parser that doesn't enforce it.
      throw new AttachValidationError(
        `File too large: ${file.filename}. Maximum: ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
        413,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase Storage upload — the Engine's `supabase-rest.ts` helper only
// covers PostgREST. Storage is a different REST surface
// (`/storage/v1/object/<bucket>/<path>`) so we call it directly here.
// ---------------------------------------------------------------------------

export interface StorageConfig {
  url: string;
  serviceKey: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface UploadedFile {
  url: string;
  name: string;
  type: string;
}

function getStorageConfig(override?: Partial<StorageConfig>): StorageConfig {
  const url = override?.url ?? process.env.SUPABASE_URL;
  const serviceKey = override?.serviceKey ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new AttachUploadError("Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)", 500);
  }
  return { url, serviceKey, fetchFn: override?.fetchFn };
}

function extensionFromFilename(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "jpg";
  const ext = name.slice(idx + 1).toLowerCase();
  // Strip anything that isn't safe for a storage key.
  return ext.replace(/[^a-z0-9]/g, "") || "jpg";
}

function buildStoragePath(workspaceId: string, folder: string, filename: string): string {
  const ext = extensionFromFilename(filename);
  return `${workspaceId}/${folder}/${randomUUID()}.${ext}`;
}

/**
 * Upload a single file to Supabase Storage and return its public URL.
 * Exported mainly so tests can hit the HTTP contract directly without
 * exercising the whole handler.
 */
export async function uploadOne(
  file: ParsedFile,
  workspaceId: string,
  folder: string,
  cfg: StorageConfig,
): Promise<UploadedFile> {
  const fetchFn = cfg.fetchFn ?? fetch;
  const path = buildStoragePath(workspaceId, folder, file.filename);
  const uploadUrl = `${cfg.url}/storage/v1/object/${BUCKET}/${path}`;

  const uploadRes = await fetchFn(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.serviceKey}`,
      apikey: cfg.serviceKey,
      "Content-Type": file.mimeType,
      "x-upsert": "false",
    },
    body: new Uint8Array(file.data),
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    logger.error(
      { bucket: BUCKET, path, status: uploadRes.status, body: text.slice(0, 200) },
      "sidekick-attach: storage upload failed",
    );
    throw new AttachUploadError(`Failed to upload ${file.filename}`);
  }

  // Supabase exposes public URLs at /storage/v1/object/public/<bucket>/<path>.
  // We build the URL rather than calling a second "get public URL" endpoint
  // because the result is a deterministic function of (url, bucket, path).
  const publicUrl = `${cfg.url}/storage/v1/object/public/${BUCKET}/${path}`;

  return {
    url: publicUrl,
    name: file.filename,
    type: file.mimeType,
  };
}

// ---------------------------------------------------------------------------
// Top-level handler entry point — parse, validate, upload, return.
// ---------------------------------------------------------------------------

export interface HandleAttachOptions {
  /** Injected for tests. */
  storage?: Partial<StorageConfig>;
}

export interface HandleAttachResult {
  files: UploadedFile[];
}

/**
 * Parse the request body, validate files, and upload each one to the
 * `ticket-attachments` bucket. Returns the uploaded URL list in the same
 * shape the Board widget expects today.
 *
 * Failure semantics:
 *   - Malformed body / too many files / wrong MIME → AttachValidationError
 *   - Per-file > 5 MB → AttachValidationError with status 413
 *   - Storage 4xx/5xx → AttachUploadError (502)
 *
 * The caller (HTTP route) maps these to JSON responses.
 */
export async function handleAttach(
  req: IncomingMessage,
  opts: HandleAttachOptions = {},
): Promise<HandleAttachResult> {
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    throw new AttachValidationError("Content-Type must be multipart/form-data");
  }
  const boundary = extractBoundary(req.headers["content-type"] ?? "");

  const body = await readRequestBuffer(req, MAX_TOTAL_REQUEST_BYTES);
  const form = parseMultipart(body, boundary);

  // Board upload route expects a `files` field for each file. Terminal
  // Sidekick will mirror this. We accept any field name for flexibility but
  // require at least one file part.
  validateFiles(form.files);

  // `project_id` is required so we can scope the storage folder (matches
  // Board behavior — keeps uploads scoped per project for easier cleanup
  // and RLS audits). Must be a UUID so we can't be tricked into using a
  // malformed identifier elsewhere in the pipeline.
  const projectId = form.fields["project_id"]?.trim();
  if (!projectId) {
    throw new AttachValidationError("project_id required");
  }
  if (!isUuid(projectId)) {
    throw new AttachValidationError("project_id must be a UUID");
  }
  // `workspace_id` is required because the storage path format
  // `{workspace_id}/{folder}/{file}` is how the Board widget + RLS policies
  // find the attachment. It is interpolated directly into the storage
  // object key, so we MUST reject anything that isn't a canonical UUID —
  // otherwise a caller with a valid X-Pipeline-Key could pass
  // `workspace_id=../other-workspace` and write into another tenant's
  // namespace (path traversal via the storage URL).
  const workspaceId = form.fields["workspace_id"]?.trim();
  if (!workspaceId) {
    throw new AttachValidationError("workspace_id required");
  }
  if (!isUuid(workspaceId)) {
    throw new AttachValidationError("workspace_id must be a UUID");
  }
  // `conversation_id` is optional — used as subfolder for easier cleanup
  // later; falls back to "pending" (same rule as the Board upload route).
  // When present it must be a UUID for the same path-traversal reason as
  // above; a malformed value falls back to the safe literal "pending"
  // rather than propagating attacker-controlled strings into the path.
  const rawConversationId = form.fields["conversation_id"]?.trim();
  if (rawConversationId && !isUuid(rawConversationId)) {
    throw new AttachValidationError("conversation_id must be a UUID");
  }
  const folder = rawConversationId || "pending";

  const storage = getStorageConfig(opts.storage);
  const uploaded: UploadedFile[] = [];
  for (const file of form.files) {
    const result = await uploadOne(file, workspaceId, folder, storage);
    uploaded.push(result);
  }

  return { files: uploaded };
}
