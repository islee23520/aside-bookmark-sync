import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PROTOCOL } from "../src/shared/protocol";
import { startServer } from "./server";
import { StateStore } from "./state";

const { ASIDE_BOOKMARK_SYNC_STATE_DIR } = process.env;
const directory = z
  .string()
  .min(1)
  .parse(ASIDE_BOOKMARK_SYNC_STATE_DIR ?? join(homedir(), ".aside-bookmark-sync"));
const store = await StateStore.load(directory);
const server = startServer(store);
console.info(
  JSON.stringify({
    level: "info",
    event: "listening",
    host: PROTOCOL.hostname,
    port: PROTOCOL.port,
  }),
);

const shutdown = async () => {
  await server.stop(true);
  await store.drain();
  console.info(JSON.stringify({ level: "info", event: "stopped" }));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
