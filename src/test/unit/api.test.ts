import * as assert from "assert";
import { formatSpend, parseUsageData } from "../../api";
import { ApiResponse } from "../../types";

describe("api parsing", () => {
    it("formatSpend formats cents into dollars", () => {
        assert.strictEqual(formatSpend(132012), "$ 1,320.12");
    });

    it("parseUsageData returns renewal description with future cycle date", () => {
        const now = new Date("2026-02-13T00:00:00.000Z").getTime();
        const nextCycleStart = new Date("2026-02-16T12:00:00.000Z").getTime();

        const response: ApiResponse = {
            totalMembers: 1,
            maxUserSpendCents: 132012,
            nextCycleStart,
            teamMemberSpend: [
                {
                    email: "user@example.com",
                    name: "User Example",
                    spendCents: 132012,
                },
            ],
        };

        const usage = parseUsageData(response, now);
        assert.strictEqual(usage.mtdSpendFormatted, "$ 1,320.12");
        assert.strictEqual(usage.todaySpendFormatted, "$ 0.00");
        assert.strictEqual(usage.userEmail, "user@example.com");
        assert.strictEqual(usage.daysUntilCycleEnd, 3);
        assert.strictEqual(usage.cycleEndDate, "Feb 16");
    });

    it("parseUsageData marks overdue cycles", () => {
        const now = new Date("2026-02-20T00:00:00.000Z").getTime();
        const nextCycleStart = new Date("2026-02-16T12:00:00.000Z").getTime();
        const response: ApiResponse = {
            totalMembers: 1,
            maxUserSpendCents: 100,
            nextCycleStart,
            teamMemberSpend: [],
        };

        const usage = parseUsageData(response, now);
        assert.strictEqual(usage.daysUntilCycleEnd, -4);
    });
});
