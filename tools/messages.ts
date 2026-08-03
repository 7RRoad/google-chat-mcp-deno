import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleChatClient, handleApiError } from "../services/chatClient.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { ResponseFormat, type ListMessagesResponse, type ChatMessage } from "../types.js";

const SPACE_NAME_DESC = 'Space resource name, e.g. "spaces/AAAAxxxxxxx" (as returned by google_chat_list_spaces).';

function formatMessage(m: ChatMessage): string {
  const who = m.sender?.displayName ?? m.sender?.name ?? "Unknown";
  const when = m.createTime ?? "";
  const text = m.text ?? "(no text - may contain cards/attachments)";
  return `**${who}** (${when}) [\`${m.name}\`]\n${text}`;
}

// ---------------------------------------------------------------------------
// google_chat_list_messages
// ---------------------------------------------------------------------------

const ListMessagesInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
    page_size: z.number().int().min(1).max(100).default(25).describe("Max messages to return (1-100, default 25)."),
    page_token: z.string().optional().describe("Token from a previous response's next_page_token."),
    order_by: z
      .enum(["createTime desc", "createTime asc"])
      .default("createTime desc")
      .describe("Sort order. 'createTime desc' (default) returns the most recent messages first."),
    filter: z
      .string()
      .optional()
      .describe(
        'Optional filter, e.g. \'createTime > "2024-01-01T00:00:00-00:00"\' or \'thread.name = "spaces/AAA/threads/BBB"\'. See Google Chat API ListMessages filter syntax.'
      ),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Output format."),
  })
  .strict();

type ListMessagesInput = z.infer<typeof ListMessagesInputSchema>;

// ---------------------------------------------------------------------------
// google_chat_get_message
// ---------------------------------------------------------------------------

const GetMessageInputSchema = z
  .object({
    message_name: z
      .string()
      .min(1)
      .describe('Full message resource name, e.g. "spaces/AAAAxxxxxxx/messages/BBBByyyyyyy".'),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Output format."),
  })
  .strict();

type GetMessageInput = z.infer<typeof GetMessageInputSchema>;

// ---------------------------------------------------------------------------
// google_chat_search_messages
// ---------------------------------------------------------------------------

const SearchMessagesInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
    query: z.string().min(1).max(500).describe("Plain-text substring to search for within message text (case-insensitive, client-side match over fetched messages)."),
    max_messages_scanned: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(200)
      .describe("Max messages to scan from the space's recent history while searching (default 200)."),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Output format."),
  })
  .strict();

type SearchMessagesInput = z.infer<typeof SearchMessagesInputSchema>;

// ---------------------------------------------------------------------------
// google_chat_send_message
// ---------------------------------------------------------------------------

const SendMessageInputSchema = z
  .object({
    space_name: z.string().min(1).describe(SPACE_NAME_DESC),
    text: z.string().min(1).max(4096).describe("Plain-text (or basic Chat markup) message body to send."),
    thread_name: z
      .string()
      .optional()
      .describe('Optional thread resource name, e.g. "spaces/AAAA/threads/CCCC", to reply within an existing thread instead of starting a new one.'),
  })
  .strict();

