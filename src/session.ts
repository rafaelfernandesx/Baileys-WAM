import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { AuthenticationCreds, AuthenticationState, BufferJSON, SignalDataSet, SignalDataTypeMap, initAuthCreds, proto } from "@whiskeysockets/baileys";
import { useLogger, usePrisma } from "./shared";

const fixId = (id: string) => id.replace(/\//g, "__").replace(/:/g, "-");

export const useMysqlAuthState = async (sessionId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  const model = usePrisma().session;
  const logger = useLogger();

  const write = async (data: any, id: string) => {
    try {
      data = JSON.stringify(data, BufferJSON.replacer);
      id = fixId(id);
      await model.upsert({
        select: { pkId: true },
        create: { data, id, sessionId },
        update: { data },
        where: { sessionId_id: { id, sessionId } },
      });
    } catch (e) {
      logger.error(e, "An error occured during session write");
    }
  };

  const read = async (id: string) => {
    try {
      const { data } = await model.findUniqueOrThrow({
        select: { data: true },
        where: { sessionId_id: { id: fixId(id), sessionId } },
      });
      return JSON.parse(data, BufferJSON.reviver);
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === "P2025") {
        logger.info({ id }, "Trying to read non existent session data");
      } else {
        logger.error(e, "An error occured during session read");
      }
      return null;
    }
  };

  const del = async (id: string) => {
    try {
      await model.delete({
        select: { pkId: true },
        where: { sessionId_id: { id: fixId(id), sessionId } },
      });
    } catch (e) {
      logger.error(e, "An error occured during session delete");
    }
  };

  const creds: AuthenticationCreds = (await read("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }

              data[id] = value;
            })
          );

          return data;
        },
        set: async (data: SignalDataSet) => {
          const tasks: Promise<void>[] = [];
          Object.entries(data).forEach(([dataType, dataMap]) => {
            Object.entries(dataMap).forEach(([id, data]) => {
              const sId = `${dataType}-${id}`;
              tasks.push(data ? write(data, sId) : del(sId));
            });
          });
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => {
      return write(creds, "creds");
    },
  };
};
