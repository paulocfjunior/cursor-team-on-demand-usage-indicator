import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import WebSocket = require("ws");

type JsonVersionResponse = {
    webSocketDebuggerUrl?: string;
};

type CdpCookiesResponse = {
    result?: {
        cookies?: Array<{
            name?: string;
            value?: string;
            domain?: string;
        }>;
    };
};

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
                    resolve(parsed);
                } catch (error) {
                    reject(new Error(`Could not parse JSON from ${url}: ${String(error)}`));
                }
            });
        });

        req.on("error", reject);
    });
}

async function waitForWsUrl(port: number, timeoutMs = 15_000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const version = await httpGetJson<JsonVersionResponse>(`http://127.0.0.1:${port}/json/version`);
            if (version.webSocketDebuggerUrl) {
                return version.webSocketDebuggerUrl;
            }
        } catch {
            // Retry until timeout.
        }
        await delay(500);
    }

    throw new Error("Timed out waiting for Chrome DevTools endpoint.");
}

function buildCookieString(response: CdpCookiesResponse): string {
    const cookies = response.result?.cookies ?? [];
    const session = cookies.find(
        (cookie) => cookie.name === "WorkosCursorSessionToken" && cookie.domain?.includes("cursor.com"),
    )?.value;
    const teamId = cookies.find((cookie) => cookie.name === "team_id" && cookie.domain?.includes("cursor.com"))?.value;

    if (!session) {
        throw new Error("Could not find WorkosCursorSessionToken cookie.");
    }

    return teamId ? `WorkosCursorSessionToken=${session}; team_id=${teamId}` : `WorkosCursorSessionToken=${session}`;
}

async function extractCookies(wsUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.on("open", () => {
            ws.send(JSON.stringify({ id: 1, method: "Storage.getCookies", params: {} }));
        });

        ws.on("message", (data) => {
            try {
                const parsed = JSON.parse(data.toString("utf8")) as CdpCookiesResponse;
                const cookieString = buildCookieString(parsed);
                resolve(cookieString);
                ws.close();
            } catch (error) {
                reject(error);
                ws.close();
            }
        });

        ws.on("error", reject);
    });
}

export function findChromePath(): string {
    const candidates = process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : process.platform === "win32"
            ? [
                `${process.env["PROGRAMFILES"] ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
                `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
            ]
            : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"];

    const candidate = candidates.find((item) => item.length > 0 && fsSync.existsSync(item));
    if (!candidate) {
        throw new Error("Google Chrome was not found on this machine.");
    }
    return candidate;
}

export class CdpLoginSession {
    private readonly chromeProcess: ChildProcess;
    private readonly tempProfileDir: string;
    private readonly port: number;
    private closed = false;

    private constructor(chromeProcess: ChildProcess, tempProfileDir: string, port: number) {
        this.chromeProcess = chromeProcess;
        this.tempProfileDir = tempProfileDir;
        this.port = port;
    }

    static async start(chromePath?: string): Promise<CdpLoginSession> {
        const selectedChromePath = chromePath ?? findChromePath();
        const tempProfileDir = path.join(os.tmpdir(), `cursor-usage-${randomUUID()}`);
        await fs.mkdir(tempProfileDir, { recursive: true });
        const port = 9222;

        const chromeProcess = spawn(
            selectedChromePath,
            [
                `--remote-debugging-port=${port}`,
                `--user-data-dir=${tempProfileDir}`,
                "https://cursor.com/dashboard?tab=usage",
            ],
            { detached: false, stdio: "ignore" },
        );

        return new CdpLoginSession(chromeProcess, tempProfileDir, port);
    }

    async finish(): Promise<string> {
        const wsUrl = await waitForWsUrl(this.port);
        const cookies = await extractCookies(wsUrl);
        await this.cleanup();
        return cookies;
    }

    async cleanup(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.chromeProcess.kill();
        await delay(250);
        await fs.rm(this.tempProfileDir, { recursive: true, force: true });
    }
}
