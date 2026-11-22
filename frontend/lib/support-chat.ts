import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { getAuthLiteSession } from "@/lib/auth-lite";

export type SupportRole = "client" | "carrier" | "support";

export type SupportActor = {
  role: SupportRole;
  name: string;
  key: string;
};

export type ChatSession = {
  id: string;
  user_id: string;
  agent_id: string | null;
  status: "pending" | "active" | "closed";
  created_at: string;
  started_at: string | null;
  closed_at: string | null;
};

export type SupportThreadState = ChatSession;

export type ChatMessage = {
  id: string;
  session_id: string;
  message: string;
  sender_type: "user" | "support";
  sender_name: string;
  sender_key: string;
  created_at: string;
};

export type SupportMessage = ChatMessage;

type LegacySupportMessage = {
  id: string;
  thread_id: string;
  sender_role: SupportRole;
  sender_name: string;
  sender_key: string;
  body: string;
  read_by?: string[] | null;
  created_at: string;
};

type SupportDatabase = {
  public: {
    Tables: {
      support_sessions: {
        Row: ChatSession;
        Insert: {
          id?: string;
          user_id: string;
          agent_id: string | null;
          status: "pending" | "active" | "closed";
          created_at?: string;
          started_at: string | null;
          closed_at: string | null;
        };
        Update: Partial<ChatSession>;
        Relationships: [];
      };
      chat_sessions: {
        Row: LegacyChatSession;
        Insert: {
          id?: string;
          user_id: string;
          status: string;
          created_at?: string;
          closed_at: string | null;
        };
        Update: Partial<LegacyChatSession>;
        Relationships: [];
      };
      messages: {
        Row: ChatMessage;
        Insert: Omit<ChatMessage, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<ChatMessage>;
        Relationships: [];
      };
      support_messages: {
        Row: LegacySupportMessage;
        Insert: Omit<LegacySupportMessage, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<LegacySupportMessage>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type LegacyChatSession = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
};

function normalizeLegacyChatSession(
  data: LegacyChatSession,
  agentId: string | null = null,
  startedAt: string | null = null,
): ChatSession {
  return {
    id: data.id,
    user_id: data.user_id,
    agent_id: agentId,
    status: data.status === "open" ? "pending" : data.status === "active" ? "active" : "closed",
    created_at: data.created_at,
    started_at: startedAt,
    closed_at: data.closed_at,
  };
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xmvhjokvnmnzwxwxsfxm.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_kZK9yBB-Ars-T7a4VGF_ag_Qvj9Uy2h";

const CHAT_SESSION_USER_KEY = "support-chat-user-id";
const CHAT_SESSION_ID_KEY = "support-chat-session-id";

let browserClient: SupabaseClient<SupportDatabase> | null = null;

export function getSupportSupabaseClient(): SupabaseClient<SupportDatabase> {
  if (browserClient) {
    return browserClient;
  }

  browserClient = createClient<SupportDatabase>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return browserClient;
}

export function getSupportActor(): SupportActor | null {
  const scopedClient = getAuthLiteSession("client");
  const scopedCarrier = getAuthLiteSession("carrier");
  const active = getAuthLiteSession();

  const chosen = active?.role === "client" || active?.role === "carrier" ? active : scopedClient || scopedCarrier;

  if (!chosen || (chosen.role !== "client" && chosen.role !== "carrier")) {
    return null;
  }

  const role = chosen.role;
  const keySeed = chosen.email ? chosen.email.toLowerCase() : `${role}:${chosen.displayName.toLowerCase()}`;
  return {
    role,
    name: chosen.displayName,
    key: `${role}:${keySeed}`,
  };
}

export function getSupportAgentActor(agentName: string): SupportActor | null {
  const trimmedName = agentName.trim();
  if (!trimmedName) {
    return null;
  }

  const normalizedKey = trimmedName.toLowerCase().replace(/\s+/g, "_");
  return {
    role: "support",
    name: trimmedName,
    key: `support:${normalizedKey}`,
  };
}

function getBrowserStorage() {
  return globalThis.window?.localStorage ?? null;
}

function getOrCreateBrowserUserId() {
  const storage = getBrowserStorage();
  if (!storage) {
    return globalThis.crypto?.randomUUID?.() || `user_${Date.now()}`;
  }

  const existing = storage.getItem(CHAT_SESSION_USER_KEY);
  if (existing) {
    return existing;
  }

  const nextId = globalThis.crypto?.randomUUID?.() || `user_${Date.now()}`;
  storage.setItem(CHAT_SESSION_USER_KEY, nextId);
  return nextId;
}

export function getStoredChatSessionId() {
  return getBrowserStorage()?.getItem(CHAT_SESSION_ID_KEY) || null;
}

export function setStoredChatSessionId(sessionId: string | null) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  if (sessionId) {
    storage.setItem(CHAT_SESSION_ID_KEY, sessionId);
  } else {
    storage.removeItem(CHAT_SESSION_ID_KEY);
  }
}

export async function fetchLatestChatSession(): Promise<ChatSession | null> {
  const supabase = getSupportSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("support_sessions")
      .select("id,user_id,agent_id,status,created_at,started_at,closed_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  } catch {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id,user_id,status,created_at,closed_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? normalizeLegacyChatSession(data as LegacyChatSession) : null;
  }
}

export async function fetchChatSession(sessionId: string): Promise<ChatSession | null> {
  const supabase = getSupportSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("support_sessions")
      .select("id,user_id,agent_id,status,created_at,started_at,closed_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  } catch {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id,user_id,status,created_at,closed_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? normalizeLegacyChatSession(data as LegacyChatSession) : null;
  }
}

export async function createChatSession(_actor?: SupportActor | null): Promise<ChatSession> {
  const supabase = getSupportSupabaseClient();
  const userId = getOrCreateBrowserUserId();
  try {
    const { data, error } = await supabase
      .from("support_sessions")
      .insert({
        user_id: userId,
        status: "pending",
        agent_id: null,
        started_at: null,
        closed_at: null,
      })
      .select("id,user_id,agent_id,status,created_at,started_at,closed_at")
      .single();

    if (error) {
      throw error;
    }

    setStoredChatSessionId(data.id);
    return data;
  } catch {
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({
        user_id: userId,
        status: "open",
        closed_at: null,
      })
      .select("id,user_id,status,created_at,closed_at")
      .single();

    if (error) {
      throw error;
    }

    const nextSession = normalizeLegacyChatSession(data as LegacyChatSession);
    setStoredChatSessionId(nextSession.id);
    return nextSession;
  }
}

export async function closeChatSession(sessionId: string): Promise<ChatSession> {
  const supabase = getSupportSupabaseClient();
  const nowIso = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from("support_sessions")
      .update({ status: "closed", closed_at: nowIso })
      .eq("id", sessionId)
      .select("id,user_id,agent_id,status,created_at,started_at,closed_at")
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch {
    const { data, error } = await supabase
      .from("chat_sessions")
      .update({ status: "closed", closed_at: nowIso })
      .eq("id", sessionId)
      .select("id,user_id,status,created_at,closed_at")
      .single();

    if (error) {
      throw error;
    }

    return normalizeLegacyChatSession(data as LegacyChatSession);
  }
}

export async function fetchSupportMessages(sessionId: string, limit = 100): Promise<SupportMessage[]> {
  const supabase = getSupportSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("id,session_id,message,sender_type,sender_name,sender_key,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      throw error;
    }

    return data || [];
  } catch {
    const { data, error } = await supabase
      .from("support_messages")
      .select("id,thread_id,sender_role,sender_name,sender_key,body,read_by,created_at")
      .eq("thread_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      throw error;
    }

    return ((data || []) as LegacySupportMessage[]).map((row) => ({
      id: row.id,
      session_id: row.thread_id,
      message: row.body,
      sender_type: row.sender_role === "support" ? "support" : "user",
      sender_name: row.sender_name,
      sender_key: row.sender_key,
      created_at: row.created_at,
    }));
  }
}

export async function ensureCurrentChatSession(actor?: SupportActor | null): Promise<ChatSession> {
  const storedSessionId = getStoredChatSessionId();
  if (storedSessionId) {
    const existing = await fetchChatSession(storedSessionId);
    if (existing?.status === "pending" || existing?.status === "active") {
      return existing;
    }
  }

  const nextSession = await createChatSession(actor);
  return nextSession;
}

export async function sendSupportMessage(actor: SupportActor, body: string, sessionId: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) {
    return;
  }

  const session = await fetchChatSession(sessionId);
  if (session?.status && session.status !== "active" && session.status !== "pending") {
    throw new Error("Messages can only be sent after support accepts the request.");
  }

  const supabase = getSupportSupabaseClient();
  try {
    const { error } = await supabase.from("messages").insert({
      session_id: sessionId,
      message: trimmed,
      sender_type: actor.role === "support" ? "support" : "user",
      sender_name: actor.name,
      sender_key: actor.key,
    });

    if (error) {
      throw error;
    }
  } catch {
    const { error } = await supabase.from("support_messages").insert({
      thread_id: sessionId,
      sender_role: actor.role,
      sender_name: actor.name,
      sender_key: actor.key,
      body: trimmed,
      read_by: [actor.key],
    });

    if (error) {
      throw error;
    }
  }
}

export function createSupportChannel(channelName: string): RealtimeChannel {
  const supabase = getSupportSupabaseClient();
  return supabase.channel(channelName);
}

export async function fetchPendingSupportSessions(): Promise<ChatSession[]> {
  const supabase = getSupportSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("support_sessions")
      .select("id,user_id,agent_id,status,created_at,started_at,closed_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return data || [];
  } catch {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id,user_id,status,created_at,closed_at")
      .eq("status", "open")
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return (data || []).map((row) => normalizeLegacyChatSession(row as LegacyChatSession));
  }
}

export async function acceptSupportSession(sessionId: string, agent: SupportActor): Promise<ChatSession> {
  const supabase = getSupportSupabaseClient();
  const nowIso = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from("support_sessions")
      .update({ status: "active", agent_id: agent.key, started_at: nowIso })
      .eq("id", sessionId)
      .eq("status", "pending")
      .select("id,user_id,agent_id,status,created_at,started_at,closed_at")
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch {
    const { data, error } = await supabase
      .from("chat_sessions")
      .update({ status: "open" })
      .eq("id", sessionId)
      .select("id,user_id,status,created_at,closed_at")
      .single();

    if (error) {
      throw error;
    }

    return normalizeLegacyChatSession(data as LegacyChatSession, agent.key, nowIso);
  }
}
