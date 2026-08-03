/**
 * Deno Deploy entry point for the Google Chat MCP server.
 *
 * Uses the MCP SDK's Web-Standards Streamable HTTP transport (Request/Response,
 * not Node's http module), so it runs natively on Deno's Fetch-based Deno.serve
 * with no Node compatibility shims needed.
 *
 * Deploy: `deno deploy` (or via the Deno Deploy dashboard/GitHub integration),
 * or run locally with `deno task start`.
 *
 * Required environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REFRESH_TOKEN. See ../README.md for how to obtain them.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { GoogleAuthService } from "./services/auth.js";
import { GoogleChatClient } from "./services/chatClient.js";
import { registerSpaceTools } from "./tools/spaces.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerMemberTools } from "./tools/members.js";
import { registerReactionTools } from "./tools/reactions.js";
import { registerReadStateTools } from "./tools/readState.js";

function checkEnv(): void {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"].filter(
    (key) => !Deno.env.get(key)
  );
  if (missing.length) {
    console.error(`ERROR: Missing required environment variable(s): ${missing.join(", ")}`);
    console.error("See README.md for how to obtain a Google OAuth2 client ID/secret and refresh token.");
    Deno.exit(1);
  }
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "google-chat-mcp-server", version: "1.0.0" });
  const auth = new GoogleAuthService();
  const client = new GoogleChatClient(auth);

  registerSpaceTools(server, client);
  registerMessageTools(server, client);
  registerMemberTools(server, client);
  registerReactionTools(server, client);
  registerReadStateTools(server, client);

  return server;
}

checkEnv();

Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000") }, async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.pathname === "/healthz") {
    return new Response("ok", { status: 200 });
  }

  if (url.pathname !== "/mcp") {
    return new Response("Not found", { status: 404 });
  }

  // Stateless: build a fresh server + transport per request, mirroring the
  // Node/Express entry point's approach so behavior is identical across hosts.
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(req);
  return response;
});

console.error("Google Chat MCP server running (Deno) - listening on /mcp");
