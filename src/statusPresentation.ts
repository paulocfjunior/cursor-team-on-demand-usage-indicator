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
        const cycleRange = snapshot.usage.cycleStartDate && snapshot.usage.cycleEndDate
            ? `${snapshot.usage.cycleStartDate} - ${snapshot.usage.cycleEndDate}`
            : "cycle dates unavailable";
        const cycleLeft = typeof snapshot.usage.daysUntilCycleEnd === "number"
            ? `(${Math.max(snapshot.usage.daysUntilCycleEnd, 0)}d left)`
            : "";
        return {
            text: `$(credit-card) ${snapshot.usage.todaySpendFormatted} ${cycleLeft}`.trim(),
            tooltip: `Today: ${snapshot.usage.todaySpendFormatted} | MTD: ${snapshot.usage.mtdSpendFormatted} | Cycle: ${cycleRange}`,
        };
    }

    return {
        text: "$(key) Cursor: Login",
        tooltip: "Login to cursor.com to fetch your on-demand usage.",
    };
}
