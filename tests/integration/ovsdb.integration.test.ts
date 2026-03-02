import {beforeAll, describe, expect, test} from "vitest";

import {OVSDBClient, OvsdbTransactionError} from "../../src";
import {fetchSchemaFromOvsdb} from "../../src/generator";

const runIntegration = process.env.OVSDB_INTEGRATION === "1";
const ovsdbHost = process.env.OVSDB_HOST ?? "127.0.0.1";
const ovsdbPort = Number.parseInt(process.env.OVSDB_PORT ?? "6640", 10);

describe.runIf(runIntegration)("OVSDB integration", () => {
    beforeAll(async () => {
        let lastError: unknown;

        for (let attempt = 0; attempt < 30; attempt += 1) {
            const client = new OVSDBClient({
                host: ovsdbHost,
                port: ovsdbPort,
                timeout: 1000
            });

            try {
                await client.connect();
                await client.listDbs();
                await client.close();
                return;
            } catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        throw lastError;
    }, 35_000);

    test("lists databases and fetches the live schema over tcp", async () => {
        const client = new OVSDBClient({
            host: ovsdbHost,
            port: ovsdbPort,
            timeout: 2000
        });

        try {
            await client.connect();

            await expect(client.listDbs()).resolves.toContain("Open_vSwitch");

            const schema = await client.getSchema("Open_vSwitch");
            expect(schema.name).toBe("Open_vSwitch");
            expect(schema.tables.Bridge).toBeDefined();
        } finally {
            await client.close();
        }
    });

    test("supports the staged transaction helper against a live server", async () => {
        const client = new OVSDBClient({
            host: ovsdbHost,
            port: ovsdbPort,
            timeout: 2000
        });

        try {
            await client.connect();

            const outcome = await client.transaction("Open_vSwitch", (transaction) => {
                transaction.comment("integration select");
                transaction.select({
                    op: "select",
                    table: "Bridge",
                    where: [],
                    columns: ["name"]
                });

                return "ok";
            });

            expect(outcome.value).toBe("ok");
            expect(outcome.operations.at(-1)).toEqual({
                op: "commit",
                durable: false
            });
            expect(outcome.results).toHaveLength(3);
        } finally {
            await client.close();
        }
    });

    test("rejects staged transactions on operation-level ovsdb errors", async () => {
        const client = new OVSDBClient({
            host: ovsdbHost,
            port: ovsdbPort,
            timeout: 2000
        });

        try {
            await client.connect();

            await expect(client.transaction("Open_vSwitch", (transaction) => {
                transaction.select({
                    op: "select",
                    table: "MissingTable",
                    where: [],
                    columns: ["name"]
                });
            })).rejects.toBeInstanceOf(OvsdbTransactionError);
        } finally {
            await client.close();
        }
    });

    test("generator can fetch the live schema over tcp", async () => {
        const schema = await fetchSchemaFromOvsdb({
            host: ovsdbHost,
            port: ovsdbPort,
            databaseName: "Open_vSwitch"
        });

        expect(schema.name).toBe("Open_vSwitch");
        expect(schema.tables.Open_vSwitch).toBeDefined();
    });
});
