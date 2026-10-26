import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const transportMap = readFileSync(new URL("../deployment/nginx/digital-store-https-transport.conf", import.meta.url), "utf8");
const installer = readFileSync(new URL("../deployment/apply-https-transport-nginx.sh", import.meta.url), "utf8");

describe("canonical authentication host", () => {
  it("redirects the legacy shop hostname to the canonical root hostname", () => {
    expect(transportMap).toContain('map $host $riezz_redirect_to_canonical_host');
    expect(transportMap).toContain('shop.riezz99.biz.id 1;');
    expect(installer).toContain('if (\\$riezz_redirect_to_canonical_host = 1)');
    expect(installer).toContain('return 308 https://riezz99.biz.id\\$request_uri;');
    expect(installer).toContain("[ \"$location\" = 'https://riezz99.biz.id/' ]");
    expect(installer).toContain("[ \"$location\" = 'https://riezz99.biz.id/login?source=audit' ]");
    expect(installer).toContain("[ \"$status\" = 308 ]");
  });
});
