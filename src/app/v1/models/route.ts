import { NextResponse } from "next/server";
import { AiApiError, authenticateAiApiKey, bearerApiKey, listAvailableAiApiModels } from "@/lib/ai-api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const plaintext = bearerApiKey(request);
    await authenticateAiApiKey(plaintext);
    const data = await listAvailableAiApiModels();
    return NextResponse.json({ object: "list", data });
  } catch (error) {
    const known = error instanceof AiApiError;
    return NextResponse.json({ error: { message: known ? error.message : "API key tidak valid.", type: "authentication_error", code: known ? error.code : "invalid_api_key" } }, { status: known ? error.httpStatus : 401 });
  }
}
