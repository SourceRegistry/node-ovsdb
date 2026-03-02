import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, test} from "vitest";

import {runCli} from "../src/cli";
import {createGeneratorClientOptions, generateTypesFromSchema} from "../src/generator";
import type {DatabaseSchema} from "../src/types";

const schema: DatabaseSchema = {
    name: "Open_vSwitch",
    version: "8.3.1",
    tables: {
        Bridge: {
            columns: {
                name: {type: "string"},
                ports: {
                    type: {
                        key: {
                            type: "uuid",
                            refTable: "Port",
                            refType: "strong"
                        },
                        min: 0,
                        max: "unlimited"
                    }
                },
                datapath_type: {
                    type: {
                        key: {
                            type: "string",
                            enum: ["set", ["netdev", "system"]]
                        },
                        min: 0,
                        max: 1
                    }
                }
            }
        },
        Interface: {
            columns: {
                name: {type: "string"},
                options: {
                    type: {
                        key: "string",
                        value: "string",
                        min: 0,
                        max: "unlimited"
                    }
                }
            }
        }
    }
};

describe("generateTypesFromSchema", () => {
    test("renders database, row, set, map, and enum types", () => {
        const output = generateTypesFromSchema({schema});

        expect(output).toContain("export interface BridgeRow");
        expect(output).toContain("ports?: OvsSet<Uuid>;");
        expect(output).toContain("datapath_type?: OvsSet<\"netdev\" | \"system\">;");
        expect(output).toContain("options?: OvsMap<string, string>;");
        expect(output).toContain("export interface OpenVSwitchDatabase");
    });
});

describe("runCli", () => {
    test("writes generated output from a schema file", async () => {
        const directory = await mkdtemp(join(tmpdir(), "ovsdb-generate-"));
        const schemaPath = join(directory, "schema.json");
        const outputPath = join(directory, "ovsdb.types.ts");

        await writeFile(schemaPath, JSON.stringify(schema), "utf8");

        const exitCode = await runCli([
            "--schema",
            schemaPath,
            "--out",
            outputPath,
            "--name",
            "GeneratedDb"
        ]);

        expect(exitCode).toBe(0);

        const written = await readFile(outputPath, "utf8");
        expect(written).toContain("export interface GeneratedDb");
    });
});

describe("createGeneratorClientOptions", () => {
    test("builds tcp options for live schema introspection", async () => {
        await expect(createGeneratorClientOptions({
            host: "127.0.0.1",
            port: 6640
        })).resolves.toEqual({
            host: "127.0.0.1",
            port: 6640,
            tls: undefined,
            tlsOptions: {
                servername: "127.0.0.1",
                rejectUnauthorized: undefined,
                ca: undefined,
                cert: undefined,
                key: undefined
            }
        });
    });

    test("builds tls options with file-backed certificates", async () => {
        const directory = await mkdtemp(join(tmpdir(), "ovsdb-generate-tls-"));
        const caPath = join(directory, "ca.pem");
        const certPath = join(directory, "client.pem");
        const keyPath = join(directory, "client.key");

        await writeFile(caPath, "CA DATA", "utf8");
        await writeFile(certPath, "CERT DATA", "utf8");
        await writeFile(keyPath, "KEY DATA", "utf8");

        await expect(createGeneratorClientOptions({
            host: "ovsdb.internal",
            port: 6641,
            tls: true,
            tlsInsecure: true,
            tlsServername: "ovsdb.internal",
            tlsCaFile: caPath,
            tlsCertFile: certPath,
            tlsKeyFile: keyPath
        })).resolves.toEqual({
            host: "ovsdb.internal",
            port: 6641,
            tls: true,
            tlsOptions: {
                servername: "ovsdb.internal",
                rejectUnauthorized: false,
                ca: "CA DATA",
                cert: "CERT DATA",
                key: "KEY DATA"
            }
        });
    });
});
