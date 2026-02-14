import * as assert from "assert";
import { daysRemaining, decodePayload, isValid } from "../../jwt";

function buildToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${body}.signature`;
}

describe("jwt utilities", () => {
    it("decodePayload parses payload from JWT", () => {
        const token = buildToken({ sub: "user-123", exp: 2_000_000_000 });
        const payload = decodePayload(token);
        assert.strictEqual(payload["sub"], "user-123");
    });

    it("isValid returns true when expiry is beyond one day", () => {
        const now = 1_000_000;
        const token = buildToken({ exp: now + (2 * 24 * 60 * 60) });
        assert.strictEqual(isValid(token, now), true);
    });

    it("isValid returns false when expiry is less than one day", () => {
        const now = 1_000_000;
        const token = buildToken({ exp: now + (8 * 60 * 60) });
        assert.strictEqual(isValid(token, now), false);
    });

    it("daysRemaining returns 0 for malformed tokens", () => {
        assert.strictEqual(daysRemaining("not-a-token", 1_000_000), 0);
    });
});
