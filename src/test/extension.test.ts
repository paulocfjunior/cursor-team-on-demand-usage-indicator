import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension smoke tests", () => {
    test("registers all cursor usage commands", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("cursorUsage.showMenu"));
        assert.ok(commands.includes("cursorUsage.refresh"));
        assert.ok(commands.includes("cursorUsage.login"));
        assert.ok(commands.includes("cursorUsage.pasteCookie"));
        assert.ok(commands.includes("cursorUsage.logout"));
    });

    test("refresh command executes without throwing", async () => {
        await vscode.commands.executeCommand("cursorUsage.refresh");
    });
});
