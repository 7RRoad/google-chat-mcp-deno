export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export interface ChatSpace {
  name: string; // "spaces/AAAA..."
  type?: string; // deprecated, use spaceType
  spaceType?: string; // SPACE, GROUP_CHAT, DIRECT_MESSAGE
  displayName?: string;
  spaceThreadingState?: string;
  spaceDetails?: { description?: string; guidelines?: string };
}

export interface ChatUser {
  name?: string; // "users/1234..."
  displayName?: string;
  type?: string; // HUMAN, BOT
}

export interface ChatMessage {
  name: string; // "spaces/AAAA/messages/BBBB"
  sender?: ChatUser;
  createTime?: string;
  text?: string;
  thread?: { name?: string };
  space?: { name?: string };
}

export interface ListSpacesResponse {
  spaces?: ChatSpace[];
  nextPageToken?: string;
}

export interface ListMessagesResponse {
  messages?: ChatMessage[];
  nextPageToken?: string;
}

export interface ChatMembership {
  name?: string; // "spaces/AAAA/members/BBBB"
  state?: string; // JOINED, INVITED, NOT_A_MEMBER
  role?: string; // ROLE_MEMBER, ROLE_MANAGER
  member?: ChatUser;
}

export interface ListMembershipsResponse {
  memberships?: ChatMembership[];
  nextPageToken?: string;
}
