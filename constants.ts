export const CHAT_API_BASE_URL = "https://chat.googleapis.com/v1";
export const CHARACTER_LIMIT = 25000;

// Scopes needed for the tools implemented in this server.
// See: https://developers.google.com/workspace/chat/authenticate-authorize
export const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.spaces.create",
  "https://www.googleapis.com/auth/chat.memberships",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.messages.reactions",
  "https://www.googleapis.com/auth/chat.users.readstate",
  "https://www.googleapis.com/auth/chat.users.availability",
  "https://www.googleapis.com/auth/directory.readonly",
];
