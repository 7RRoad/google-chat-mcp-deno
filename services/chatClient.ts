import axios, { AxiosError } from "axios";
import { CHAT_API_BASE_URL } from "../constants.js";
import { GoogleAuthService } from "./auth.js";

/** Thin authenticated HTTP client for the Google Chat REST API. */
export class GoogleChatClient {
  private readonly auth: GoogleAuthService;

  constructor(auth: GoogleAuthService) {
    this.auth = auth;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { params?: Record<string, unknown>; data?: unknown } = {}
  ): Promise<T> {
    const token = await this.auth.getAccessToken();
    try {
      const response = await axios({
        method,
        url: `${CHAT_API_BASE_URL}/${path.replace(/^\//, "")}`,
        params: options.params,
        data: options.data,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      return response.data as T;
    } catch (error) {
      throw error;
    }
  }
}

/** Converts an API error into a clear, actionable message for the agent. */
export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<{ error?: { message?: string; status?: string } }>;
    if (err.response) {
      const apiMessage = err.response.data?.error?.message;
      switch (err.response.status) {
        case 400:
          return `Error: Invalid request${apiMessage ? ` - ${apiMessage}` : ""}. Check that resource names (e.g. "spaces/AAAA...", "spaces/AAAA.../messages/BBBB...") are formatted correctly.`;
        case 401:
          return "Error: Authentication failed. The access token may be invalid or expired, or GOOGLE_REFRESH_TOKEN may have been revoked. Re-run the OAuth consent flow to get a new refresh token.";
        case 403:
          return `Error: Permission denied${apiMessage ? ` - ${apiMessage}` : ""}. The authenticated user may not be a member of this space, or the OAuth token is missing a required scope (chat.spaces.readonly, chat.messages, chat.messages.readonly).`;
        case 404:
          return "Error: Resource not found. Double-check the space or message name/ID.";
        case 429:
          return "Error: Rate limit exceeded. Wait a moment before retrying.";
        default:
          return `Error: Google Chat API request failed with status ${err.response.status}${apiMessage ? ` - ${apiMessage}` : ""}.`;
      }
    } else if (err.code === "ECONNABORTED") {
      return "Error: Request to Google Chat API timed out. Please try again.";
    }
  }
  return `Error: Unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`;
}
