import { NextResponse } from "next/server";
import { ZodError } from "zod";

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

export function success<T>(data: T, status = 200) {
  return NextResponse.json<ApiResponse<T>>(
    { data, error: null },
    { status }
  );
}

export function error(code: string, message: string, status = 400) {
  return NextResponse.json<ApiResponse<null>>(
    { data: null, error: { code, message } },
    { status }
  );
}

export function validationError(err: ZodError) {
  const message = err.issues.map((e) => e.message).join(", ");
  return error("VALIDATION_ERROR", message, 400);
}

export function unauthorized(message = "Unauthorized") {
  return error("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "Forbidden") {
  return error("FORBIDDEN", message, 403);
}

export function notFound(message = "Not found") {
  return error("NOT_FOUND", message, 404);
}
