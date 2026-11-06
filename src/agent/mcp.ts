// The agent's tools as an MCP server (streamable HTTP, JSON replies) inside the app, for the agent to connect
// to: it needs no process of its own and reads the same messages the app shows. It listens on the loopback
// interface only, wants a random bearer token, and checks the Host header (so a web page can't reach it).
import { TOOLS, callTool, type ToolContext } from "./tools";

export const SERVER_NAME = "mantou-mail";

export interface MailMcp {
  url: string;
  token: string;
  stop: () => void;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function handle(ctx: ToolContext, msg: unknown): Json | undefined {
  if (!isRecord(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  const rpc = msg as Rpc;
  const reply = (result: Json): Json => ({ jsonrpc: "2.0", id: rpc.id ?? null, result });
  const fail = (code: number, message: string): Json => ({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code, message } });
  if (rpc.id === undefined) return undefined; // a notification: nothing to answer
  switch (rpc.method) {
    case "initialize": {
      const asked = isRecord(rpc.params) && typeof rpc.params.protocolVersion === "string" ? rpc.params.protocolVersion : "2025-03-26";
      return reply({ protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: "1" } });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input as unknown as Json })) });
    case "tools/call": {
      if (!isRecord(rpc.params) || typeof rpc.params.name !== "string") return fail(-32602, "name is required");
      const r = callTool(ctx, rpc.params.name, rpc.params.arguments ?? {});
      return reply({ content: [{ type: "text", text: r.text }], isError: !!r.isError });
    }
    default: return fail(-32601, `method not found: ${rpc.method}`);
  }
}

/** Starts the server on a free port. */
export function startMailMcp(ctx: ToolContext): MailMcp {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const host = req.headers.get("host") ?? "";
      if (host !== `127.0.0.1:${server.port}` && host !== `localhost:${server.port}`) return new Response("forbidden", { status: 403 });
      if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
      if (req.method !== "POST") return new Response("POST only", { status: 405 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
      }
      const out = Array.isArray(body) ? body.map((m) => handle(ctx, m)).filter((r): r is Json => r !== undefined) : handle(ctx, body);
      if (out === undefined || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202 });
      return Response.json(out);
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp`, token, stop: () => void server.stop(true) };
}