type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export function registerMessageTools(server: McpServer, client: GoogleChatClient): void {
  server.registerTool(
    "google_chat_list_messages",
    {
      title: "List Google Chat Messages",
      description: `List recent messages posted in a Google Chat space.

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"
  - page_size (number): Max messages to return, 1-100 (default 25)
  - page_token (string, optional): Pagination token from a previous response
  - order_by ('createTime desc' | 'createTime asc'): Sort order (default: newest first)
  - filter (string, optional): Google Chat filter expression (time range, thread)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "count": number,
    "messages": [
      { "name": string, "sender": string, "createTime": string, "text": string, "thread": string | undefined }
    ],
    "next_page_token": string | undefined
  }

Examples:
  - Use when: "What was said in the #general space today?" -> filter='createTime > "<today ISO8601>"'
  - Use when: "Show me the last 10 messages in this space" -> page_size=10
  - Don't use when: You need a single specific message by ID (use google_chat_get_message)`,
      inputSchema: ListMessagesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListMessagesInput) => {
      try {
        const data = await client.request<ListMessagesResponse>(
          "GET",
          `${params.space_name}/messages`,
          {
            params: {
              pageSize: params.page_size,
              pageToken: params.page_token,
              orderBy: params.order_by,
              filter: params.filter,
            },
          }
        );

        const messages: ChatMessage[] = data.messages ?? [];
        if (!messages.length) {
          return { content: [{ type: "text", text: `No messages found in ${params.space_name}.` }] };
        }

        const output = {
          count: messages.length,
          messages: messages.map((m) => ({
            name: m.name,
            sender: m.sender?.displayName ?? m.sender?.name,
            createTime: m.createTime,
            text: m.text,
            thread: m.thread?.name,
          })),
          next_page_token: data.nextPageToken,
        };

        let text: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          const lines = [`# Messages in ${params.space_name} (${messages.length})`, ""];
          for (const m of messages) lines.push(formatMessage(m), "");
          if (data.nextPageToken) lines.push(`_More results available. Pass page_token="${data.nextPageToken}" to continue._`);
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
    "google_chat_get_message",
    {
      title: "Get Google Chat Message",
      description: `Fetch a single Google Chat message by its full resource name.

Args:
  - message_name (string): Full message resource name, e.g. "spaces/AAAA/messages/BBBB"
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: The message's sender, creation time, and text content.

Examples:
  - Use when: You have a message name from google_chat_list_messages and need its full content
  - Don't use when: You don't yet know which message you want (use google_chat_list_messages or google_chat_search_messages first)

Error Handling:
  - Returns "Error: Resource not found" if the message name is invalid or the message was deleted`,
      inputSchema: GetMessageInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetMessageInput) => {
      try {
        const m = await client.request<ChatMessage>("GET", params.message_name);
        const output = {
          name: m.name,
          sender: m.sender?.displayName ?? m.sender?.name,
          createTime: m.createTime,
          text: m.text,
          thread: m.thread?.name,
        };
        const text =
          params.response_format === ResponseFormat.MARKDOWN
            ? formatMessage(m)
            : JSON.stringify(output, null, 2);
        return { content: [{ type: "text", text }], structuredContent: output };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_search_messages",
    {
      title: "Search Google Chat Messages",
      description: `Search recent messages within a single Google Chat space for a text substring.

The Google Chat API has no full-text search endpoint, so this tool paginates through the space's recent message history (up to max_messages_scanned) and filters client-side for messages whose text contains the query (case-insensitive).

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"
  - query (string): Substring to search for in message text
  - max_messages_scanned (number): How many recent messages to scan, 1-1000 (default 200)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: Matching messages with sender, time, and text.

Examples:
  - Use when: "Did anyone mention 'deploy freeze' in this space recently?" -> query="deploy freeze"
  - Don't use when: You need to search across MULTIPLE spaces (call this tool once per space, or use google_chat_list_spaces first to enumerate spaces)

Error Handling:
  - Returns a message noting 0 matches (not an error) if nothing is found within the scanned window`,
      inputSchema: SearchMessagesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: SearchMessagesInput) => {
      try {
        const matches: ChatMessage[] = [];
        let scanned = 0;
        let pageToken: string | undefined;
        const needle = params.query.toLowerCase();

        do {
          const data = await client.request<ListMessagesResponse>(
            "GET",
            `${params.space_name}/messages`,
            {
              params: {
                pageSize: Math.min(100, params.max_messages_scanned - scanned),
                pageToken,
                orderBy: "createTime desc",
              },
            }
          );
          const batch = data.messages ?? [];
          scanned += batch.length;
          for (const m of batch) {
            if (m.text && m.text.toLowerCase().includes(needle)) matches.push(m);
          }
          pageToken = data.nextPageToken;
        } while (pageToken && scanned < params.max_messages_scanned);

        if (!matches.length) {
          return {
            content: [
              {
                type: "text",
                text: `No messages containing "${params.query}" found in ${params.space_name} (scanned ${scanned} messages).`,
              },
            ],
          };
        }

        const output = {
          query: params.query,
          scanned_count: scanned,
          match_count: matches.length,
          messages: matches.map((m) => ({
            name: m.name,
            sender: m.sender?.displayName ?? m.sender?.name,
            createTime: m.createTime,
            text: m.text,
          })),
        };

        let text: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          const lines = [
            `# Search results for "${params.query}" in ${params.space_name}`,
            `Found ${matches.length} match(es) out of ${scanned} messages scanned.`,
            "",
          ];
          for (const m of matches) lines.push(formatMessage(m), "");
          text = lines.join("\n");
        } else {
          text = JSON.stringify(output, null, 2);
        }

        if (text.length > CHARACTER_LIMIT) {
          text = text.slice(0, CHARACTER_LIMIT) + "\n\n[Truncated - narrow your query]";
        }

        return { content: [{ type: "text", text }], structuredContent: output };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_send_message",
    {
      title: "Send Google Chat Message",
      description: `Post a new text message to a Google Chat space, optionally as a reply within an existing thread.

Args:
  - space_name (string): Space resource name, e.g. "spaces/AAAAxxxxxxx"
  - text (string): Message body (plain text or basic Chat markup like *bold*, _italic_), max 4096 chars
  - thread_name (string, optional): Thread resource name to reply within, e.g. "spaces/AAAA/threads/CCCC". Omit to start a new thread.

Returns: The created message's resource name and creation time.

Examples:
  - Use when: "Post 'Deploy is done ✅' to the #incidents space" -> space_name="spaces/...", text="Deploy is done"
  - Use when: Replying to an existing conversation -> also pass thread_name
  - Don't use when: You just want to read messages (use google_chat_list_messages)

Error Handling:
  - Returns "Error: Permission denied" if the authenticated user/app is not a member of the space or lacks the chat.messages scope`,
      inputSchema: SendMessageInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: SendMessageInput) => {
      try {
        const body: Record<string, unknown> = { text: params.text };
        if (params.thread_name) {
          body.thread = { name: params.thread_name };
        }
        const created = await client.request<ChatMessage>(
          "POST",
          `${params.space_name}/messages`,
          {
            data: body,
            params: params.thread_name ? { messageReplyOption: "REPLY_MESSAGE_OR_FAIL" } : undefined,
          }
        );
        const output = { name: created.name, createTime: created.createTime, text: created.text };
        return {
          content: [{ type: "text", text: `Message sent: \`${created.name}\` at ${created.createTime}` }],
          structuredContent: output,
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
