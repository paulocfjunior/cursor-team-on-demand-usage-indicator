import * as https from "node:https";
import { ApiResponse, UsageData } from "./types";

const CACHE_TTL_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type CacheEntry = {
    key: string;
    expiresAt: number;
    value: ApiResponse;
};

let cache: CacheEntry | null = null;

function requestJson(url: URL, body: string, cookieString: string): Promise<ApiResponse> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            url,
            {
                method: "POST",
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    origin: "https://cursor.com",
                    referer: "https://cursor.com/dashboard?tab=usage",
                    cookie: cookieString,
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                        reject(new Error(`Cursor API request failed with status ${res.statusCode}.`));
                        return;
                    }

                    try {
                        const parsed = JSON.parse(text) as ApiResponse;
                        if (typeof parsed.totalMembers !== "number") {
                            throw new Error("Invalid API response shape.");
                        }
                        resolve(parsed);
                    } catch (error) {
                        reject(new Error(`Failed to parse Cursor API response: ${String(error)}`));
                    }
                });
            },
        );

        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

export function clearApiCache(): void {
    cache = null;
}

export async function fetchTeamSpend(teamId: string, cookieString: string): Promise<ApiResponse> {
    const numericTeamId = Number.parseInt(teamId, 10);
    if (!Number.isFinite(numericTeamId) || numericTeamId <= 0) {
        throw new Error("Invalid team ID. Set cursorUsage.teamId in settings.");
    }

    const key = `${numericTeamId}:${cookieString}`;
    const now = Date.now();
    if (cache && cache.key === key && cache.expiresAt > now) {
        return cache.value;
    }

    const response = await requestJson(
        new URL("https://cursor.com/api/dashboard/get-team-spend"),
        JSON.stringify({ teamId: numericTeamId }),
        cookieString,
    );
    cache = { key, expiresAt: now + CACHE_TTL_MS, value: response };
    return response;
}

function formatRenewal(daysUntilRenewal: number): string {
    if (daysUntilRenewal === 0) {
        return "today";
    }
    if (daysUntilRenewal === 1) {
        return "tomorrow";
    }
    if (daysUntilRenewal < 0) {
        return `${Math.abs(daysUntilRenewal)} days overdue`;
    }
    return `in ${daysUntilRenewal} days`;
}

export function formatSpend(cents: number): string {
    const dollars = cents / 100;
    const formatted = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(dollars);
    return `$ ${formatted}`;
}

export function parseUsageData(response: ApiResponse, now = Date.now()): UsageData {
    const spendCents = typeof response.maxUserSpendCents === "number" ? response.maxUserSpendCents : 0;
    const nextCycleStartMs = Number(response.nextCycleStart);
    const daysUntilRenewal = Number.isFinite(nextCycleStartMs)
        ? Math.floor((nextCycleStartMs - now) / DAY_MS)
        : 0;
    const cycleRenewsDate = Number.isFinite(nextCycleStartMs)
        ? new Date(nextCycleStartMs).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "unknown";

    const ranked = (response.teamMemberSpend ?? [])
        .filter((member) => typeof member.spendCents === "number")
        .sort((a, b) => (b.spendCents ?? 0) - (a.spendCents ?? 0));
    const userEmail = ranked[0]?.email ?? "unknown";

    return {
        userEmail,
        spendFormatted: formatSpend(spendCents),
        cycleRenewsDate,
        daysUntilRenewal,
        renewalDescription: formatRenewal(daysUntilRenewal),
    };
}
