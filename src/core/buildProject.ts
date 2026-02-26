import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getBotFolderPaths } from "../helpers/getBotFolderPaths.js";

const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

export type BuildProjectResult = {
    outputDir: string;
    entryPoint: string;
};

export type BuildProjectOptions = {
    clean?: boolean;
    hotReload?: boolean;
};

const CONFIG_CANDIDATES = [
    "snowcord.ts",
    "snowcord.js",
    "snowcord.mjs",
    "snowcord.cjs",
    "snowcord.config.ts",
    "snowcord.config.js",
    "snowcord.config.mjs",
    "snowcord.config.cjs",
    path.join("src", "snowcord.ts"),
    path.join("src", "snowcord.js"),
    path.join("src", "snowcord.config.ts"),
    path.join("src", "snowcord.config.js"),
];

const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile();
    } catch {
        return false;
    }
};

const resolveConfigPath = async (cwd: string): Promise<string> => {
    for (const candidate of CONFIG_CANDIDATES) {
        const absolutePath = path.resolve(cwd, candidate);
        if (await fileExists(absolutePath)) return absolutePath;
    }

    throw new Error(
        "Could not find Snowcord config file. Expected one of: snowcord.ts, snowcord.config.ts, or JS equivalents."
    );
};

const transpileToEsmJs = (source: string, filePath: string): string => {
    const result = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            allowJs: true,
            esModuleInterop: true,
            sourceMap: false,
            inlineSourceMap: false,
            declaration: false,
            removeComments: false,
        },
        fileName: filePath,
        reportDiagnostics: false,
    });

    return result.outputText;
};

const normalizePath = (input: string): string =>
    path.normalize(input).replace(/[\\/]+$/, "");

const resolveFrameworkRoots = (): { packageRoot: string; sourceRoot: string; distRoot: string } => {
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    const packageRoot = path.resolve(currentDir, "..", "..");
    return {
        packageRoot,
        sourceRoot: path.resolve(packageRoot, "src"),
        distRoot: path.resolve(packageRoot, "dist"),
    };
};

const rewriteSnowcordImports = (source: string, filePath: string): string => {
    const { sourceRoot, distRoot } = resolveFrameworkRoots();
    const normalizedSourceRoot = normalizePath(sourceRoot);
    const normalizedDistRoot = normalizePath(distRoot);

    const rewriteSpecifier = (specifier: string): string => {
        if (!specifier.startsWith(".")) return specifier;

        const absoluteTarget = normalizePath(path.resolve(path.dirname(filePath), specifier));
        const isFrameworkSource =
            absoluteTarget === normalizedSourceRoot ||
            absoluteTarget === `${normalizedSourceRoot}${path.sep}index` ||
            absoluteTarget.startsWith(`${normalizedSourceRoot}${path.sep}`);
        const isFrameworkDist =
            absoluteTarget === normalizedDistRoot ||
            absoluteTarget === `${normalizedDistRoot}${path.sep}index` ||
            absoluteTarget.startsWith(`${normalizedDistRoot}${path.sep}`);

        return isFrameworkSource || isFrameworkDist ? "snowcord" : specifier;
    };

    const fromRegex = /(from\s+["'])([^"']+)(["'])/g;
    const sideEffectRegex = /(import\s+["'])([^"']+)(["'])/g;

    const withFromReplaced = source.replace(fromRegex, (_match, open, specifier, close) =>
        `${open}${rewriteSpecifier(specifier)}${close}`
    );

    return withFromReplaced.replace(sideEffectRegex, (_match, open, specifier, close) =>
        `${open}${rewriteSpecifier(specifier)}${close}`
    );
};

const writeTranspiledFile = async (sourcePath: string, destinationPath: string): Promise<void> => {
    const source = await fs.readFile(sourcePath, "utf8");
    const rewrittenSource = rewriteSnowcordImports(source, sourcePath);
    const transpiled = transpileToEsmJs(rewrittenSource, sourcePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, transpiled, "utf8");
};

const copyFolderAsJs = async (sourceDir: string, destinationDir: string): Promise<void> => {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
        const sourcePath = path.resolve(sourceDir, entry.name);
        const extension = path.extname(entry.name).toLowerCase();

        if (entry.isDirectory()) {
            await copyFolderAsJs(sourcePath, path.resolve(destinationDir, entry.name));
            continue;
        }

        if (!entry.isFile()) continue;

        if (SCRIPT_EXTENSIONS.has(extension)) {
            const baseName = path.basename(entry.name, extension);
            const outputPath = path.resolve(destinationDir, `${baseName}.js`);
            await writeTranspiledFile(sourcePath, outputPath);
            continue;
        }

        await fs.mkdir(destinationDir, { recursive: true });
        await fs.copyFile(sourcePath, path.resolve(destinationDir, entry.name));
    }
};

const copyDirectory = async (sourceDir: string, destinationDir: string): Promise<void> => {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    await fs.mkdir(destinationDir, { recursive: true });

    for (const entry of entries) {
        const sourcePath = path.resolve(sourceDir, entry.name);
        const destinationPath = path.resolve(destinationDir, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(sourcePath, destinationPath);
            continue;
        }

        if (entry.isFile()) {
            await fs.copyFile(sourcePath, destinationPath);
        }
    }
};

