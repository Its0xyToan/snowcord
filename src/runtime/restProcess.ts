import { createServer } from "node:http";
import { createRestManager } from "@discordeno/bot";
import type { RequestMethods } from "@discordeno/bot";
import logger from "../logger.js";
import { RuntimeRestConfig } from "./types.js";

type RestWorkerEnv = {
    token: string;
    config: RuntimeRestConfig;
};

const readEnv = (): RestWorkerEnv => {
    const raw = process.env.SC_RUNTIME_REST_ENV;
    if (!raw) {
        throw new Error("Missing SC_RUNTIME_REST_ENV");
    }
    return JSON.parse(raw) as RestWorkerEnv;
};

const readBody = async (request: NodeJS.ReadableStream): Promise<unknown> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        request.on("error", reject);
        request.on("end", () => {
            if (chunks.length === 0) {
                resolve(undefined);
                return;
            }

            const raw = Buffer.concat(chunks).toString("utf8");
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve(raw);
            }
        });
    });

const normalizeDiscordPath = (url: string): string => {
    if (url.startsWith("/v")) {
        const slashIndex = url.indexOf("/", 2);
        return slashIndex === -1 ? "/" : url.slice(slashIndex);
    }
    return url;
};

const main = async (): Promise<void> => {
    const env = readEnv();
    const rest = createRestManager({
        token: env.token,
    });

    const server = createServer(async (request, response) => {
        const auth = request.headers.authorization;
        if (auth !== env.config.authorization) {
            response.statusCode = 401;
            response.end(JSON.stringify({ error: "Unauthorized" }));
            return;
        }

        if (!request.url) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "Missing URL" }));
            return;
        }

        if (request.method === "GET" && request.url === "/timecheck") {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ message: Date.now() }));
            return;
        }

        try {
            const method = (request.method ?? "GET") as RequestMethods;
            const path = normalizeDiscordPath(request.url);
            const body = method === "GET" || method === "DELETE" ? undefined : await readBody(request);
            const result = await rest.makeRequest(method, path, { body });

            response.statusCode = result ? 200 : 204;
            response.setHeader("Content-Type", "application/json");
            response.end(result ? JSON.stringify(result) : "{}");
        } catch (error) {
            logger.error("[rest] request failed:", error);
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Request failed" }));
        }
    });

    server.listen(env.config.port, env.config.host, () => {
        logger.info(`[rest] worker listening on ${env.config.host}:${env.config.port}`);
        process.send?.({ type: "runtime:rest:ready" });
    });

    process.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const data = message as { type?: string };
        if (data.type !== "runtime:shutdown") return;

        server.close(() => process.exit(0));
    });
};

void main().catch((error) => {
    logger.error("[rest] worker failed:", error);
    process.exit(1);
});
