import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleChatClient, handleApiError } from "../services/chatClient.js";

const MESSAGE_NAME_DESC =
  'Full message resource name, e.g. "spaces/AAAAxxxxxxx/messages/BBBByyyyyyy" (from google_chat_list_messages or google_chat_search_messages).';

// ---------------------------------------------------------------------------
// google_chat_add_reaction
// ---------------------------------------------------------------------------

const AddReactionInputSchema = z
  .object({
    message_name: z.string().min(1).describe(MESSAGE_NAME_DESC),
    emoji: z
      .string()
      .min(1)
      .max(8)
      .describe('Unicode emoji character to react with, e.g. "👍", "❤️", "😂" (not a shortcode like ":+1:").'),
  })
  .strict();

type AddReactionInput = z.infer<typeof AddReactionInputSchema>;

// ---------------------------------------------------------------------------
// google_chat_remove_reaction
// ---------------------------------------------------------------------------

const RemoveReactionInputSchema = z
  .object({
    message_name: z.string().min(1).describe(MESSAGE_NAME_DESC),
    emoji: z.string().min(1).max(8).describe('Unicode emoji character to remove, e.g. "👍". Must match a reaction you previously added.'),
  })
  .strict();

type RemoveReactionInput = z.infer<typeof RemoveReactionInputSchema>;

interface ChatReaction {
  name?: string; // "spaces/AAAA/messages/BBBB/reactions/CCCC"
}

export function registerReactionTools(server: McpServer, client: GoogleChatClient): void {
  server.registerTool(
    "google_chat_add_reaction",
    {
      title: "Add Reaction to Google Chat Message",
      description: `Add an emoji reaction to a Google Chat message.

Args:
  - message_name (string): Full message resource name, e.g. "spaces/AAAA/messages/BBBB"
  - emoji (string): Unicode emoji character, e.g. "👍" (not a text shortcode)

Returns: The created reaction's resource name.

Examples:
  - Use when: "React with a thumbs up to that message" -> emoji="👍"
  - Don't use when: You want to reply with text (use google_chat_send_message with thread_name instead)

Error Handling:
  - Returns "Error: Invalid request" if the emoji string isn't a valid single Unicode emoji
  - Returns "Error: Permission denied" if the user isn't a member of the message's space`,
      inputSchema: AddReactionInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AddReactionInput) => {
      try {
        const reaction = await client.request<ChatReaction>("POST", `${params.message_name}/reactions`, {
          data: { emoji: { unicode: params.emoji } },
        });
        return {
          content: [{ type: "text", text: `Reacted with ${params.emoji} on ${params.message_name}.` }],
          structuredContent: { name: reaction.name },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "google_chat_remove_reaction",
    {
      title: "Remove Reaction from Google Chat Message",
      description: `Remove a previously added emoji reaction from a Google Chat message.

Args:
  - message_name (string): Full message resource name, e.g. "spaces/AAAA/messages/BBBB"
  - emoji (string): Unicode emoji character to remove, e.g. "👍"

Returns: Confirmation the reaction was removed.

Error Handling:
  - Returns "Error: Resource not found" if there was no matching reaction from the authenticated user on this message`,
      inputSchema: RemoveReactionInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: RemoveReactionInput) => {
      try {
        // The Chat API only supports deleting a reaction by its resource name, not
        // directly by emoji, so we list reactions on the message and find the
        // authenticated user's matching one first.
        const list = await client.request<{ reactions?: { name?: string; emoji?: { unicode?: string } }[] }>(
          "GET",
          `${params.message_name}/reactions`,
          { params: { filter: `emoji.unicode = "${params.emoji}"` } }
        );
        const match = list.reactions?.[0];
        if (!match?.name) {
          return {
            content: [
              { type: "text", text: `No matching ${params.emoji} reaction found on ${params.message_name} to remove.` },
            ],
          };
        }
        await client.request("DELETE", match.name);
        return {
          content: [{ type: "text", text: `Removed ${params.emoji} reaction from ${params.message_name}.` }],
          structuredContent: { removed: match.name },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
