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
    space_type: z
      .enum(["SPACE", "GROUP_CHAT", "DIRECT_MESSAGE"])
      .default("SPACE")
      .describe(
        'Type of conversation to create. "SPACE" is a named room (recommended for teams/topics, requires display_name). "GROUP_CHAT" is an unnamed group conversation with 2+ members. "DIRECT_MESSAGE" is a 1:1 message with exactly one other person (provide exactly one email in member_emails, no display_name).'
      ),
    display_name: z
      .string()
      .max(128)
      .optional()
      .describe('Name shown for the new space, e.g. "IA R&D". Required when space_type is "SPACE", ignored otherwise.'),
    description: z.string().max(150).optional().describe("Optional short description of the space's purpose (SPACE only)."),
    member_emails: z
      .array(z.string().email())
      .max(50)
      .optional()
      .describe(
        "Email addresses to add as members at creation time. Required (exactly one) for DIRECT_MESSAGE, required (at least one) for GROUP_CHAT, optional for SPACE."
      ),
  })
  .strict();

type CreateSpaceInput = z.infer<typeof CreateSpaceInputSchema>;

interface SetupSpaceResponse extends ChatSpace {
  name: string;
}

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
      description: `Create a new Google Chat conversation - a named space (room), a group chat, or a 1:1 direct message - with its initial members added atomically in the same call.

Uses the Chat API's spaces.setup method (not plain space creation), which is what supports creating direct messages and adding members at creation time in one step.

Args:
  - space_type ('SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE'): Type of conversation (default 'SPACE')
  - display_name (string): Required for 'SPACE', ignored for the other two types
  - description (string, optional): Short description (SPACE only, max 150 chars)
  - member_emails (string[]): Exactly one email for DIRECT_MESSAGE, one or more for GROUP_CHAT, zero or more for SPACE. The authenticated user is added automatically and should NOT be included.

Returns: The created (or, for an existing DIRECT_MESSAGE with that person, the already-existing) space's resource name.

Examples:
  - Use when: "Send Alexandre a direct message" -> space_type="DIRECT_MESSAGE", member_emails=["alexandre@acme.com"], then google_chat_send_message on the returned space name
  - Use when: "Create a Google Chat space called 'IA R&D' and add alice@acme.com and bob@acme.com" -> space_type="SPACE", display_name="IA R&D", member_emails=["alice@acme.com","bob@acme.com"]
  - Don't use when: You want to add members to an ALREADY EXISTING space (use google_chat_add_member instead)

Error Handling:
  - Returns "Error: Invalid request" if display_name is missing for space_type="SPACE", or member_emails doesn't have exactly one entry for "DIRECT_MESSAGE"
  - Returns "Error: Permission denied" if the authenticated user's OAuth token lacks the chat.spaces.create scope
  - If a DIRECT_MESSAGE already exists with that person, the API returns the existing space instead of creating a duplicate`,
      inputSchema: CreateSpaceInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: CreateSpaceInput) => {
      try {
        if (params.space_type === "SPACE" && !params.display_name) {
          return { content: [{ type: "text", text: "Error: display_name is required when space_type is 'SPACE'." }] };
        }
        if (params.space_type === "DIRECT_MESSAGE" && (params.member_emails?.length ?? 0) !== 1) {
          return {
            content: [{ type: "text", text: "Error: DIRECT_MESSAGE requires exactly one email in member_emails." }],
          };
        }
        if (params.space_type === "GROUP_CHAT" && !(params.member_emails?.length ?? 0)) {
          return {
            content: [{ type: "text", text: "Error: GROUP_CHAT requires at least one email in member_emails." }],
          };
        }

        const memberships = (params.member_emails ?? []).map((email) => ({
          member: { name: `users/${email}`, type: "HUMAN" },
        }));

        const space = await client.request<SetupSpaceResponse>("POST", "spaces:setup", {
          data: {
            space: {
              spaceType: params.space_type,
              ...(params.space_type === "SPACE" ? { displayName: params.display_name } : {}),
              ...(params.description ? { spaceDetails: { description: params.description } } : {}),
            },
            memberships,
          },
        });

        const output = { name: space.name, displayName: space.displayName, spaceType: space.spaceType };
        const label = params.space_type === "SPACE" ? `**${params.display_name}**` : params.space_type;
        return {
          content: [{ type: "text", text: `Space ready: ${label} (\`${space.name}\`).` }],
          structuredContent: output,
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
