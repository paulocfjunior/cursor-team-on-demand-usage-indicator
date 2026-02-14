import * as assert from "assert";
import type { SecretStorage } from "vscode";
import { extractToken, getToken, isSessionValid, readSession, writeSession, clearSession } from "../../session";

class MemorySecrets implements SecretStorage {
    private readonly storeMap = new Map<string, string>();
    readonly onDidChange = (() => ({ dispose: () => undefined })) as SecretStorage["onDidChange"];

    async keys(): Promise<string[]> {
        return Array.from(this.storeMap.keys());
    }

    async get(key: string): Promise<string | undefined> {
        return this.storeMap.get(key);
    }

    async store(key: string, value: string): Promise<void> {
        this.storeMap.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.storeMap.delete(key);
    }
}

function buildToken(exp: number): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
    return `${header}.${payload}.signature`;
}

describe("session storage", () => {
    it("extractToken handles cookie strings", () => {
        const token = "token-value";
        const cookie = `WorkosCursorSessionToken=${token}; team_id=123`;
        assert.strictEqual(extractToken(cookie), token);
    });

    it("write/read/clear session through SecretStorage", async () => {
        const secrets = new MemorySecrets();
        await writeSession(secrets, "WorkosCursorSessionToken=abc");
        assert.strictEqual(await readSession(secrets), "WorkosCursorSessionToken=abc");
        await clearSession(secrets);
        assert.strictEqual(await readSession(secrets), null);
    });

    it("isSessionValid validates JWT expiration", async () => {
        const secrets = new MemorySecrets();
        const token = buildToken(Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60));
        await writeSession(secrets, `WorkosCursorSessionToken=${token}`);
        assert.strictEqual(await getToken(secrets), token);
        assert.strictEqual(await isSessionValid(secrets), true);
    });
});
