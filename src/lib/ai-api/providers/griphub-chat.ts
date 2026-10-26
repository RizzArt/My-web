import { SekaiChatProvider, type OpenAiCompatibleChatProviderOptions } from "./sekai-chat";

export const GRIPHUB_CHAT_URL = "https://griphubrouter.web.id/v1/chat/completions";

export class GriphubChatProvider extends SekaiChatProvider {
  constructor(options: OpenAiCompatibleChatProviderOptions = {}) {
    super({ ...options, endpoint: GRIPHUB_CHAT_URL, credentialEnvName: "GRIPHUB_API_KEY" });
  }
}
