import {mkdir} from "node:fs/promises";
import {dirname, resolve} from "node:path";

import {generateTypesFile} from "./generator";

interface ParsedArgs {
    schemaPath?: string;
    socketPath?: string;
    host?: string;
    port?: number;
    tls?: boolean;
    tlsInsecure?: boolean;
    tlsServername?: string;
    tlsCaFile?: string;
    tlsCertFile?: string;
    tlsKeyFile?: string;
    databaseName?: string;
    outputPath?: string;
    databaseTypeName?: string;
    importFrom?: string;
    stdout?: boolean;
    help?: boolean;
}

/**
 * Runs the OVSDB type generation CLI.
 */
export async function runCli(argv: string[]): Promise<number> {
    const args = parseArgs(argv);

    if (args.help) {
        process.stdout.write(getHelpText());
        return 0;
    }

    if (!args.schemaPath && !args.socketPath && !args.host) {
        process.stderr.write("Missing input. Provide --schema <file>, --socket <path>, or --host <name>.\n");
        process.stderr.write(getHelpText());
        return 1;
    }

    if (!args.stdout && !args.outputPath) {
        process.stderr.write("Missing destination. Provide --out <file> or use --stdout.\n");
        process.stderr.write(getHelpText());
        return 1;
    }

    try {
        const outputPath = args.outputPath ? resolve(args.outputPath) : undefined;
        if (outputPath) {
            await mkdir(dirname(outputPath), {recursive: true});
        }

        const generated = await generateTypesFile({
            schemaPath: args.schemaPath ? resolve(args.schemaPath) : undefined,
            socketPath: args.socketPath,
            host: args.host,
            port: args.port,
            tls: args.tls,
            tlsInsecure: args.tlsInsecure,
            tlsServername: args.tlsServername,
            tlsCaFile: args.tlsCaFile ? resolve(args.tlsCaFile) : undefined,
            tlsCertFile: args.tlsCertFile ? resolve(args.tlsCertFile) : undefined,
            tlsKeyFile: args.tlsKeyFile ? resolve(args.tlsKeyFile) : undefined,
            databaseName: args.databaseName,
            outputPath,
            databaseTypeName: args.databaseTypeName,
            importFrom: args.importFrom
        });

        if (args.stdout) {
            process.stdout.write(generated);
        } else if (outputPath) {
            process.stdout.write(`Generated TypeScript types at ${outputPath}\n`);
        }

        return 0;
    } catch (error) {
        process.stderr.write(`${formatError(error)}\n`);
        return 1;
    }
}

function parseArgs(argv: string[]): ParsedArgs {
    const parsed: ParsedArgs = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        switch (arg) {
            case "--schema":
                parsed.schemaPath = requireValue(argv, ++index, arg);
                break;
            case "--socket":
                parsed.socketPath = requireValue(argv, ++index, arg);
                break;
            case "--host":
                parsed.host = requireValue(argv, ++index, arg);
                break;
            case "--port":
                parsed.port = Number.parseInt(requireValue(argv, ++index, arg), 10);
                if (Number.isNaN(parsed.port)) {
                    throw new Error("Expected --port to be a number");
                }
                break;
            case "--db":
            case "--database":
                parsed.databaseName = requireValue(argv, ++index, arg);
                break;
            case "--tls":
                parsed.tls = true;
                break;
            case "--tls-insecure":
                parsed.tlsInsecure = true;
                break;
            case "--tls-servername":
                parsed.tlsServername = requireValue(argv, ++index, arg);
                break;
            case "--tls-ca-file":
                parsed.tlsCaFile = requireValue(argv, ++index, arg);
                break;
            case "--tls-cert-file":
                parsed.tlsCertFile = requireValue(argv, ++index, arg);
                break;
            case "--tls-key-file":
                parsed.tlsKeyFile = requireValue(argv, ++index, arg);
                break;
            case "--out":
            case "--output":
                parsed.outputPath = requireValue(argv, ++index, arg);
                break;
            case "--name":
                parsed.databaseTypeName = requireValue(argv, ++index, arg);
                break;
            case "--import-from":
                parsed.importFrom = requireValue(argv, ++index, arg);
                break;
            case "--stdout":
                parsed.stdout = true;
                break;
            case "--help":
            case "-h":
                parsed.help = true;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
    const value = argv[index];
    if (!value || value.startsWith("--")) {
        throw new Error(`Expected a value after ${flag}`);
    }
    return value;
}

function getHelpText(): string {
    return [
        "Usage: ovsdb-generate [options]",
        "",
        "Inputs:",
        "  --schema <file>         Read an OVSDB schema JSON file",
        "  --socket <path>         Read schema from a live OVSDB Unix socket",
        "  --host <name>           Read schema from a live OVSDB TCP/TLS endpoint",
        "  --port <number>         Port for TCP/TLS introspection (default: 6640)",
        "  --db <name>             Database name for live introspection",
        "  --tls                   Enable TLS for live TCP connections",
        "  --tls-insecure          Disable TLS certificate verification",
        "  --tls-servername <sni>  Override TLS server name",
        "  --tls-ca-file <file>    PEM CA bundle for TLS verification",
        "  --tls-cert-file <file>  PEM client certificate for mTLS",
        "  --tls-key-file <file>   PEM client private key for mTLS",
        "",
        "Output:",
        "  --out <file>            Write generated TypeScript to a file",
        "  --stdout                Print generated TypeScript to stdout",
        "",
        "Generation:",
        "  --name <typeName>       Override generated top-level database type name",
        "  --import-from <module>  Override imported OVSDB type module",
        "",
        "Other:",
        "  -h, --help              Show this help text",
        ""
    ].join("\n");
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}
