import { NextRequest } from "next/server";

const DEFAULT_SERVER_API_BASE_URL = "http://mod-contabilidade:4003";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function getTargetBaseUrl() {
  return process.env.SERVER_API_BASE_URL || DEFAULT_SERVER_API_BASE_URL;
}

async function proxyRequest(request: NextRequest, pathParts: string[]) {
  const targetUrl = new URL(`/api/${pathParts.join("/")}${request.nextUrl.search}`, getTargetBaseUrl());
  const headers = new Headers(request.headers);
  for (const header of Array.from(HOP_BY_HOP_HEADERS)) {
    headers.delete(header);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstreamResponse = await fetch(targetUrl, init);
  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const header of Array.from(HOP_BY_HOP_HEADERS)) {
    responseHeaders.delete(header);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}
