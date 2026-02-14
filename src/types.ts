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
    spendFormatted: string;
    cycleRenewsDate: string;
    daysUntilRenewal: number;
    renewalDescription: string;
}

export type RefreshIntervalSeconds = 10 | 15 | 30 | 60;

export type StatusKind = "setup" | "loading" | "login" | "ready" | "error";

export interface StatusSnapshot {
    kind: StatusKind;
    usage?: UsageData;
    message?: string;
}
