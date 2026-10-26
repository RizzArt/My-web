import { reconcileStudioFiles } from "@/lib/studio/reconcile";

const dryRun = !process.argv.includes("--apply");
reconcileStudioFiles({ dryRun }).then((result) => { console.log(JSON.stringify(result)); }).catch((error) => { console.error(error); process.exitCode = 1; });
