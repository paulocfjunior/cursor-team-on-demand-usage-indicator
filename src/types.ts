export interface TeamMemberSpend {
    email?: string;
    name?: string;
    spendCents?: number | null;
}

export interface ApiResponse {
    totalMembers: number;
    maxUserSpendCents: number;
    nextCycleStart: number;
    teamMemberSpend: TeamMemberSpend[];
}

export interface UsageData {
    userEmail: string;
    todaySpendFormatted: string;
    mtdSpendFormatted: string;
    cycleStartDate?: string;
    cycleEndDate?: string;
    daysUntilCycleEnd?: number;
}

export type RefreshIntervalSeconds = 10 | 15 | 30 | 60;

export type StatusKind = "setup" | "loading" | "login" | "ready" | "error";

export interface StatusSnapshot {
    kind: StatusKind;
    usage?: UsageData;
    message?: string;
}
