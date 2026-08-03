import axios from "axios";
import { GoogleAuthService } from "./auth.js";

const PEOPLE_API_BASE_URL = "https://people.googleapis.com/v1";

/** Thin authenticated HTTP client for the Google People API (used for directory search). */
export class GooglePeopleClient {
  private readonly auth: GoogleAuthService;

  constructor(auth: GoogleAuthService) {
    this.auth = auth;
  }

  async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { params?: Record<string, unknown>; data?: unknown } = {}
  ): Promise<T> {
    const token = await this.auth.getAccessToken();
    const response = await axios({
      method,
      url: `${PEOPLE_API_BASE_URL}/${path.replace(/^\//, "")}`,
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
  }
}
