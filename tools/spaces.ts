import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleChatClient, handleApiError } from "../services/chatClient.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { ResponseFormat, type ListSpacesResponse, type ChatSpace } from "../types.js";

const ListSpacesInputSchema = z
  .object({
    page_size: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of spaces to return (1-100, default 50)."),
    page_token: z
      .string()
      .optional()
      .describe("Token from a previous call's next_page_token, used to fetch the next page."),
    filter: z
      .string()
      .optional()
      .describe(
        'Optional filter, e.g. \'space_type = "SPACE"\' or \'space_type = "GROUP_CHAT" OR space_type = "DIRECT_MESSAGE"\'. See Google Chat API ListSpaces filter syntax.'
      ),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable."),
  })
  .strict();

type ListSpacesInput = z.infer<typeof ListSpacesInputSchema>;

const CreateSpaceInputSchema = z
  .object({
    display_name: z.string().min(1).max(128).describe("Name shown for the new space, e.g. \"IA R&D\"."),
    space_type: z
      .enum(["SPACE", "GROUP_CHAT"])
      .default("SPACE")
      .describe(
        'Type of conversation to create. "SPACE" is a named room (recommended for teams/topics). "GROUP_CHAT" is an unnamed group DM. Direct messages (1:1) cannot be created via this tool.'
      ),
    description: z.string().max(150).optional().describe("Optional short description of the space's purpose."),
    member_emails: z
      .array(z.string().email())
      .max(50)
      .optional()
      .describe("Optional list of email addresses to invite as members immediately after creating the space."),
  })
  .strict();

type CreateSpaceInput = z.infer<typeof CreateSpaceInputSchema>;

export function registerSpaceTools(server: McpServer, client: GoogleChatClient): void {
  server.registerTool(
    "google_chat_list_spaces",
    {
      title: "List Google Chat Spaces",
      description: `List the Google Chat spaces (rooms, group chats, and direct messages) that the authenticated user is a member of.

Does NOT return messages - use google_chat_list_messages for that once you have a space name.

Args:
  - page_size (number): Max spaces to return, 1-100 (default 50)
  - page_token (string, optional): Pagination token from a previous response
  - filter (string, optional): Google Chat filter expression, e.g. 'space_type = "SPACE"'
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "count": number,
    "spaces": [
      { "name": "spaces/AAAA...", "displayName": string, "spaceType": string }
    ],
    "next_page_token": string | undefined
  }

Examples:
  - Use when: "What Google Chat spaces am I in?" -> no params needed
  - Use when: "List my direct messages" -> filter='space_type = "DIRECT_MESSAGE"'
  - Don't use when: You already know the space name and want its messages (use google_chat_list_messages)`,
      inputSchema: ListSpacesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListSpacesInput) => {
      try {
        const data = await client.request<ListSpacesResponse>("GET", "spaces", {
          params: {
            pageSize: params.page_size,
            pageToken: params.page_token,
            filter: params.filter,
          },
        });

        const spaces: ChatSpace[] = data.spaces ?? [];
        if (!spaces.length) {
          return { content: [{ type: "text", text: "No spaces found for the authenticated user." }] };
        }

        const output = {
          count: spaces.length,
          spaces: spaces.map((s) => ({
            name: s.name,
            displayName: s.displayName ?? "(direct message)",
            spaceType: s.spaceType ?? s.type,
          })),
          next_page_token: data.nextPageToken,
        };

        let text: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          const lines = [`# Google Chat Spaces (${spaces.length})`, ""];
          for (const s of spaces) {
            lines.push(`- **${s.displayName ?? "(direct message)"}** (\`${s.name}\`) — ${s.spaceType ?? s.type ?? "UNKNOWN"}`);
          }
          if (data.nextPageToken) {
            lines.push("", `_More results available. Pass page_token="${data.nextPageToken}" to continue._`);
          }
          text = lines.join("\n");
        } else {
          text = JSON.stringify(output, null, 2);
        }

        if (text.length > CHARACTER_LIMIT) {
          text = text.slice(0, CHARACTER_LIMIT) + "\n\n[Truncated - narrow with filter or page_size]";
        }

        return { content: [{ type: "text", text }], structuredContent: output };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_create_space",
    {
      title: "Create Google Chat Space",
      description: `Create a new Google Chat space (named room) or group chat, optionally inviting members immediately.

Args:
  - display_name (string): Name for the new space, e.g. "IA R&D"
  - space_type ('SPACE' | 'GROUP_CHAT'): 'SPACE' for a named room (default, recommended), 'GROUP_CHAT' for an unnamed group DM
  - description (string, optional): Short description of the space's purpose (max 150 chars)
  - member_emails (string[], optional): Email addresses to invite as members right after creation

Returns: The created space's resource name, and per-email invite results if member_emails was provided.

Examples:
  - Use when: "Create a Google Chat space called 'IA R&D' and add alice@acme.com and bob@acme.com" -> display_name="IA R&D", member_emails=["alice@acme.com","bob@acme.com"]
  - Don't use when: You want to add members to an ALREADY EXISTING space (use google_chat_add_member instead)

Error Handling:
  - Returns "Error: Permission denied" if the authenticated user's OAuth token lacks the chat.spaces.create scope`,
      inputSchema: CreateSpaceInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateSpaceInput) => {
      try {
        const space = await client.request<ChatSpace>("POST", "spaces", {
          data: {
            spaceType: params.space_type,
            displayName: params.display_name,
            ...(params.description ? { spaceDetails: { description: params.description } } : {}),
          },
        });

        const inviteResults: { email: string; ok: boolean; error?: string }[] = [];
        if (params.member_emails?.length && space.name) {
          for (const email of params.member_emails) {
            try {
              await client.request("POST", `${space.name}/members`, {
                data: { member: { name: `users/${email}`, type: "HUMAN" } },
              });
              inviteResults.push({ email, ok: true });
            } catch (error) {
              inviteResults.push({ email, ok: false, error: handleApiError(error) });
            }
          }
        }

        const output = { name: space.name, displayName: space.displayName, spaceType: space.spaceType, invited: inviteResults };

        const lines = [`Space created: **${params.display_name}** (\`${space.name}\`)`];
        if (inviteResults.length) {
          lines.push("", "Invite results:");
          for (const r of inviteResults) lines.push(`- ${r.email}: ${r.ok ? "invited" : `failed - ${r.error}`}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
