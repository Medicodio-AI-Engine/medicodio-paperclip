import type { TeamsMcpConfig } from "./config.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export interface TeamsTeam {
  id: string;
  displayName: string;
  description?: string;
  webUrl?: string;
}

export interface TeamsChannel {
  id: string;
  displayName: string;
  description?: string;
  membershipType?: string;
  webUrl?: string;
}

export interface TeamsMessage {
  id: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  subject?: string | null;
  body: { contentType: string; content: string };
  from?: { user?: { displayName: string; id: string } };
  reactions?: Array<{ reactionType: string; count: number }>;
  replyToId?: string | null;
}

export interface TeamsChatMessage {
  id: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  body: { contentType: string; content: string };
  from?: { user?: { displayName: string; id: string } };
  chatId?: string;
}

export interface TeamsChat {
  id: string;
  topic?: string;
  chatType: string;
  lastUpdatedDateTime?: string;
  members?: Array<{ displayName?: string; userId?: string }>;
}

export interface SendMessageResult {
  id: string;
  createdDateTime?: string;
  webUrl?: string;
}

export class TeamsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly url: string,
    public readonly body: unknown,
  ) {
    const msg = typeof body === "object" && body !== null
      ? ((body as Record<string, unknown>)?.error as Record<string, unknown>)?.message as string
      : String(body);
    super(`Teams API ${method} ${url} → ${status}: ${msg ?? "unknown error"}`);
    this.name = "TeamsApiError";
  }
}

export class TeamsClient {
  private tokenCache: TokenCache | null = null;

  constructor(private readonly config: TeamsMcpConfig) {}

  // ── Auth ─────────────────────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.accessToken;
    }
    const url = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token fetch failed ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = { accessToken: data.access_token, expiresAt: now + 55 * 60 * 1000 };
    return data.access_token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const url = path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errBody: unknown;
      try { errBody = await res.json(); } catch { errBody = await res.text(); }
      throw new TeamsApiError(res.status, method, url, errBody);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ── Teams ────────────────────────────────────────────────────────────────────

  async listTeams(): Promise<TeamsTeam[]> {
    const data = await this.request<{ value: TeamsTeam[] }>("GET", "/teams");
    return data.value;
  }

  async getTeam(teamId: string): Promise<TeamsTeam> {
    return this.request<TeamsTeam>("GET", `/teams/${teamId}`);
  }

  // ── Channels ─────────────────────────────────────────────────────────────────

  async listChannels(teamId: string): Promise<TeamsChannel[]> {
    const data = await this.request<{ value: TeamsChannel[] }>("GET", `/teams/${teamId}/channels`);
    return data.value;
  }

  async getChannel(teamId: string, channelId: string): Promise<TeamsChannel> {
    return this.request<TeamsChannel>("GET", `/teams/${teamId}/channels/${channelId}`);
  }

  // ── Channel messages ──────────────────────────────────────────────────────────

  async listChannelMessages(teamId: string, channelId: string, top = 20): Promise<TeamsMessage[]> {
    const data = await this.request<{ value: TeamsMessage[] }>(
      "GET",
      `/teams/${teamId}/channels/${channelId}/messages?$top=${top}`,
    );
    return data.value;
  }

  async sendChannelMessage(
    teamId: string,
    channelId: string,
    content: string,
    contentType: "text" | "html" = "text",
    subject?: string,
  ): Promise<SendMessageResult> {
    const body: Record<string, unknown> = {
      body: { contentType, content },
    };
    if (subject) body.subject = subject;
    return this.request<SendMessageResult>(
      "POST",
      `/teams/${teamId}/channels/${channelId}/messages`,
      body,
    );
  }

  async replyToChannelMessage(
    teamId: string,
    channelId: string,
    messageId: string,
    content: string,
    contentType: "text" | "html" = "text",
  ): Promise<SendMessageResult> {
    return this.request<SendMessageResult>(
      "POST",
      `/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`,
      { body: { contentType, content } },
    );
  }

  async listMessageReplies(
    teamId: string,
    channelId: string,
    messageId: string,
  ): Promise<TeamsMessage[]> {
    const data = await this.request<{ value: TeamsMessage[] }>(
      "GET",
      `/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`,
    );
    return data.value;
  }

  // ── Chats (1:1 and group) ─────────────────────────────────────────────────────

  async listChats(userId: string, top = 20): Promise<TeamsChat[]> {
    const data = await this.request<{ value: TeamsChat[] }>(
      "GET",
      `/users/${userId}/chats?$top=${top}&$expand=members`,
    );
    return data.value;
  }

  async listChatMessages(chatId: string, top = 20): Promise<TeamsChatMessage[]> {
    const data = await this.request<{ value: TeamsChatMessage[] }>(
      "GET",
      `/chats/${chatId}/messages?$top=${top}`,
    );
    return data.value;
  }

  async sendChatMessage(
    chatId: string,
    content: string,
    contentType: "text" | "html" = "text",
  ): Promise<SendMessageResult> {
    return this.request<SendMessageResult>(
      "POST",
      `/chats/${chatId}/messages`,
      { body: { contentType, content } },
    );
  }

  // ── Notifications (activity feed) ────────────────────────────────────────────

  async sendActivityNotification(
    userId: string,
    topic: string,
    activityType: string,
    previewText: string,
    teamId?: string,
    channelId?: string,
    messageId?: string,
  ): Promise<void> {
    const topicPayload: Record<string, unknown> = {
      source: "entityUrl",
      value: teamId && channelId && messageId
        ? `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}`
        : `https://graph.microsoft.com/v1.0/users/${userId}/chats/getAllMessages`,
      webUrl: teamId && channelId
        ? `https://teams.microsoft.com/l/channel/${encodeURIComponent(channelId)}`
        : undefined,
    };

    await this.request<void>(
      "POST",
      `/users/${userId}/teamwork/sendActivityNotification`,
      {
        topic: topicPayload,
        activityType,
        previewText: { content: previewText },
      },
    );
  }

  // ── Search messages ───────────────────────────────────────────────────────────

  async searchMessages(query: string): Promise<TeamsMessage[]> {
    const data = await this.request<{ value: Array<{ hitsContainers: Array<{ hits: Array<{ resource: TeamsMessage }> }> }> }>(
      "POST",
      "/search/query",
      {
        requests: [
          {
            entityTypes: ["chatMessage"],
            query: { queryString: query },
            from: 0,
            size: 25,
          },
        ],
      },
    );
    return data.value
      .flatMap((r) => r.hitsContainers)
      .flatMap((c) => c.hits)
      .map((h) => h.resource);
  }
}
