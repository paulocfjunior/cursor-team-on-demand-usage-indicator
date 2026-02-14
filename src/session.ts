import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { isValid } from "./jwt";

const SECRET_KEY = "cursorUsage.sessionCookie";
const LEGACY_SESSION_FILE = path.join(os.homedir(), ".cursor-session");

export function extractToken(cookieString: string): string | null {
    const segments = cookieString.split(";").map((item) => item.trim());
    for (const segment of segments) {
        if (segment.startsWith("WorkosCursorSessionToken=")) {
            const token = segment.slice("WorkosCursorSessionToken=".length).trim();
            return token.length > 0 ? token : null;
        }
    }
    return null;
}

export async function readSession(secrets: vscode.SecretStorage): Promise<string | null> {
    const session = await secrets.get(SECRET_KEY);
    if (!session) {
        return null;
    }
    return session.trim() || null;
}

export async function writeSession(secrets: vscode.SecretStorage, cookieString: string): Promise<void> {
    await secrets.store(SECRET_KEY, cookieString.trim());
}

export async function clearSession(secrets: vscode.SecretStorage): Promise<void> {
    await secrets.delete(SECRET_KEY);
}

export async function getToken(secrets: vscode.SecretStorage): Promise<string | null> {
    const session = await readSession(secrets);
    if (!session) {
        return null;
    }
    return extractToken(session);
}

export async function isSessionValid(secrets: vscode.SecretStorage): Promise<boolean> {
    const token = await getToken(secrets);
    if (!token) {
        return false;
    }
    return isValid(token);
}

export async function importFromLegacyFile(secrets: vscode.SecretStorage): Promise<string | null> {
    const existing = await readSession(secrets);
    if (existing) {
        return existing;
    }

    try {
        const raw = await fs.readFile(LEGACY_SESSION_FILE, "utf8");
        const cookieString = raw.trim();
        if (!cookieString) {
            return null;
        }

        const token = extractToken(cookieString);
        if (!token || !isValid(token)) {
            return null;
        }

        await writeSession(secrets, cookieString);
        return cookieString;
    } catch {
        return null;
    }
}
