import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Self-hosted note.
 *
 * Document processing normally calls Google (and Mistral) directly, which needs
 * a Google AI key. A self-hosted instance often has neither, but does have an
 * OpenAI-compatible gateway such as OpenRouter that serves equivalent models.
 *
 * Setting DOCUMENTS_MODEL alongside OPENAI_BASE_URL routes text and structured
 * generation through that gateway. Left unset, callers fall back to their
 * original provider and nothing changes.
 *
 * Embeddings are deliberately not covered: OpenRouter exposes no embeddings
 * endpoint, so `embed`/`embedMany` still require a real Google or OpenAI key.
 */
const gateway = process.env.DOCUMENTS_MODEL
  ? createOpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
    })
  : null;

/**
 * Returns the gateway model when one is configured, otherwise null so the
 * caller uses its own provider.
 */
export function gatewayModel(): LanguageModel | null {
  return gateway ? gateway(process.env.DOCUMENTS_MODEL!) : null;
}

export const isGatewayEnabled = gateway !== null;
