const ONE_DAY_SECONDS = 24 * 60 * 60;

function normalizeToken(token: string): string {
    const decoded = token.replaceAll("%3A", ":").replaceAll("%253A", ":");
    const separatorIndex = decoded.indexOf("::");
    if (separatorIndex >= 0) {
        return decoded.slice(separatorIndex + 2);
    }
    return decoded;
}

function base64UrlToBase64(payload: string): string {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const paddingLength = (4 - (normalized.length % 4)) % 4;
    return normalized + "=".repeat(paddingLength);
}

export function decodePayload(token: string): Record<string, unknown> {
    const normalized = normalizeToken(token);
    const segments = normalized.split(".");
    if (segments.length < 2) {
        throw new Error("Invalid JWT format.");
    }

    const payload = base64UrlToBase64(segments[1]);
    const json = Buffer.from(payload, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parsed;
}

export function getExp(token: string): number | null {
    try {
        const payload = decodePayload(token);
        const exp = payload.exp;
        if (typeof exp !== "number" || Number.isNaN(exp)) {
            return null;
        }
        return exp;
    } catch {
        return null;
    }
}

export function isValid(token: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    const exp = getExp(token);
    if (!exp) {
        return false;
    }
    return exp - nowSeconds > ONE_DAY_SECONDS;
}

export function daysRemaining(token: string, nowSeconds = Math.floor(Date.now() / 1000)): number {
    const exp = getExp(token);
    if (!exp) {
        return 0;
    }
    return Math.floor((exp - nowSeconds) / ONE_DAY_SECONDS);
}
