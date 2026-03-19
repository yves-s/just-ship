export const runtime = "edge";

export function GET(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  const isCli = /curl|wget|fetch/i.test(ua);

  if (isCli) {
    return Response.redirect(
      "https://raw.githubusercontent.com/yves-s/just-ship/main/install.sh",
      302
    );
  }

  return Response.redirect("https://just-ship.io/#quick-start", 302);
}
