const TAG_LENGTH = 2;
const MAX_AMOUNT_IDR = 999_999_999_999;

export type QrisTlv = { tag: string; value: string };

function parseTlvAt(payload: string, offset: number): { item: QrisTlv; next: number } {
  if (offset + 4 > payload.length) throw new Error("QRIS TLV boundary is invalid");
  const tag = payload.slice(offset, offset + TAG_LENGTH);
  const lengthText = payload.slice(offset + TAG_LENGTH, offset + 4);
  if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) throw new Error("QRIS TLV header is invalid");
  const length = Number(lengthText);
  const valueStart = offset + 4;
  const valueEnd = valueStart + length;
  if (valueEnd > payload.length) throw new Error("QRIS TLV length exceeds payload");
  return { item: { tag, value: payload.slice(valueStart, valueEnd) }, next: valueEnd };
}

export function parseQrisTlv(payload: string): QrisTlv[] {
  if (typeof payload !== "string" || payload.length < 4) throw new Error("QRIS payload is empty or too short");
  const result: QrisTlv[] = [];
  for (let offset = 0; offset < payload.length;) {
    const parsed = parseTlvAt(payload, offset);
    result.push(parsed.item);
    offset = parsed.next;
  }
  return result;
}

function encodeTlv(item: QrisTlv): string {
  if (!/^\d{2}$/.test(item.tag) || item.value.length > 99) throw new Error("QRIS TLV cannot be encoded");
  return `${item.tag}${String(item.value.length).padStart(2, "0")}${item.value}`;
}

export function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, "utf8")) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function validateQrisPayload(payload: string): QrisTlv[] {
  const items = parseQrisTlv(payload);
  const crc = items.at(-1);
  if (!crc || crc.tag !== "63" || crc.value.length !== 4 || items.filter((item) => item.tag === "63").length !== 1) throw new Error("QRIS CRC tag is invalid");
  const crcStart = payload.lastIndexOf("6304");
  if (crcStart < 0 || crcStart + 8 !== payload.length || crc.value !== crc16Ccitt(payload.slice(0, crcStart) + "6304")) throw new Error("QRIS CRC is invalid");
  const header = items.find((item) => item.tag === "00");
  const poi = items.find((item) => item.tag === "01");
  const country = items.find((item) => item.tag === "58");
  const merchant = items.find((item) => item.tag === "59");
  if (!header || header.value !== "01" || !poi || !["11", "12"].includes(poi.value) || !country || country.value !== "ID" || !merchant?.value.trim()) throw new Error("QRIS required fields are invalid");
  return items;
}

export function extractMerchantName(payload: string): string {
  return validateQrisPayload(payload).find((item) => item.tag === "59")?.value ?? "";
}

export function createDynamicQris(staticPayload: string, amount: number): string {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_IDR) throw new Error("QRIS amount is invalid");
  const items = validateQrisPayload(staticPayload);
  const poi = items.find((item) => item.tag === "01");
  if (!poi || poi.value !== "11") throw new Error("QRIS source must be a static payload");
  const withoutCrc = items.filter((item) => item.tag !== "54" && item.tag !== "63").map((item) => item.tag === "01" ? { ...item, value: "12" } : item);
  withoutCrc.push({ tag: "54", value: String(amount) });
  const body = withoutCrc.map(encodeTlv).join("") + "6304";
  return body + crc16Ccitt(body);
}

export function qrisStaticPayload(): string | null {
  const payload = process.env.QRIS_STATIC_PAYLOAD?.trim();
  if (!payload) return null;
  try {
    validateQrisPayload(payload);
    return payload;
  } catch (error) {
    console.error("QRIS static payload is invalid", { error: error instanceof Error ? error.message : "validation failed" });
    return null;
  }
}

export function qrisIsAvailable(): boolean { return qrisStaticPayload() !== null; }
