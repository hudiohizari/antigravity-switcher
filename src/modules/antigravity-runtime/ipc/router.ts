import { agyBinaryPatchRouter } from "./agyBinaryPatchRouter";
import { antigravityClientCacheRouter } from "./cacheRouter";
import { processRouter } from "./processRouter";
import { conversationCleanerRouter } from "./conversationCleanerRouter";
import { chatBackupRouter } from "./chatBackupRouter";
import { chatHealthRouter } from "./chatHealthRouter";

export const antigravityRuntimeRouter = {
  antigravityClientCache: antigravityClientCacheRouter,
  agyBinaryPatch: agyBinaryPatchRouter,
  proc: processRouter,
  conversationCleaner: conversationCleanerRouter,
  chatBackup: chatBackupRouter,
  chatHealth: chatHealthRouter,
};
