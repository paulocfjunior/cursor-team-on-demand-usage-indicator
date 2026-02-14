import * as assert from "assert";
import { getStatusBarPresentation } from "../../statusPresentation";

describe("status bar presentation", () => {
    it("shows setup text when missing configuration", () => {
        const result = getStatusBarPresentation({ kind: "setup" });
        assert.strictEqual(result.text, "$(gear) Cursor: Setup");
    });

    it("shows login text when not authenticated", () => {
        const result = getStatusBarPresentation({ kind: "login" });
        assert.strictEqual(result.text, "$(key) Cursor: Login");
    });

    it("shows formatted usage text when authenticated", () => {
        const result = getStatusBarPresentation({
            kind: "ready",
            usage: {
                userEmail: "user@example.com",
                todaySpendFormatted: "$ 42.10",
                mtdSpendFormatted: "$ 1,320.12",
                cycleStartDate: "Jan 16",
                cycleEndDate: "Feb 16",
                daysUntilCycleEnd: 2,
            },
        });
        assert.strictEqual(result.text, "$(credit-card) $ 42.10 (2d left)");
    });
});
