import * as https from "node:https";
import { ApiResponse, UsageData } from "./types";

const CACHE_TTL_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type CacheEntry = {
    key: string;
    expiresAt: number;
    value: UsageData;
};

let cache: CacheEntry | null = null;

// ── API response types (exact shapes from cursor.com) ───────────────────────

interface AuthMeResponse {
    email?: string;
    id?: number;
    name?: string;
    sub?: string;
}

interface UsageSummaryResponse {
    billingCycleStart?: string;
    billingCycleEnd?: string;
    individualUsage?: {
        onDemand?: { used?: number };
    };
    teamUsage?: {
        onDemand?: { used?: number; limit?: number; remaining?: number };
    };
}

interface UsageEvent {
    tokenUsage?: { totalCents?: number };
    isChargeable?: boolean;
}

interface FilteredUsageEventsResponse {
    totalUsageEventsCount?: number;
    usageEventsDisplay?: UsageEvent[];
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function requestJson<T>(url: URL, method: "GET" | "POST", cookieString: string, body?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            url,
            {
                method,
                headers: {
                    accept: "application/json",
                    ...(method === "POST" ? { "content-type": "application/json" } : {}),
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
                        reject(new Error(`Cursor API returned status ${res.statusCode}.`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(text) as T);
                    } catch (error) {
                        reject(new Error(`Failed to parse Cursor API response: ${String(error)}`));
                    }
                });
            },
        );
        req.on("error", reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function formatSpend(cents: number): string {
    const dollars = cents / 100;
    const formatted = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(dollars);
    return `$ ${formatted}`;
}

function formatDateFromIso(isoString: string | undefined): string | undefined {
    if (!isoString) {
        return undefined;
    }
    const ms = new Date(isoString).getTime();
    if (!Number.isFinite(ms)) {
        return undefined;
    }
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateFromMs(ms: number | undefined): string | undefined {
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
        return undefined;
    }
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function todayStartMs(now: number): number {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// ── Individual endpoint fetchers ─────────────────────────────────────────────

async function fetchAuthMe(cookieString: string): Promise<AuthMeResponse> {
    return requestJson<AuthMeResponse>(
        new URL("https://cursor.com/api/auth/me"),
        "GET",
        cookieString,
    );
}

async function fetchUsageSummary(cookieString: string): Promise<UsageSummaryResponse> {
    return requestJson<UsageSummaryResponse>(
        new URL("https://cursor.com/api/usage-summary"),
        "GET",
        cookieString,
    );
}

async function fetchFilteredUsageEvents(
    teamId: number,
    userId: number,
    cookieString: string,
    now: number,
): Promise<FilteredUsageEventsResponse> {
    return requestJson<FilteredUsageEventsResponse>(
        new URL("https://cursor.com/api/dashboard/get-filtered-usage-events"),
        "POST",
        cookieString,
        JSON.stringify({
            teamId,
            startDate: String(todayStartMs(now)),
            endDate: String(now),
            userId,
            page: 1,
            pageSize: 500,
        }),
    );
}

// ── Today spend calculation ──────────────────────────────────────────────────

function sumTodaySpendCents(response: FilteredUsageEventsResponse): number {
    const events = response.usageEventsDisplay ?? [];
    let total = 0;
    for (const event of events) {
        const cents = event.tokenUsage?.totalCents;
        if (typeof cents === "number" && Number.isFinite(cents)) {
            total += cents;
        }
    }
    return Math.round(total);
}

// ── Main fetch orchestrator ──────────────────────────────────────────────────

export function clearApiCache(): void {
    cache = null;
}

export async function fetchUsageData(teamId: string, cookieString: string, now = Date.now()): Promise<UsageData> {
    const numericTeamId = Number.parseInt(teamId, 10);
    if (!Number.isFinite(numericTeamId) || numericTeamId <= 0) {
        throw new Error("Invalid team ID. Set cursorUsage.teamId in settings.");
    }

    const key = `${numericTeamId}:${cookieString}`;
    if (cache && cache.key === key && cache.expiresAt > now) {
        return cache.value;
    }

    // auth/me is required for userId + email
    const authMe = await fetchAuthMe(cookieString);
    const userId = authMe.id;

    // Fire remaining calls in parallel; each is optional
    const [summaryResult, eventsResult] = await Promise.allSettled([
        fetchUsageSummary(cookieString),
        typeof userId === "number"
            ? fetchFilteredUsageEvents(numericTeamId, userId, cookieString, now)
            : Promise.resolve(null as FilteredUsageEventsResponse | null),
    ]);

    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const events = eventsResult.status === "fulfilled" ? eventsResult.value : null;

    // Today spend from filtered events
    const todaySpendCents = events ? sumTodaySpendCents(events) : 0;

    // MTD from usage-summary (individualUsage.onDemand.used is in cents)
    const mtdSpendCents = summary?.individualUsage?.onDemand?.used ?? 0;

    // Cycle dates from usage-summary (ISO date strings)
    const cycleStartDate = formatDateFromIso(summary?.billingCycleStart);
    const cycleEndDate = formatDateFromIso(summary?.billingCycleEnd);

    const cycleEndMs = summary?.billingCycleEnd
        ? new Date(summary.billingCycleEnd).getTime()
        : undefined;
    const daysUntilCycleEnd = typeof cycleEndMs === "number" && Number.isFinite(cycleEndMs)
        ? Math.floor((cycleEndMs - now) / DAY_MS)
        : undefined;

    const usageData: UsageData = {
        userEmail: authMe.email ?? "unknown",
        todaySpendFormatted: formatSpend(todaySpendCents),
        mtdSpendFormatted: formatSpend(mtdSpendCents),
        cycleStartDate,
        cycleEndDate,
        daysUntilCycleEnd,
    };

    cache = { key, expiresAt: now + CACHE_TTL_MS, value: usageData };
    return usageData;
}

// ── Legacy parser (kept for unit tests) ──────────────────────────────────────

export function parseUsageData(response: ApiResponse, now = Date.now()): UsageData {
    const spendCents = typeof response.maxUserSpendCents === "number" ? response.maxUserSpendCents : 0;
    const nextCycleStartMs = Number(response.nextCycleStart);
    const ranked = (response.teamMemberSpend ?? [])
        .filter((member) => typeof member.spendCents === "number")
        .sort((a, b) => (b.spendCents ?? 0) - (a.spendCents ?? 0));

    return {
        userEmail: ranked[0]?.email ?? "unknown",
        todaySpendFormatted: "$ 0.00",
        mtdSpendFormatted: formatSpend(spendCents),
        cycleStartDate: undefined,
        cycleEndDate: formatDateFromMs(nextCycleStartMs),
        daysUntilCycleEnd: Number.isFinite(nextCycleStartMs) ? Math.floor((nextCycleStartMs - now) / DAY_MS) : undefined,
    };
}
