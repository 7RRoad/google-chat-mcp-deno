import { OAuth2Client } from "google-auth-library";

/**
 * Wraps a Google OAuth2 client configured from environment variables and
 * exposes a helper to get a fresh access token for API calls.
 *
 * Required environment variables:
 *  - GOOGLE_CLIENT_ID
 *  - GOOGLE_CLIENT_SECRET
 *  - GOOGLE_REFRESH_TOKEN
 *
 * The refresh token must have been obtained via the OAuth consent flow for
 * a user/app authorized with the Chat API scopes (see constants.ts). Use
 * Google's OAuth Playground (https://developers.google.com/oauthplayground)
 * or a one-time local auth script to mint the refresh token.
 */
export class GoogleAuthService {
  private readonly client: OAuth2Client;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Missing required environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN"
      );
    }

    this.client = new OAuth2Client({ clientId, clientSecret });
    this.client.setCredentials({ refresh_token: refreshToken });
  }

  /** Returns a valid bearer access token, refreshing it if needed. */
  async getAccessToken(): Promise<string> {
    const { token } = await this.client.getAccessToken();
    if (!token) {
      throw new Error(
        "Failed to obtain Google access token. Check that GOOGLE_REFRESH_TOKEN is valid and not revoked."
      );
    }
    return token;
  }
}
