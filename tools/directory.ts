import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GooglePeopleClient } from "../services/peopleClient.js";
import { handleApiError } from "../services/chatClient.js";

const SearchDirectoryInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(100)
      .describe('Name to search for in the Workspace directory - a first name, last name, or full name, e.g. "Alexandre" or "Alexandre Rosset".'),
    page_size: z.number().int().min(1).max(30).default(10).describe("Max matches to return (1-30, default 10)."),
  })
  .strict();

type SearchDirectoryInput = z.infer<typeof SearchDirectoryInputSchema>;

interface DirectoryPerson {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[];
  organizations?: { title?: string; department?: string }[];
}

interface SearchDirectoryPeopleResponse {
  people?: DirectoryPerson[];
}

export function registerDirectoryTools(server: McpServer, peopleClient: GooglePeopleClient): void {
  server.registerTool(
    "google_directory_search_people",
    {
      title: "Search Workspace Directory for a Person",
      description: `Search the authenticated user's Google Workspace organization directory by name to find someone's email address.

Use this to resolve a first name or full name (e.g. from a user request like "message Alexandre") into an email address, which is then usable with google_chat_create_space, google_chat_add_member, etc.

Args:
  - query (string): Name to search for - first name, last name, or full name
  - page_size (number): Max matches to return, 1-30 (default 10)

Returns:
  {
    "count": number,
    "people": [ { "displayName": string, "email": string, "title": string | undefined } ]
  }

Examples:
  - Use when: "Send a Chat message to Alexandre" and you only have a first name -> query="Alexandre", then pick the right match's email
  - Use when: Multiple people share a first name -> inspect the "title"/department in results, or ask the user to disambiguate

Error Handling:
  - Returns "No matches found" (not an error) if nobody in the directory matches the query
  - Returns "Error: Permission denied" if the OAuth token lacks the directory.readonly scope, or this isn't a Workspace account with a shared directory`,
      inputSchema: SearchDirectoryInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: SearchDirectoryInput) => {
      try {
        const data = await peopleClient.request<SearchDirectoryPeopleResponse>("GET", "people:searchDirectoryPeople", {
          params: {
            query: params.query,
            readMask: "names,emailAddresses,organizations",
            sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT",
            pageSize: params.page_size,
          },
        });

        const people = data.people ?? [];
        if (!people.length) {
          return { content: [{ type: "text", text: `No matches found in the directory for "${params.query}".` }] };
        }

        const results = people.map((p) => ({
          displayName: p.names?.[0]?.displayName,
          email: p.emailAddresses?.find((e) => e.metadata?.primary)?.value ?? p.emailAddresses?.[0]?.value,
          title: p.organizations?.[0]?.title,
        }));

        const lines = [`# Directory matches for "${params.query}" (${results.length})`, ""];
        for (const r of results) {
          lines.push(`- **${r.displayName ?? "(unknown name)"}** — ${r.email ?? "(no email)"}${r.title ? ` — ${r.title}` : ""}`);
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: { count: results.length, people: results },
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
