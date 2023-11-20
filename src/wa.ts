import type { Boom } from "@hapi/boom";
import type { ConnectionState, SocketConfig, WASocket, proto } from "@whiskeysockets/baileys";
import makeWASocket, { Browsers, DisconnectReason, isJidBroadcast, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import type { WebSocket } from "ws";
import { useMysqlAuthState } from "./session";
import { useLogger, usePrisma } from "./shared";
import { initStore } from "./store";

type Session = WASocket & {
  destroy: () => Promise<void>;
};

const sessions = new Map<string, Session>();
const retries = new Map<string, number>();
const SSEQRGenerations = new Map<string, number>();

const RECONNECT_INTERVAL = Number(process.env.RECONNECT_INTERVAL || 0);
const MAX_RECONNECT_RETRIES = Number(process.env.MAX_RECONNECT_RETRIES || 5);
const SESSION_CONFIG_ID = "session-config";

export async function init() {
  initStore();
  const prisma = usePrisma();
  const sessions = await prisma.session.findMany({
    select: { sessionId: true, data: true },
    where: { id: { startsWith: SESSION_CONFIG_ID } },
  });

  if (sessions.length == 0) {
    createSession({ sessionId: "rafael" });
    return;
  }

  for (const { sessionId, data } of sessions) {
    const { ...socketConfig } = JSON.parse(data);
    createSession({ sessionId, socketConfig });
  }
}

function shouldReconnect(sessionId: string) {
  let attempts = retries.get(sessionId) ?? 0;

  if (attempts < MAX_RECONNECT_RETRIES) {
    attempts += 1;
    retries.set(sessionId, attempts);
    return true;
  }
  return false;
}

type createSessionOptions = {
  sessionId: string;
  socketConfig?: SocketConfig;
};

export async function createSession(options: createSessionOptions) {
  const logger = useLogger();
  const prisma = usePrisma();
  const { sessionId, socketConfig } = options;
  const configID = `${SESSION_CONFIG_ID}-${sessionId}`;
  let connectionState: Partial<ConnectionState> = { connection: "close" };

  const destroy = async (logout = true) => {
    try {
      await Promise.all([
        logout && socket.logout(),
        // prisma.chat.deleteMany({ where: { sessionId } }),
        // prisma.contact.deleteMany({ where: { sessionId } }),
        // prisma.message.deleteMany({ where: { sessionId } }),
        // prisma.groupMetadata.deleteMany({ where: { sessionId } }),
        prisma.session.deleteMany({ where: { sessionId } }),
      ]);
    } catch (e) {
      logger.error(e, "An error occured during session destroy");
    } finally {
      sessions.delete(sessionId);
    }
  };

  const handleConnectionClose = () => {
    const code = (connectionState.lastDisconnect?.error as Boom)?.output?.statusCode;
    const restartRequired = code === DisconnectReason.restartRequired;
    const doNotReconnect = !shouldReconnect(sessionId);

    if (code === DisconnectReason.loggedOut || doNotReconnect) {
      destroy(doNotReconnect);
      return;
    }

    if (!restartRequired) {
      logger.info({ attempts: retries.get(sessionId) ?? 1, sessionId }, "Reconnecting...");
    }
    setTimeout(() => createSession(options), restartRequired ? 0 : RECONNECT_INTERVAL);
  };

  const handleConnectionUpdate = async () => {
    if (connectionState.qr?.length) {
      console.log(connectionState.qr);
    }
  };

  const { state, saveCreds } = await useMysqlAuthState(sessionId);
  const socket = makeWASocket({
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    ...socketConfig,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
  });

  sessions.set(sessionId, { ...socket, destroy });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", (update) => {
    console.log("---------", update);
    connectionState = update;
    const { connection } = update;

    if (connection === "open") {
      retries.delete(sessionId);
      SSEQRGenerations.delete(sessionId);
    }
    if (connection === "close") handleConnectionClose();
    handleConnectionUpdate();
  });

  await prisma.session.upsert({
    create: {
      id: configID,
      sessionId,
      data: JSON.stringify({ ...socketConfig }),
    },
    update: {},
    where: { sessionId_id: { id: configID, sessionId } },
  });
}

export function getSessionStatus(session: Session) {
  const state = ["CONNECTING", "CONNECTED", "DISCONNECTING", "DISCONNECTED"];
  let status = state[(session.ws as WebSocket).readyState];
  status = session.user ? "AUTHENTICATED" : status;
  return status;
}

export function listSessions() {
  return Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    status: getSessionStatus(session),
  }));
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export async function sendTextMessage(sessionId: string, message: string, to: string): Promise<proto.WebMessageInfo | undefined> {
  const result = await verifyId(getWhatsAppId(to), sessionId);
  if (result == false) {
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  const data = await session.sendMessage(getWhatsAppId(to), { text: message });
  return data;
}

export async function verifyId(id: string, sessionId: string): Promise<boolean> {
  if (id.includes("@g.us")) return true;
  const session = getSession(sessionId);
  if (session) {
    return jidExists(session, id, "number");
  }
  return false;
}

export function getWhatsAppId(id: string) {
  if (id.includes("@g.us") || id.includes("@s.whatsapp.net")) return id;
  return id.includes("-") ? `${id}@g.us` : `${id}@s.whatsapp.net`;
}

export async function deleteSession(sessionId: string): Promise<void> {
  sessions.get(sessionId)?.destroy();
}

export function sessionExists(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export async function jidExists(session: Session, jid: string, type: "group" | "number" = "number") {
  try {
    if (type === "number") {
      const [result] = await session.onWhatsApp(jid);
      return !!result?.exists;
    }

    const groupMeta = await session.groupMetadata(jid);
    return !!groupMeta.id;
  } catch (e) {
    return Promise.reject(e);
  }
}
