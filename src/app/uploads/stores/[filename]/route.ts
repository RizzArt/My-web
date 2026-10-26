import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { productStorageRoot } from "@/lib/storage/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!/^[a-f0-9-]+\.webp$/.test(filename)) return new NextResponse("Not found", { status: 404 });
  try {
    const file = await readFile(path.join(path.dirname(productStorageRoot()), "stores", filename));
    return new NextResponse(file, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
