import { drainPushQueue } from "../src/lib/push/server";

drainPushQueue(50).then((result) => { console.info(`push queue processed=${result.processed} pending=${result.pending}`); }).catch((error) => { console.error("push queue worker failed", error instanceof Error ? error.message : "unknown error"); process.exitCode = 1; });
