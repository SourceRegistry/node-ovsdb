import {Duplex} from "node:stream";

import {describe, expect, test, vi} from "vitest";

import {OVSDBClient, OvsdbProtocolError, OvsdbRpcError, OvsdbTransactionError, type OvsdbStream, resolveConnectionOptions} from "../src";
import type {DatabaseOperation, OvsSet, OvsdbNotification, UpdateNotification} from "../src";

type TestSchema = {
    Bridge: {
        name: string;
        ports: OvsSet<string>;
    };
};

class MockSocket extends Duplex {
    public readonly writes: string[] = [];
    public readonly connectEvent: "connect" | "secureConnect";

    constructor(connectEvent: "connect" | "secureConnect" = "connect") {
        super();
        this.connectEvent = connectEvent;
    }

    public connectNow(): void {
        this.emit(this.connectEvent);
    }

    public sendMessage(payload: unknown): void {
        this.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"));
    }

    public sendRaw(chunk: string): void {
        this.emit("data", Buffer.from(chunk, "utf8"));
    }

    public closeNow(): void {
        this.emit("close");
    }

    public override _read(): void {
    }

    public override _write(
        chunk: string | Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void
    ): void {
        this.writes.push(chunk.toString());
        callback();
    }
}

const nextTick = async (): Promise<void> => {
    await Promise.resolve();
};

const createConnectionFactory = (socket: MockSocket): (() => OvsdbStream) => {
    return () => socket;
};

