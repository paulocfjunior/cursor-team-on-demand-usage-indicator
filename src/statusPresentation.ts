import { StatusSnapshot } from "./types";

export function getStatusBarPresentation(snapshot: StatusSnapshot): { text: string; tooltip: string } {
    if (snapshot.kind === "setup") {
        return {
            text: "$(gear) Cursor: Setup",
            tooltip: "Set cursorUsage.teamId to start tracking Cursor usage.",
        };
    }

    if (snapshot.kind === "loading") {
        return {
            text: "$(sync~spin) Cursor Usage...",
            tooltip: "Refreshing Cursor on-demand usage.",
        };
    }

    if (snapshot.kind === "error") {
        return {
            text: "$(warning) Cursor: Error",
            tooltip: snapshot.message ?? "Could not fetch Cursor usage data.",
        };
    }

    if (snapshot.kind === "ready" && snapshot.usage) {
        const daysUntilRenewal = Math.max(snapshot.usage.daysUntilRenewal, 0);
        return {
            text: `$(credit-card) ${snapshot.usage.spendFormatted} (${daysUntilRenewal}d cycle end)`,
            tooltip: `Cursor: ${snapshot.usage.spendFormatted} | Renews ${snapshot.usage.cycleRenewsDate}`,
        };
    }

    return {
        text: "$(key) Cursor: Login",
        tooltip: "Login to cursor.com to fetch your on-demand usage.",
    };
}
