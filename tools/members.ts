import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleChatClient, handleApiError } from "../services/chatClient.js";
import { ResponseFormat, type ListMembershipsResponse, type ChatMembership } from "../types.js";

const SPACE_NAME_DESC = 'Space resource name, e.g. "spaces/AAAAxxxxxxx" (as returned by google_chat_list_spaces or google_chat_create_space).';

// ---------------------------------------------------------------------------
// google_chat_list_members
// ---------------------------------------------------------------------------

const ListMembersInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
    page_size: z.number().int().min(1).max(100).default(50).describe("Max members to return (1-100, default 50)."),
    page_token: z.string().optional().describe("Token from a previous response's next_page_token."),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Output format."),
  })
  .strict();

type ListMembersInput = z.infer<typeof ListMembersInputSchema>;

// ---------------------------------------------------------------------------
// google_chat_add_member
// ---------------------------------------------------------------------------

const AddMemberInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
    email: z.string().email().describe("Email address of the person to invite/add to the space."),
    role: z
      .enum(["ROLE_MEMBER", "ROLE_MANAGER"])
      .default("ROLE_MEMBER")
      .describe("Role to grant: 'ROLE_MEMBER' (default) or 'ROLE_MANAGER' (space manager, only valid for SPACE type)."),
  })
  .strict();

type AddMemberInput = z.infer<typeof AddMemberInputSchema>;

// ---------------------------------------------------------------------------
// google_chat_remove_member
// ---------------------------------------------------------------------------

const RemoveMemberInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
    email: z
      .string()
      .email()
      .optional()
      .describe("Email address of the member to remove. Provide this OR membership_name, not both."),
    membership_name: z
      .string()
      .optional()
      .describe('Full membership resource name, e.g. "spaces/AAAA/members/BBBB" (from google_chat_list_members). Provide this OR email, not both.'),
  })
  .strict();

type RemoveMemberInput = z.infer<typeof RemoveMemberInputSchema>;

export function registerMemberTools(server: McpServer, client: GoogleChatClient): void {
  server.registerTool(
    "google_chat_list_members",
    {
      title: "List Google Chat Space Members",
      description: `List the members of a Google Chat space, including their role and join state.

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"
  - page_size (number): Max members to return, 1-100 (default 50)
  - page_token (string, optional): Pagination token from a previous response
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "count": number,
    "members": [ { "membershipName": string, "displayName": string, "role": string, "state": string } ],
    "next_page_token": string | undefined
  }

Examples:
  - Use when: "Who is in the IA R&D space?" -> space_name from google_chat_list_spaces
  - Use when: You need a membership_name before calling google_chat_remove_member`,
      inputSchema: ListMembersInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListMembersInput) => {
      try {
        const data = await client.request<ListMembershipsResponse>("GET", `${params.space_name}/members`, {
          params: { pageSize: params.page_size, pageToken: params.page_token },
        });
        const members: ChatMembership[] = data.memberships ?? [];
        if (!members.length) {
          return { content: [{ type: "text", text: `No members found in ${params.space_name}.` }] };
        }
        const output = {
          count: members.length,
          members: members.map((m) => ({
            membershipName: m.name,
            displayName: m.member?.displayName ?? m.member?.name,
            role: m.role,
            state: m.state,
          })),
          next_page_token: data.nextPageToken,
        };
        let text: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          const lines = [`# Members of ${params.space_name} (${members.length})`, ""];
          for (const m of members) {
            lines.push(`- **${m.member?.displayName ?? m.member?.name}** — ${m.role ?? "ROLE_MEMBER"} (${m.state ?? "JOINED"}) [\`${m.name}\`]`);
          }
          if (data.nextPageToken) lines.push("", `_More results available. Pass page_token="${data.nextPageToken}" to continue._`);
          text = lines.join("\n");
        } else {
          text = JSON.stringify(output, null, 2);
        }
        return { content: [{ type: "text", text }], structuredContent: output };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_add_member",
    {
      title: "Add Member to Google Chat Space",
      description: `Invite/add a single person (by email) to an existing Google Chat space.

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"
  - email (string): Email address of the person to add
  - role ('ROLE_MEMBER' | 'ROLE_MANAGER'): Role to grant (default: 'ROLE_MEMBER')

Returns: The created membership's resource name and state (JOINED or INVITED).

Examples:
  - Use when: "Add bob@acme.com to the IA R&D space" -> space_name="spaces/...", email="bob@acme.com"
  - Don't use when: Creating a brand-new space with initial members (use google_chat_create_space with member_emails instead - one call, not N)

Error Handling:
  - Returns "Error: Invalid request" if the email is not a valid Workspace/Google account reachable by this space
  - Returns "Error: Permission denied" if the authenticated user isn't a manager/owner of the space`,
      inputSchema: AddMemberInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AddMemberInput) => {
      try {
        const membership = await client.request<ChatMembership>("POST", `${params.space_name}/members`, {
          data: { member: { name: `users/${params.email}`, type: "HUMAN" }, role: params.role },
        });
        const output = { membershipName: membership.name, state: membership.state, role: membership.role };
        return {
          content: [{ type: "text", text: `${params.email} added to ${params.space_name} (state: ${membership.state}).` }],
          structuredContent: output,
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_remove_member",
    {
      title: "Remove Member from Google Chat Space",
      description: `Remove a member from a Google Chat space, identified either by email or by membership resource name.

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"
  - email (string, optional): Email of the member to remove (looked up via google_chat_list_members internally)
  - membership_name (string, optional): Full membership resource name, e.g. "spaces/AAAA/members/BBBB"

Exactly one of email or membership_name must be provided.

Returns: Confirmation that the member was removed.

Examples:
  - Use when: "Remove bob@acme.com from the IA R&D space" -> space_name="spaces/...", email="bob@acme.com"
  - Don't use when: You want to leave/delete the space itself (not supported by this tool)

Error Handling:
  - Returns "Error: Resource not found" if the member/email is not currently in the space
  - Returns "Error: Permission denied" if the authenticated user isn't a manager/owner of the space`,
      inputSchema: RemoveMemberInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: RemoveMemberInput) => {
      try {
        if (Boolean(params.email) === Boolean(params.membership_name)) {
          return {
            content: [{ type: "text", text: "Error: Provide exactly one of 'email' or 'membership_name', not both or neither." }],
          };
        }
        let membershipName = params.membership_name;
        if (!membershipName && params.email) {
          membershipName = `${params.space_name}/members/${params.email}`;
        }
        await client.request("DELETE", membershipName as string);
        return {
          content: [{ type: "text", text: `Removed ${params.email ?? membershipName} from ${params.space_name}.` }],
          structuredContent: { removed: params.email ?? membershipName },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