const writeRuntimeLibrary = async (outputDir: string): Promise<void> => {
    const { packageRoot, distRoot } = resolveFrameworkRoots();
    const requiredRuntimeFile = path.resolve(distRoot, "core", "overwriteEvents", "interactionCreate.js");
    if (!(await fileExists(requiredRuntimeFile))) {
        throw new Error(
            `Snowcord runtime is incomplete (${requiredRuntimeFile} missing). Run "pnpm build" in the Snowcord project first.`
        );
    }

    const shimDir = path.resolve(outputDir, "node_modules", "snowcord");
    await fs.mkdir(shimDir, { recursive: true });

    await copyDirectory(distRoot, shimDir);

    const packageJsonPath = path.resolve(packageRoot, "package.json");
    let packageJson = { name: "snowcord", main: "./index.js" } as Record<string, unknown>;

    try {
        const parsed = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
        packageJson = {
            name: parsed.name ?? "snowcord",
            version: parsed.version ?? "0.0.0",
            type: parsed.type ?? "module",
            main: "./index.js",
            types: "./index.d.ts",
            dependencies: parsed.dependencies ?? {},
        };
    } catch {
        // fallback to minimal runtime package metadata
        packageJson = {
            ...packageJson,
            type: "module",
        };
    }

    await fs.writeFile(path.resolve(shimDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
};

const writeBuildEntrypoint = async (outputDir: string): Promise<string> => {
    const entryPoint = path.resolve(outputDir, "index.js");
    const source = [
        'import "snowcord/snowcord.config.js";',
        'import { launch, logger } from "snowcord";',
        "let runtimeHandle;",
        "const sendIpc = (payload) => { if (process.send) process.send(payload); };",
        "const withAction = async (requestId, fn) => {",
        "  try {",
        "    await fn();",
        "    sendIpc({ type: \"snowcord:action:ok\", requestId });",
        "  } catch (error) {",
        "    sendIpc({ type: \"snowcord:action:error\", requestId, error: String(error) });",
        "  }",
        "};",
        "try {",
        `  runtimeHandle = await launch(${JSON.stringify(outputDir)});`,
        "} catch (error) {",
        '  logger.error("[runtime] launch failed:", error);',
        "  process.exit(1);",
        "}",
        "",
        "process.on(\"message\", async (message) => {",
        "  if (!message || typeof message !== \"object\") return;",
        "  const requestId = message.requestId;",
        "  if (message.type === \"snowcord:reload\") {",
        "    await withAction(requestId, async () => {",
        "      await runtimeHandle?.reload?.();",
        "      sendIpc({ type: \"snowcord:reloaded\" });",
        "    });",
        "    return;",
        "  }",
        "  if (message.type === \"snowcord:reload-lazy\") {",
        "    await withAction(requestId, async () => {",
        "      await runtimeHandle?.reloadLazy?.();",
        "    });",
        "    return;",
        "  }",
        "  if (message.type === \"snowcord:reload-full\") {",
        "    await withAction(requestId, async () => {",
        "      await runtimeHandle?.fullReload?.();",
        "    });",
        "    return;",
        "  }",
        "  if (message.type === \"snowcord:restart-worker\") {",
        "    await withAction(requestId, async () => {",
        "      await runtimeHandle?.restartWorker?.(message.workerId);",
        "    });",
        "    return;",
        "  }",
        "  if (message.type === \"snowcord:restart-shard\") {",
        "    await withAction(requestId, async () => {",
        "      await runtimeHandle?.restartShard?.(message.shardId);",
        "    });",
        "    return;",
        "  }",
        "  if (message.type === \"snowcord:count\") {",
        "    await withAction(requestId, async () => {",
        "      const counts = await runtimeHandle?.getCounts?.();",
        "      sendIpc({ type: \"snowcord:count:result\", requestId, counts });",
        "    });",
        "    return;",
        "  }",
        "  if (message.type === \"snowcord:shutdown\") {",
        "    await runtimeHandle?.stop?.();",
        "    process.exit(0);",
        "  }",
        "});",
        "",
    ].join("\n");
    await fs.writeFile(entryPoint, source, "utf8");
    return entryPoint;
};

const prepareOutputDirectory = async (outputDir: string): Promise<void> => {
    await fs.rm(outputDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
    });
    await fs.mkdir(outputDir, { recursive: true });
};

export const buildSnowcordProject = async (
    cwd: string = process.cwd(),
    options: BuildProjectOptions = {}
): Promise<BuildProjectResult> => {
    const paths = await getBotFolderPaths(cwd);
    const configPath = await resolveConfigPath(cwd);
    const outputDir = path.resolve(cwd, ".snowcord", "build");
    const clean = options.clean ?? true;
    const hotReload = options.hotReload ?? false;

    if (clean) {
        await prepareOutputDirectory(outputDir);
    } else {
        await fs.mkdir(outputDir, { recursive: true });
        await fs.rm(path.resolve(outputDir, "commands"), { recursive: true, force: true });
        await fs.rm(path.resolve(outputDir, "events"), { recursive: true, force: true });
    }

    if (clean || !hotReload) {
        await writeRuntimeLibrary(outputDir);
    }

    await writeTranspiledFile(
        configPath,
        path.resolve(outputDir, "node_modules", "snowcord", "snowcord.config.js")
    );

    if (paths.commandsPath) {
        await copyFolderAsJs(paths.commandsPath, path.resolve(outputDir, "commands"));
    }

    if (paths.eventsPath) {
        await copyFolderAsJs(paths.eventsPath, path.resolve(outputDir, "events"));
    }

    const existingEntryPoint = path.resolve(outputDir, "index.js");
    const entryPoint =
        hotReload && (await fileExists(existingEntryPoint))
            ? existingEntryPoint
            : await writeBuildEntrypoint(outputDir);

    return { outputDir, entryPoint };
};
