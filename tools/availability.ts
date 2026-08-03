import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleChatClient, handleApiError } from "../services/chatClient.js";

interface Availability {
  status?: string; // AVAILABLE, AWAY, DO_NOT_DISTURB, etc.
}

export function registerAvailabilityTools(server: McpServer, client: GoogleChatClient): void {
  server.registerTool(
    "google_chat_get_availability",
    {
      title: "Get Google Chat Availability Status",
      description: `Get the authenticated user's current Google Chat availability/presence status.

Returns: { "status": "AVAILABLE" | "AWAY" | "DO_NOT_DISTURB" | ... }

Examples:
  - Use when: "Am I set to do not disturb right now?"`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const availability = await client.request<Availability>("GET", "users/me/availability");
        return {
          content: [{ type: "text", text: `Current status: ${availability.status ?? "UNKNOWN"}` }],
          structuredContent: { status: availability.status },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_set_availability",
    {
      title: "Set Google Chat Availability Status",
      description: `Set the authenticated user's Google Chat availability/presence status.

Args:
  - status ('ACTIVE' | 'AWAY' | 'DO_NOT_DISTURB'): 'ACTIVE' marks the user as active/available, 'AWAY' marks them as away, 'DO_NOT_DISTURB' silences notifications

Returns: Confirmation of the new status.

Examples:
  - Use when: "Set my Chat status to do not disturb" -> status="DO_NOT_DISTURB"
  - Use when: "Mark me as active in Chat" -> status="ACTIVE"

Error Handling:
  - Returns "Error: Permission denied" if the OAuth token lacks the required chat.users.availability scope (not requested by default - only add if this tool is needed)`,
      inputSchema: z.object({ status: z.enum(["ACTIVE", "AWAY", "DO_NOT_DISTURB"]).describe("The new availability status.") }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: { status: "ACTIVE" | "AWAY" | "DO_NOT_DISTURB" }) => {
      try {
        const methodByStatus: Record<string, string> = {
          ACTIVE: "users/me/availability:markAsActive",
          AWAY: "users/me/availability:markAsAway",
          DO_NOT_DISTURB: "users/me/availability:markAsDoNotDisturb",
        };
        await client.request("POST", methodByStatus[params.status]);
        return {
          content: [{ type: "text", text: `Availability set to ${params.status}.` }],
          structuredContent: { status: params.status },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
