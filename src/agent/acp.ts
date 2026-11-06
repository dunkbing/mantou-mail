// Running an agent over ACP (the Agent Client Protocol): the app is the client, an agent program (Claude through
// its ACP adapter, say) is the server, and the person's own login pays for it: there is no API key here.
//
// The agent gets the app's mail tools (an MCP server in this process) and nothing else: the session is asked to
// start with no built-in tools or settings, the client advertises no file or terminal access, and every
// permission request for anything but our tools is refused. A coding agent has a shell and the mail is written
// by strangers, so this is what keeps a hostile message from running anything.
import { PROTOCOL_VERSION, client, methods, ndJsonStream, type AgentApp, type NewSessionRequest, type PermissionOption, type SessionUpdate, type Stream, type ToolCallUpdate } from "@agentclientprotocol/sdk";
import { SERVER_NAME, startMailMcp } from "./mcp";
import { TOOLS, type ToolContext } from "./tools";

export interface AgentLaunch {
  command: string;
  args: string[];
}

/** Claude, through Zed's ACP adapter for the Claude Agent SDK (fetched by npx the first time; it uses the person's Claude login). */
export const CLAUDE: AgentLaunch = { command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@0.101.0"] };

export interface Activity {
  kind: "message" | "tool" | "denied";
  text: string;
}

export interface AgentRun {
  stopReason: string;
  /** What the agent said. */
  text: string;
  activity: Activity[];
  /** Tool calls that were refused (anything that isn't one of the mail tools). */
  denied: string[];
}

const OURS = new Set(TOOLS.map((t) => t.name));
const SAFE_KINDS = new Set<string | undefined>([undefined, "other", "read", "search"]);

/** Whether a tool call is one of the mail tools (by name, however the agent writes it) and nothing like a shell, edit or fetch. */
export function isMailTool(call: Pick<ToolCallUpdate, "title" | "kind" | "_meta">): boolean {
  if (!SAFE_KINDS.has(call.kind ?? undefined)) return false;
  const meta = call._meta as { claudeCode?: { toolName?: unknown } } | null | undefined;
  const names = [call.title, typeof meta?.claudeCode?.toolName === "string" ? meta.claudeCode.toolName : undefined];
  return names.some((n) => {
    if (!n) return false;
    const m = /^(?:mcp__mantou-mail__|mantou-mail[:/. _-]+)?([a-z_]+)$/.exec(n.trim());
    return !!m && OURS.has(m[1]);
  });
}

/** The option to answer a permission request with: allow once for our tools, else refuse (or cancel when there's no refusal on offer). */
export function answerPermission(call: ToolCallUpdate, options: PermissionOption[]): { outcome: "selected"; optionId: string } | { outcome: "cancelled" } {
  const want = isMailTool(call) ? "allow_once" : "reject_once";
  const o = options.find((x) => x.kind === want) ?? (want === "reject_once" ? options.find((x) => x.kind === "reject_always") : undefined);
  return o ? { outcome: "selected", optionId: o.optionId } : { outcome: "cancelled" };
}

/** Starts the agent program and speaks ACP over its stdin and stdout. */
export function spawnAgent(launch: AgentLaunch, cwd: string): { stream: Stream; kill: () => void } {
  const keep = ["PATH", "HOME", "USER", "TMPDIR", "LANG", "SHELL"];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && (keep.includes(k) || /^(ANTHROPIC_|CLAUDE_)/.test(k))) env[k] = v;
  const proc = Bun.spawn([launch.command, ...launch.args], { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      proc.stdin.write(chunk);
      proc.stdin.flush();
    },
    close() {
      proc.stdin.end();
    },
  });
  return { stream: ndJsonStream(writable, proc.stdout), kill: () => proc.kill() };
}

function describe(u: SessionUpdate): Activity | null {
  if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") return { kind: "message", text: u.content.text };
  if (u.sessionUpdate === "tool_call") return { kind: "tool", text: u.title };
  return null;
}

/**
 * One task for an agent: connect (to a spawned program, or in-process for tests), start a session with the mail
 * tools, send the prompt, and report what happened. Proposals the agent makes are recorded by `ctx.addProposal`.
 */
export async function runAgent(target: Stream | AgentApp, opts: { ctx: ToolContext; prompt: string; cwd: string; timeoutMs?: number }): Promise<AgentRun> {
  const mcp = startMailMcp(opts.ctx);
  const run: AgentRun = { stopReason: "", text: "", activity: [], denied: [] };
  const app = client({ name: "mantou-mail" })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const answer = answerPermission(params.toolCall, params.options);
      if (!isMailTool(params.toolCall)) {
        const what = params.toolCall.title ?? params.toolCall.toolCallId;
        run.denied.push(what);
        run.activity.push({ kind: "denied", text: what });
      }
      return { outcome: answer };
    })
    .onNotification(methods.client.session.update, ({ params }) => {
      const a = describe(params.update);
      if (!a) return;
      run.activity.push(a);
      if (a.kind === "message") run.text += a.text;
    });
  const session: NewSessionRequest = {
    cwd: opts.cwd,
    mcpServers: [{ type: "http", name: SERVER_NAME, url: mcp.url, headers: [{ name: "Authorization", value: `Bearer ${mcp.token}` }] }],
    // For the Claude adapter: no built-in tools (no shell, files or web) and none of the person's own settings.
    _meta: { claudeCode: { options: { tools: [], settingSources: [] } } },
  };
  const work = app.connectWith(target, async (cx) => {
    await cx.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: "mantou-mail", version: "1" } });
    await cx.buildSession(session).withSession(async (s) => {
      const r = await s.prompt(opts.prompt);
      run.stopReason = r.stopReason;
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("the agent took too long")), opts.timeoutMs ?? 300_000)))]);
    return run;
  } finally {
    clearTimeout(timer);
    mcp.stop();
  }
}
