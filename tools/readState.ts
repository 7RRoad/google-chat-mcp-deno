import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleChatClient, handleApiError } from "../services/chatClient.js";
import type { ChatMessage } from "../types.js";

const SPACE_NAME_DESC = 'Space resource name, e.g. "spaces/AAAAxxxxxxx" (as returned by google_chat_list_spaces).';

function readStateName(spaceName: string): string {
  return `users/me/${spaceName}/spaceReadState`;
}

interface SpaceReadState {
  name?: string;
  lastReadTime?: string;
}

// ---------------------------------------------------------------------------
// google_chat_get_read_state
// ---------------------------------------------------------------------------

const GetReadStateInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
  })
  .strict();

type GetReadStateInput = z.infer<typeof GetReadStateInputSchema>;

// ---------------------------------------------------------------------------
// google_chat_mark_read_state
// ---------------------------------------------------------------------------

const MarkReadStateInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
    message_name: z
      .string()
      .optional()
      .describe(
        'Optional full message resource name, e.g. "spaces/AAAA/messages/BBBB". If provided, only this message (and, when marking read, everything before it) is affected instead of the whole space.'
      ),
    unread: z
      .boolean()
      .default(false)
      .describe(
        "false (default): mark as read. If message_name is set, marks that message and everything before it as read (whole space if omitted, i.e. \"mark all as read\"). true: mark as unread - requires message_name, marks that message and everything after it as unread."
      ),
  })
  .strict();

type MarkReadStateInput = z.infer<typeof MarkReadStateInputSchema>;

export function registerReadStateTools(server: McpServer, client: GoogleChatClient): void {
  server.registerTool(
    "google_chat_get_read_state",
    {
      title: "Get Google Chat Space Read State",
      description: `Get the authenticated user's read state for a Google Chat space - the timestamp of the last message they've read.

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"

Returns: { "lastReadTime": string (RFC3339 timestamp) }. Compare this against a message's createTime (from google_chat_list_messages) to determine if that message is read (createTime <= lastReadTime) or unread (createTime > lastReadTime).

Examples:
  - Use when: "Do I have unread messages in the IA R&D space?" -> get read state, then list_messages and compare createTime`,
      inputSchema: GetReadStateInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetReadStateInput) => {
      try {
        const state = await client.request<SpaceReadState>("GET", readStateName(params.space_name));
        return {
          content: [
            { type: "text", text: `Last read time for ${params.space_name}: ${state.lastReadTime ?? "(never read)"}` },
          ],
          structuredContent: { lastReadTime: state.lastReadTime },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_mark_read_state",
    {
      title: "Mark Google Chat Space/Message as Read or Unread",
      description: `Mark a Google Chat space as read, or mark a specific message (and everything before/after it) as read or unread.

The Chat API tracks read state per-space via a single "last read" timestamp, not a per-message flag, so:
  - Mark the WHOLE space as read: omit message_name, unread=false (default)
  - Mark UP TO a specific message as read: set message_name, unread=false
  - Mark a specific message (and anything after it) as UNREAD: set message_name, unread=true

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"
  - message_name (string, optional): Full message resource name to anchor the read/unread boundary on
  - unread (boolean): false (default) to mark read, true to mark unread (requires message_name)

Returns: The new lastReadTime.

Examples:
  - Use when: "Mark the IA R&D space as read" -> space_name only
  - Use when: "Mark this message as unread so I remember to reply" -> message_name set, unread=true
  - Don't use when: You want to react or reply instead (use google_chat_add_reaction / google_chat_send_message)

Error Handling:
  - Returns "Error: Resource not found" if message_name doesn't exist or belongs to a different space`,
      inputSchema: MarkReadStateInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: MarkReadStateInput) => {
      try {
        if (params.unread && !params.message_name) {
          return {
            content: [
              { type: "text", text: "Error: message_name is required when unread=true (marking the whole space unread isn't supported by the Chat API)." },
            ],
          };
        }

        let lastReadTime: string;

        if (params.message_name) {
          const message = await client.request<ChatMessage>("GET", params.message_name);
          if (!message.createTime) {
            return { content: [{ type: "text", text: "Error: Could not determine the target message's creation time." }] };
          }
          if (params.unread) {
            // Set lastReadTime to just before this message so it (and anything after) counts as unread.
            const t = new Date(message.createTime).getTime() - 1;
            lastReadTime = new Date(t).toISOString();
          } else {
            lastReadTime = message.createTime;
          }
        } else {
          lastReadTime = new Date().toISOString();
        }

        const updated = await client.request<SpaceReadState>("PATCH", readStateName(params.space_name), {
          params: { updateMask: "lastReadTime" },
          data: { lastReadTime },
        });

        return {
          content: [
            {
              type: "text",
              text: `${params.space_name} marked as ${params.unread ? "unread from" : "read up to"} ${lastReadTime}.`,
            },
          ],
          structuredContent: { lastReadTime: updated.lastReadTime ?? lastReadTime },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