describe("OVSDBClient", () => {
    test("resolves unix socket connections by default", () => {
        expect(resolveConnectionOptions({socketPath: "/tmp/ovs.sock"})).toEqual({
            transport: "unix",
            socketPath: "/tmp/ovs.sock"
        });
    });

    test("resolves plain TCP connection settings", () => {
        expect(resolveConnectionOptions({
            host: "127.0.0.1",
            port: 6640
        })).toEqual({
            transport: "tcp",
            host: "127.0.0.1",
            port: 6640
        });
    });

    test("resolves TLS connection settings", () => {
        expect(resolveConnectionOptions({
            host: "ovsdb.local",
            port: 6640,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false,
                servername: "ovsdb.local"
            }
        })).toEqual({
            transport: "tls",
            host: "ovsdb.local",
            port: 6640,
            tlsOptions: {
                host: "ovsdb.local",
                port: 6640,
                rejectUnauthorized: false,
                servername: "ovsdb.local"
            }
        });
    });

    test("sends requests and resolves typed responses", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const requestPromise = client.listDbs();
        const request = JSON.parse(socket.writes[0]);
        expect(request.method).toBe("list_dbs");
        socket.sendMessage({
            id: request.id,
            error: null,
            result: ["Open_vSwitch", "hardware_vtep"]
        });

        await expect(requestPromise).resolves.toEqual(["Open_vSwitch", "hardware_vtep"]);
    });

    test("supports tuple inference for transact results", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const operations = [
            {
                op: "select",
                table: "Bridge",
                where: [["name", "==", "br-int"]],
                columns: ["name"]
            },
            {
                op: "insert",
                table: "Bridge",
                row: {name: "br-new"}
            }
        ] satisfies [DatabaseOperation<TestSchema>, DatabaseOperation<TestSchema>];

        const resultPromise = client.transact("Open_vSwitch", operations);
        const request = JSON.parse(socket.writes[0]);
        expect(request.method).toBe("transact");

        socket.sendMessage({
            id: request.id,
            error: null,
            result: [
                {rows: [{name: "br-int", ports: ["set", []]}]},
                {uuid: ["uuid", "00000000-0000-0000-0000-000000000001"]}
            ]
        });

        await expect(resultPromise).resolves.toEqual([
            {rows: [{name: "br-int", ports: ["set", []]}]},
            {uuid: ["uuid", "00000000-0000-0000-0000-000000000001"]}
        ]);
    });

    test("buffers partial frames until a newline is received", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const requestPromise = client.echo("ping");
        const request = JSON.parse(socket.writes[0]);

        socket.sendRaw(`{"id":${request.id},"error":null,"result":["`);
        socket.sendRaw(`ping"]}\n`);

        await expect(requestPromise).resolves.toEqual(["ping"]);
    });

    test("parses adjacent json messages without newline framing", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const requestPromise = client.listDbs();
        const request = JSON.parse(socket.writes[0]);

        socket.sendRaw(
            `{"id":${request.id},"error":null,"result":["Open_vSwitch"]}` +
            `{"method":"update","params":["monitor-1",{"Bridge":{}}],"id":null}`
        );

        await expect(requestPromise).resolves.toEqual(["Open_vSwitch"]);
    });

    test("emits typed notifications", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const updateListener = vi.fn<(notification: UpdateNotification<TestSchema>) => void>();
        const notificationListener = vi.fn<(notification: OvsdbNotification<TestSchema>) => void>();
        client.on("update", updateListener);
        client.on("notification", notificationListener);

        socket.sendMessage({
            method: "update",
            params: [
                "monitor-1",
                {
                    Bridge: {
                        row1: {
                            new: {
                                name: "br-int",
                                ports: ["set", []]
                            }
                        }
                    }
                }
            ],
            id: null
        });

        await nextTick();

        expect(updateListener).toHaveBeenCalledTimes(1);
        expect(notificationListener).toHaveBeenCalledTimes(1);
    });

    test("automatically responds to server echo requests", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        socket.sendMessage({
            method: "echo",
            params: ["keepalive"],
            id: 42
        });

        await nextTick();

        expect(JSON.parse(socket.writes[0])).toEqual({
            id: 42,
            result: ["keepalive"],
            error: null
        });
    });

    test("wraps server-side RPC errors", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const requestPromise = client.getSchema("Open_vSwitch");
        const request = JSON.parse(socket.writes[0]);

        socket.sendMessage({
            id: request.id,
            error: {
                error: "permission denied",
                details: "monitor access rejected"
            }
        });

        await expect(requestPromise).rejects.toBeInstanceOf(OvsdbRpcError);
    });

    test("emits protocol errors for malformed frames", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const protocolErrorListener = vi.fn();
        client.on("protocolError", protocolErrorListener);

        socket.sendRaw("not-json\n");

        await nextTick();

        expect(protocolErrorListener).toHaveBeenCalledTimes(1);
        expect(protocolErrorListener.mock.calls[0]?.[0]).toBeInstanceOf(OvsdbProtocolError);
    });

    test("rejects pending requests when the connection closes", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const requestPromise = client.listDbs();
        socket.closeNow();

        await expect(requestPromise).rejects.toThrow("Connection closed");
    });

    test("times out requests that do not receive a response", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient({
            timeout: 10,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        await expect(client.listDbs()).rejects.toThrow("Request timeout for method: list_dbs");
    });

    test("stages operations and auto-commits when the callback succeeds", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const transactionPromise = client.transaction("Open_vSwitch", (transaction) => {
            transaction.select({
                op: "select",
                table: "Bridge",
                where: [["name", "==", "br-int"]],
                columns: ["name"]
            });
            transaction.comment("lookup bridge");
            return "done";
        });

        await nextTick();

        const request = JSON.parse(socket.writes[0]);
        expect(request.method).toBe("transact");
        expect(request.params[1].op).toBe("select");
        expect(request.params[2].op).toBe("comment");
        expect(request.params[3]).toEqual({
            op: "commit",
            durable: false
        });

        socket.sendMessage({
            id: request.id,
            error: null,
            result: [
                {rows: [{name: "br-int", ports: ["set", []]}]},
                {},
                {}
            ]
        });

        await expect(transactionPromise).resolves.toEqual({
            value: "done",
            operations: [
                {
                    op: "select",
                    table: "Bridge",
                    where: [["name", "==", "br-int"]],
                    columns: ["name"]
                },
                {
                    op: "comment",
                    comment: "lookup bridge"
                },
                {
                    op: "commit",
                    durable: false
                }
            ],
            results: [
                {rows: [{name: "br-int", ports: ["set", []]}]},
                {},
                {}
            ]
        });
    });

    test("rejects staged transactions when an operation result is an ovsdb error", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const transactionPromise = client.transaction("Open_vSwitch", (transaction) => {
            transaction.select({
                op: "select",
                table: "Bridge",
                where: [["name", "==", "missing"]],
                columns: ["name"]
            });
        });

        await nextTick();

        const request = JSON.parse(socket.writes[0]);
        socket.sendMessage({
            id: request.id,
            error: null,
            result: [
                {
                    error: "constraint violation",
                    details: "bridge lookup failed"
                },
                {}
            ]
        });

        await expect(transactionPromise).rejects.toBeInstanceOf(OvsdbTransactionError);
    });

    test("does not submit a transaction when the callback throws", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        await expect(client.transaction("Open_vSwitch", () => {
            throw new Error("stop");
        })).rejects.toThrow("stop");

        expect(socket.writes).toHaveLength(0);
    });

    test("does not append a second commit when one is staged explicitly", async () => {
        const socket = new MockSocket();
        const client = new OVSDBClient<TestSchema>({
            timeout: 100,
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        const transactionPromise = client.transaction("Open_vSwitch", (transaction) => {
            transaction.commit(true);
        });

        await nextTick();

        const request = JSON.parse(socket.writes[0]);
        expect(request.params).toEqual([
            "Open_vSwitch",
            {
                op: "commit",
                durable: true
            }
        ]);

        socket.sendMessage({
            id: request.id,
            error: null,
            result: [{}]
        });

        await expect(transactionPromise).resolves.toEqual({
            value: undefined,
            operations: [
                {
                    op: "commit",
                    durable: true
                }
            ],
            results: [{}]
        });
    });

    test("passes resolved TCP options into the connection factory", async () => {
        const socket = new MockSocket();
        let resolvedOptions: unknown;
        const client = new OVSDBClient({
            host: "127.0.0.1",
            port: 6640,
            connectionFactory: (options) => {
                resolvedOptions = options;
                return socket
            }
        });

        const connectPromise = client.connect();
        socket.connectNow();
        await connectPromise;

        expect(resolvedOptions).toEqual({
            transport: "tcp",
            host: "127.0.0.1",
            port: 6640
        });
    });

    test("waits for secureConnect when TLS is enabled", async () => {
        const socket = new MockSocket("secureConnect");
        const client = new OVSDBClient({
            host: "127.0.0.1",
            port: 6640,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false
            },
            connectionFactory: createConnectionFactory(socket)
        });

        const connectPromise = client.connect();
        socket.connectNow();

        await expect(connectPromise).resolves.toBe(client);
        expect(client.isConnected).toBe(true);
    });
});
