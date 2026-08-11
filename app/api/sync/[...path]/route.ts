import type { NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const SYNC_INTERNAL_URL = (process.env.SYNC_INTERNAL_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

async function proxy(request: NextRequest, { params }: RouteContext) {
  const { path } = await params;
  const target = new URL(`${SYNC_INTERNAL_URL}/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;

  const upstream = await fetch(target, {
    method: request.method,
    headers: request.headers.has("content-type")
      ? { "content-type": request.headers.get("content-type") ?? "application/json" }
      : undefined,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}
