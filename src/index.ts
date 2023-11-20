/*import { Boom } from "@hapi/boom";
import makeWASocket, { ConnectionState, DisconnectReason } from "@whiskeysockets/baileys";
import { useMysqlAuthState } from "./session";
import { useLogger } from "./shared";
import { initStore } from "./store";

async function connectToWhatsApp(sessionId: string) {
  initStore();
  const logger = useLogger();
  const { state, saveCreds } = await useMysqlAuthState(sessionId);
  const sock = makeWASocket({
    // can provide additional config here
    auth: state,
    // logger: logger,
    printQRInTerminal: false,
  });
  sock.logout = async (msg: string | undefined) => {
    console.log(msg);
  };
  sock.end = (error: Error | undefined) => {
    console.log(error);
  };
  sock.onUnexpectedError = (err: Error | import("@hapi/boom").Boom<any>, msg: string) => {
    console.log(err);
  };
  sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;
    let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
    if (connection === "close") {
      if (reason === DisconnectReason.badSession) {
        logger.error(`Bad Session, Please Delete /auth and Scan Again`);
        process.exit();
      } else if (reason === DisconnectReason.connectionClosed) {
        logger.warn("Connection closed, reconnecting....");
      } else if (reason === DisconnectReason.connectionLost) {
        logger.warn("Connection Lost from Server, reconnecting...");
      } else if (reason === DisconnectReason.connectionReplaced) {
        logger.error("Connection Replaced, Another New Session Opened, Please Close Current Session First");
        process.exit();
      } else if (reason === DisconnectReason.loggedOut) {
        logger.error(`Device Logged Out, Please Delete /auth and Scan Again.`);
        process.exit();
      } else if (reason === DisconnectReason.restartRequired) {
        logger.info("Restart Required, Restarting...");
      } else if (reason === DisconnectReason.timedOut) {
        logger.warn("Connection TimedOut, Reconnecting...");
      } else {
        logger.warn(`Unknown DisconnectReason: ${reason}: ${connection}`);
      }
      // const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      // console.log("connection closed due to ", lastDisconnect?.error, ", reconnecting ", shouldReconnect);
      // // reconnect if not logged out
      // if (shouldReconnect) {
      //   connectToWhatsApp(sessionId);
      // }
    } else if (connection === "open") {
      console.log("opened connection");
    }
    if (qr) {
      console.log(qr);
    }
  });
  sock.ev.on("messages.upsert", (m: any) => {
    console.log(JSON.stringify(m, undefined, 2));
    // sock
    //   .sendMessage(m.messages[0].key.remoteJid!, { text: "Hello there!" })
    //   .then((result) => {
    //     console.log("Result of sending message: ", result);
    //   })
    //   .catch((error) => {
    //     console.log("Error of sending message: ", error);
    //   });
  });
  sock.ev.on("creds.update", saveCreds);
}
// run in main file
connectToWhatsApp("1");
*/

import { init, sendTextMessage } from "./wa";

(async () => {
  await init();

  setTimeout(async () => {
    const res = await sendTextMessage("rafael", "Hello world", "554789116008");
    console.log(res);
  }, 6000);
})();
