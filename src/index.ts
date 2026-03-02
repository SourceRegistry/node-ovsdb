import {existsSync} from "node:fs";
import {createConnection as createNetConnection, Socket} from "node:net";
import {EventEmitter} from "node:events";
import {Duplex} from "node:stream";
import {connect as connectTls, TLSSocket} from "node:tls";
import type {ConnectionOptions as TlsConnectionOptions} from "node:tls";

import type {
    AbortOperation,
    AssertOperation,
    CommentOperation,
    CommitOperation,
    DatabaseOperation,
    DatabaseSchema,
    DatabaseTableMap,
    DeleteOperation,
    InsertOperation,
    JsonObject,
    JsonValue,
    ListDbsResult,
    LockedNotification,
    MutateOperation,
    MonitorCondRequest,
    MonitorCondSinceResult,
    MonitorRequest,
    OperationResult,
    OperationResults,
    OvsdbError,
    OvsdbNotification,
    OvsdbResponse,
    OvsdbValue,
    SelectOperation,
    StolenNotification,
    TableUpdates,
    TableUpdates2,
    Update2Notification,
    Update3Notification,
    UpdateNotification,
    UpdateOperation,
    WaitOperation
} from "./types";

/**
 * A socket-compatible stream used by the client transport.
 */
export type OvsdbStream = Duplex | Socket | TLSSocket;

/**
 * Supported connection modes for the OVSDB transport.
 */
export type OvsdbTransportKind = "unix" | "tcp" | "tls";

/**
 * Resolved Unix socket transport settings.
 */
export interface OvsdbUnixConnectionOptions {
    transport: "unix";
    socketPath: string;
}

/**
 * Resolved TCP transport settings.
 */
export interface OvsdbTcpConnectionOptions {
    transport: "tcp";
    host: string;
    port: number;
}

/**
 * Resolved TLS transport settings.
 */
export interface OvsdbTlsTransportOptions {
    transport: "tls";
    host: string;
    port: number;
    tlsOptions: TlsConnectionOptions;
}

/**
 * Fully resolved transport settings used by the client.
 */
export type OvsdbResolvedConnectionOptions =
    | OvsdbUnixConnectionOptions
    | OvsdbTcpConnectionOptions
    | OvsdbTlsTransportOptions;

/**
 * Typed events emitted by {@link OVSDBClient}.
 */
export interface OvsdbClientEvents<TDatabase extends DatabaseTableMap = DatabaseTableMap> {
    connect: [];
    close: [];
    notification: [OvsdbNotification<TDatabase>];
    update: [UpdateNotification<TDatabase>];
    update2: [Update2Notification<TDatabase>];
    update3: [Update3Notification<TDatabase>];
    locked: [LockedNotification];
    stolen: [StolenNotification];
    protocolError: [Error, unknown];
    transportError: [Error];
}

/**
 * Options for configuring an {@link OVSDBClient}.
 */
export interface OvsdbClientOptions {
    /**
     * Path to the OVSDB Unix domain socket.
     *
     * @defaultValue `"/var/run/openvswitch/db.sock"`
     */
    socketPath?: string;

    /**
     * Hostname for TCP or TLS connections.
     *
     * When set, the client uses a network socket instead of a Unix socket.
     */
    host?: string;

    /**
     * Port for TCP or TLS connections.
     *
     * @defaultValue `6640`
     */
    port?: number;

    /**
     * Enables TLS for network connections.
     *
     * @defaultValue `false`
     */
    tls?: boolean;

    /**
     * Extra TLS connection options forwarded to `node:tls`.
     *
     * These options are only used when `tls` is enabled.
     */
    tlsOptions?: TlsConnectionOptions;

    /**
     * Request and connection timeout in milliseconds.
     *
     * @defaultValue `5000`
     */
    timeout?: number;

    /**
     * Optional stream factory used for testing or custom transports.
     * When set, the client skips the socket path existence check.
     */
    connectionFactory?: (options: OvsdbResolvedConnectionOptions) => OvsdbStream;
}

/**
 * JSON-RPC transport error returned by the OVSDB server.
 */
export class OvsdbRpcError extends Error {
    /**
     * The error payload returned by the server.
     */
    public readonly response: OvsdbError;

    /**
     * Creates a new RPC error wrapper.
     */
    constructor(response: OvsdbError) {
        super(response.details ? `${response.error}: ${response.details}` : response.error);
        this.name = "OvsdbRpcError";
        this.response = response;
    }
}

/**
 * Raised when a message does not match the expected JSON-RPC envelope.
 */
export class OvsdbProtocolError extends Error {
    /**
     * The raw payload that failed validation.
     */
    public readonly payload: unknown;

    /**
     * Creates a new protocol error wrapper.
     */
    constructor(message: string, payload: unknown) {
        super(message);
        this.name = "OvsdbProtocolError";
        this.payload = payload;
    }
}

/**
 * Raised when an OVSDB transaction response contains an operation-level error.
 */
export class OvsdbTransactionError<
    TDatabase extends DatabaseTableMap = DatabaseTableMap
> extends Error {
    /**
     * Zero-based index of the failed operation in the submitted transaction.
     */
    public readonly operationIndex: number;

    /**
     * Operation that produced the error.
     */
    public readonly operation: DatabaseOperation<TDatabase>;

    /**
     * OVSDB error payload returned for the failed operation.
     */
    public readonly result: OvsdbError;

    /**
     * Raw transaction results returned by the server.
     */
    public readonly results: Array<OperationResult<TDatabase, DatabaseOperation<TDatabase>> | OvsdbError>;

    /**
     * Creates a new transaction error wrapper.
     */
    constructor(options: {
        operationIndex: number;
        operation: DatabaseOperation<TDatabase>;
        result: OvsdbError;
        results: Array<OperationResult<TDatabase, DatabaseOperation<TDatabase>> | OvsdbError>;
    }) {
        super(`Transaction operation ${options.operationIndex} failed: ${options.result.error}`);
        this.name = "OvsdbTransactionError";
        this.operationIndex = options.operationIndex;
        this.operation = options.operation;
        this.result = options.result;
        this.results = options.results;
    }
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeoutId: NodeJS.Timeout;
}

/**
 * Result payload returned by a staged transaction helper.
 */
export interface OvsdbTransactionOutcome<
    TDatabase extends DatabaseTableMap = DatabaseTableMap,
    TValue = void
> {
    /**
     * Value returned by the transaction callback.
     */
    value: TValue;

    /**
     * Operations that were submitted to OVSDB.
     */
    operations: readonly DatabaseOperation<TDatabase>[];

    /**
     * Per-operation OVSDB results in submission order.
     */
    results: Array<OperationResult<TDatabase, DatabaseOperation<TDatabase>>>;
}

/**
 * Options for the staged transaction helper.
 */
export interface OvsdbTransactionOptions {
    /**
     * Appends a trailing `commit` operation when the callback succeeds and the
     * staged operations do not already include `commit` or `abort`.
     *
     * @defaultValue `true`
     */
    autoCommit?: boolean;

    /**
     * Durable flag used by the auto-generated `commit` operation.
     *
     * @defaultValue `false`
     */
    durable?: boolean;
}

/**
 * Stages OVSDB operations before sending them as a single `transact` request.
 */
export class OvsdbTransaction<TDatabase extends DatabaseTableMap = DatabaseTableMap> {
    private readonly stagedOperations: DatabaseOperation<TDatabase>[] = [];

    /**
     * Returns the currently staged operations.
     */
    public get operations(): readonly DatabaseOperation<TDatabase>[] {
        return this.stagedOperations;
    }

    /**
     * Adds an operation to the transaction.
     */
    public add<TOperation extends DatabaseOperation<TDatabase>>(operation: TOperation): TOperation {
        this.stagedOperations.push(operation);
        return operation;
    }

    /**
     * Stages an insert operation.
     */
    public insert<TOperation extends InsertOperation<TDatabase>>(operation: TOperation): TOperation {
        return this.add(operation);
    }

    /**
     * Stages a select operation.
     */
    public select<TOperation extends SelectOperation<TDatabase>>(operation: TOperation): TOperation {
        return this.add(operation);
    }

    /**
     * Stages an update operation.
     */
    public update<TOperation extends UpdateOperation<TDatabase>>(operation: TOperation): TOperation {
        return this.add(operation);
    }

    /**
     * Stages a mutate operation.
     */
    public mutate<TOperation extends MutateOperation<TDatabase>>(operation: TOperation): TOperation {
        return this.add(operation);
    }

    /**
     * Stages a delete operation.
     */
    public delete<TOperation extends DeleteOperation<TDatabase>>(operation: TOperation): TOperation {
        return this.add(operation);
    }

    /**
     * Stages a wait operation.
     */
    public wait<TOperation extends WaitOperation<TDatabase>>(operation: TOperation): TOperation {
        return this.add(operation);
    }

    /**
     * Stages a comment operation.
     */
    public comment(comment: string): CommentOperation {
        return this.add({
            op: "comment",
            comment
        });
    }

    /**
     * Stages an assert operation.
     */
    public assert(lock: string): AssertOperation {
        return this.add({
            op: "assert",
            lock
        });
    }

    /**
     * Stages a commit operation.
     */
    public commit(durable = false): CommitOperation {
        return this.add({
            op: "commit",
            durable
        });
    }

    /**
     * Stages an abort operation.
     */
    public abort(): AbortOperation {
        return this.add({
            op: "abort"
        });
    }
}

/**
 * A low-level, event-driven OVSDB client for Unix sockets, TCP, or TLS.
 *
 * The client exposes the RFC 7047 primitives together with common
 * Open vSwitch protocol extensions while keeping the API small and predictable.
 */
export class OVSDBClient<
    TDatabase extends DatabaseTableMap = DatabaseTableMap
> extends EventEmitter<OvsdbClientEvents<TDatabase>> implements AsyncDisposable {
    private readonly timeout: number;
    private readonly connectionOptions: OvsdbResolvedConnectionOptions;
    private readonly connectionFactory?: (options: OvsdbResolvedConnectionOptions) => OvsdbStream;

    private socket: OvsdbStream | null = null;
    private requestId = 1;
    private receiveBuffer = "";
    private pendingRequests = new Map<JsonValue, PendingRequest>();
    private connected = false;
    private closeEmitted = false;

    /**
     * Creates a new OVSDB client instance.
     */
    constructor(options: OvsdbClientOptions = {}) {
        super();
        this.timeout = options.timeout ?? 5000;
        this.connectionOptions = resolveConnectionOptions(options);
        this.connectionFactory = options.connectionFactory;
    }

    /**
     * Returns `true` when the underlying socket is currently connected.
     */
    public get isConnected(): boolean {
        return this.connected;
    }

    /**
     * Opens the transport connection.
     *
     * @returns The connected client instance for chaining.
     */
    public async connect(): Promise<this> {
        if (this.connected) {
            return this;
        }

        if (
            !this.connectionFactory &&
            this.connectionOptions.transport === "unix" &&
            !existsSync(this.connectionOptions.socketPath)
        ) {
            throw new Error(`OVSDB socket not found: ${this.connectionOptions.socketPath}`);
        }

        const socket = this.connectionFactory
            ? this.connectionFactory(this.connectionOptions)
            : createTransport(this.connectionOptions);
        this.attachSocket(socket);
        const connectEvent = this.connectionOptions.transport === "tls" ? "secureConnect" : "connect";

        await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                this.disposeTransport(new Error(`Connection timeout after ${this.timeout}ms`));
                reject(new Error(`Connection timeout after ${this.timeout}ms`));
            }, this.timeout);

            const onConnect = () => {
                cleanup();
                this.connected = true;
                this.closeEmitted = false;
                this.emit("connect");
                resolve();
            };

            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };

            const cleanup = () => {
                clearTimeout(timeoutId);
                socket.off(connectEvent, onConnect);
                socket.off("error", onError);
            };

            socket.once(connectEvent, onConnect);
            socket.once("error", onError);
        });

        return this;
    }

    /**
     * Sends a raw JSON-RPC request and resolves with its `result` payload.
     *
     * @param method RPC method name.
     * @param params RPC parameters.
     */
    public async request<TResult>(method: string, params: JsonValue[] = []): Promise<TResult> {
        this.assertConnected();

        const id = this.requestId++;
        const payload = {
            method,
            params,
            id
        };

        return await new Promise<TResult>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout for method: ${method}`));
            }, this.timeout);

            this.pendingRequests.set(id, {
                resolve: (value) => resolve(value as TResult),
                reject,
                timeoutId
            });

            this.writeMessage(payload).catch((error) => {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(id);
                reject(error);
            });
        });
    }

    /**
     * Sends a JSON-RPC notification without waiting for a response.
     *
     * @param method RPC method name.
     * @param params RPC parameters.
     */
    public async notify(method: string, params: JsonValue[] = []): Promise<void> {
        this.assertConnected();
        await this.writeMessage({method, params});
    }

    /**
     * Returns the database names exposed by the connected OVSDB server.
     */
    public async listDbs(): Promise<ListDbsResult> {
        return await this.request<ListDbsResult>("list_dbs", []);
    }

    /**
     * Returns the schema definition for a database.
     *
     * @param dbName Database name.
     */
    public async getSchema(dbName = "Open_vSwitch"): Promise<DatabaseSchema> {
        return await this.request<DatabaseSchema>("get_schema", [dbName]);
    }

    /**
     * Executes a single transaction.
     *
     * The response preserves operation ordering, so tuple inputs infer tuple outputs.
     *
     * @param dbName Database name.
     * @param operations Transaction operations.
     */
    public async transact<TOperations extends readonly DatabaseOperation<TDatabase>[]>(
        dbName: string,
        operations: [...TOperations]
    ): Promise<OperationResults<TDatabase, TOperations>> {
        return await this.request<OperationResults<TDatabase, TOperations>>(
            "transact",
            [dbName, ...operations] as JsonValue[]
        );
    }

    /**
     * Stages a transaction in a callback and submits it only if the callback
     * completes successfully.
     *
     * This helper is convenient when you want a scoped, imperative API while
     * still sending exactly one OVSDB `transact` request.
     *
     * @param dbName Database name.
     * @param callback Callback that stages operations on the transaction object.
     * @param options Auto-commit behavior for the staged transaction.
     */
    public async transaction<TValue>(
        dbName: string,
        callback: (transaction: OvsdbTransaction<TDatabase>) => Promise<TValue> | TValue,
        options: OvsdbTransactionOptions = {}
    ): Promise<OvsdbTransactionOutcome<TDatabase, TValue>> {
        const transaction = new OvsdbTransaction<TDatabase>();
        const value = await callback(transaction);

        const operations = [...transaction.operations];
        const autoCommit = options.autoCommit ?? true;
        const hasFinalizer = operations.some((operation) => operation.op === "commit" || operation.op === "abort");
        if (autoCommit && !hasFinalizer) {
            operations.push({
                op: "commit",
                durable: options.durable ?? false
            });
        }

        if (operations.length === 0) {
            return {
                value,
                operations,
                results: []
            };
        }

        const results = await this.request<Array<OperationResult<TDatabase, DatabaseOperation<TDatabase>> | OvsdbError>>(
            "transact",
            [dbName, ...operations] as JsonValue[]
        );

        for (const [index, result] of results.entries()) {
            if (isOvsdbError(result)) {
                throw new OvsdbTransactionError<TDatabase>({
                    operationIndex: index,
                    operation: operations[index] as DatabaseOperation<TDatabase>,
                    result,
                    results
                });
            }
        }

        return {
            value,
            operations,
            results: results as Array<OperationResult<TDatabase, DatabaseOperation<TDatabase>>>
        };
    }

    /**
     * Cancels a previously issued request by id.
     *
     * @param requestId JSON-RPC request id to cancel.
     */
    public async cancel(requestId: JsonValue): Promise<null | JsonObject> {
        return await this.request<null | JsonObject>("cancel", [requestId]);
    }

    /**
     * Starts a standard RFC 7047 monitor.
     *
     * @param dbName Database name.
     * @param monitorId Application-defined monitor id.
     * @param monitorRequests Per-table monitor definitions.
     */
    public async monitor(
        dbName: string,
        monitorId: JsonValue,
        monitorRequests: Record<string, MonitorRequest<TDatabase>>
    ): Promise<TableUpdates<TDatabase>> {
        return await this.request<TableUpdates<TDatabase>>("monitor", [
            dbName,
            monitorId,
            monitorRequests as JsonValue
        ]);
    }

    /**
     * Starts an Open vSwitch conditional monitor.
     *
     * @param dbName Database name.
     * @param monitorId Application-defined monitor id.
     * @param monitorRequests Per-table conditional monitor definitions.
     */
    public async monitorCond(
        dbName: string,
        monitorId: JsonValue,
        monitorRequests: Record<string, MonitorCondRequest<TDatabase>>
    ): Promise<TableUpdates2<TDatabase>> {
        return await this.request<TableUpdates2<TDatabase>>("monitor_cond", [
            dbName,
            monitorId,
            monitorRequests as JsonValue
        ]);
    }

    /**
     * Starts an Open vSwitch conditional monitor from a known transaction id.
     *
     * @param dbName Database name.
     * @param monitorId Application-defined monitor id.
     * @param monitorRequests Per-table conditional monitor definitions.
     * @param lastTransactionId Last seen transaction id, or `null` for a fresh snapshot.
     */
    public async monitorCondSince(
        dbName: string,
        monitorId: JsonValue,
        monitorRequests: Record<string, MonitorCondRequest<TDatabase>>,
        lastTransactionId: string | null = null
    ): Promise<MonitorCondSinceResult<TDatabase>> {
        return await this.request<MonitorCondSinceResult<TDatabase>>("monitor_cond_since", [
            dbName,
            monitorId,
            monitorRequests as JsonValue,
            lastTransactionId
        ]);
    }

    /**
     * Cancels a monitor by its monitor id.
     *
     * @param monitorId Monitor id used when the monitor was created.
     */
    public async monitorCancel(monitorId: JsonValue): Promise<null | JsonObject> {
        return await this.request<null | JsonObject>("monitor_cancel", [monitorId]);
    }

    /**
     * Acquires a named database lock.
     *
     * @param lockId Lock identifier.
     */
    public async lock(lockId: string): Promise<null | JsonObject> {
        return await this.request<null | JsonObject>("lock", [lockId]);
    }

    /**
     * Forces ownership of a named database lock.
     *
     * @param lockId Lock identifier.
     */
    public async steal(lockId: string): Promise<null | JsonObject> {
        return await this.request<null | JsonObject>("steal", [lockId]);
    }

    /**
     * Releases a previously acquired named database lock.
     *
     * @param lockId Lock identifier.
     */
    public async unlock(lockId: string): Promise<null | JsonObject> {
        return await this.request<null | JsonObject>("unlock", [lockId]);
    }

    /**
     * Sends an echo request to validate transport liveness.
     *
     * @param payload Values to be echoed back by the server.
     */
    public async echo<TPayload extends OvsdbValue[]>(...payload: TPayload): Promise<TPayload> {
        return await this.request<TPayload>("echo", payload as JsonValue[]);
    }

    /**
     * Enables or disables Open vSwitch database change awareness.
     *
     * @param enabled Whether the server should report change awareness metadata.
     */
    public async setDbChangeAware(enabled = true): Promise<boolean | null> {
        return await this.request<boolean | null>("set_db_change_aware", [enabled]);
    }

    /**
     * Closes the connection and rejects all pending requests.
     */
    public async close(): Promise<void> {
        this.disposeTransport();
    }

    /**
     * Implements `AsyncDisposable`.
     */
    public async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    private attachSocket(socket: OvsdbStream): void {
        this.socket = socket;
        this.receiveBuffer = "";

        socket.on("data", this.handleData);
        socket.on("error", this.handleSocketError);
        socket.on("close", this.handleSocketClose);
    }

    private readonly handleData = (chunk: Buffer | string): void => {
        this.receiveBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

        let frame = extractJsonFrame(this.receiveBuffer);
        while (frame) {
            this.receiveBuffer = frame.rest;
            this.parseFrame(frame.frame);
            frame = extractJsonFrame(this.receiveBuffer);
        }

        const trimmed = this.receiveBuffer.trimStart();
        if (trimmed && trimmed[0] !== "{" && trimmed[0] !== "[") {
            this.emitProtocolError("Received non-JSON data on the transport", this.receiveBuffer);
            this.receiveBuffer = "";
        }
    };

    private readonly handleSocketError = (error: Error): void => {
        this.emit("transportError", error);
        this.disposeTransport(error);
    };

    private readonly handleSocketClose = (): void => {
        this.disposeTransport();
    };

    private parseFrame(frame: string): void {
        try {
            const payload = JSON.parse(frame) as unknown;
            this.handleMessage(payload);
        } catch (error) {
            const protocolError = new OvsdbProtocolError("Failed to parse JSON message", frame);
            this.emit("protocolError", protocolError, frame);
            if (error instanceof Error) {
                void error;
            }
        }
    }

    private handleMessage(payload: unknown): void {
        if (!payload || typeof payload !== "object") {
            this.emitProtocolError("Expected a JSON object message", payload);
            return;
        }

        if ("method" in payload && typeof payload.method === "string") {
            const message = payload as {method: string; params?: JsonValue[]; id?: JsonValue | null};

            if (message.id !== undefined && message.id !== null) {
                void this.handleIncomingRequest(message.method, message.params ?? [], message.id);
                return;
            }

            this.handleNotification(payload as OvsdbNotification<TDatabase>);
            return;
        }

        if ("id" in payload) {
            this.handleResponse(payload as OvsdbResponse<unknown>);
            return;
        }

        this.emitProtocolError("Received message without method or id", payload);
    }

    private handleResponse(response: OvsdbResponse<unknown>): void {
        const pendingRequest = this.pendingRequests.get(response.id);
        if (!pendingRequest) {
            this.emitProtocolError("Received response for an unknown request id", response);
            return;
        }

        this.pendingRequests.delete(response.id);
        clearTimeout(pendingRequest.timeoutId);

        if (response.error) {
            pendingRequest.reject(new OvsdbRpcError(response.error));
            return;
        }

        pendingRequest.resolve(response.result);
    }

    private async handleIncomingRequest(method: string, params: JsonValue[], id: JsonValue): Promise<void> {
        if (method === "echo") {
            await this.writeMessage({
                id,
                result: params,
                error: null
            });
            return;
        }

        await this.writeMessage({
            id,
            result: null,
            error: {
                error: "not supported",
                details: `Unsupported server request: ${method}`
            }
        });
    }

    private handleNotification(notification: OvsdbNotification<TDatabase>): void {
        this.emit("notification", notification);

        switch (notification.method) {
            case "update":
                this.emit("update", notification);
                break;
            case "update2":
                this.emit("update2", notification);
                break;
            case "update3":
                this.emit("update3", notification);
                break;
            case "locked":
                this.emit("locked", notification);
                break;
            case "stolen":
                this.emit("stolen", notification);
                break;
            default:
                this.emitProtocolError("Received an unknown notification method", notification);
                break;
        }
    }

    private emitProtocolError(message: string, payload: unknown): void {
        const error = new OvsdbProtocolError(message, payload);
        this.emit("protocolError", error, payload);
    }

    private async writeMessage(payload: JsonObject): Promise<void> {
        this.assertConnected();

        await new Promise<void>((resolve, reject) => {
            this.socket?.write(`${JSON.stringify(payload)}\n`, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    private assertConnected(): void {
        if (!this.connected || !this.socket) {
            throw new Error("Not connected to OVSDB");
        }
    }

    private disposeTransport(reason?: Error): void {
        const socket = this.socket;
        this.socket = null;
        this.connected = false;
        this.receiveBuffer = "";

        if (socket) {
            socket.off("data", this.handleData);
            socket.off("error", this.handleSocketError);
            socket.off("close", this.handleSocketClose);
            if (!socket.destroyed) {
                socket.destroy();
            }
        }

        const closeError = reason ?? new Error("Connection closed");
        for (const pendingRequest of this.pendingRequests.values()) {
            clearTimeout(pendingRequest.timeoutId);
            pendingRequest.reject(closeError);
        }
        this.pendingRequests.clear();

        if (!this.closeEmitted) {
            this.closeEmitted = true;
            this.emit("close");
        }
    }
}

export * from "./types";

/**
 * Resolves the user-supplied transport options into an explicit connection mode.
 */
export function resolveConnectionOptions(options: OvsdbClientOptions = {}): OvsdbResolvedConnectionOptions {
    if (options.host) {
        const port = options.port ?? 6640;
        if (options.tls) {
            return {
                transport: "tls",
                host: options.host,
                port,
                tlsOptions: {
                    host: options.host,
                    port,
                    ...options.tlsOptions
                }
            };
        }

        return {
            transport: "tcp",
            host: options.host,
            port
        };
    }

    return {
        transport: "unix",
        socketPath: options.socketPath ?? "/var/run/openvswitch/db.sock"
    };
}

function createTransport(options: OvsdbResolvedConnectionOptions): OvsdbStream {
    switch (options.transport) {
        case "unix":
            return createNetConnection(options.socketPath);
        case "tcp":
            return createNetConnection(options.port, options.host);
        case "tls":
            return connectTls(options.tlsOptions);
    }
}

function isOvsdbError(value: unknown): value is OvsdbError {
    return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

function extractJsonFrame(buffer: string): {frame: string; rest: string} | null {
    let startIndex = 0;
    while (startIndex < buffer.length && /\s/u.test(buffer[startIndex])) {
        startIndex += 1;
    }

    if (startIndex >= buffer.length) {
        return null;
    }

    const opening = buffer[startIndex];
    const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
    if (!closing) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let index = startIndex; index < buffer.length; index += 1) {
        const char = buffer[index];

        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }

            if (char === "\\") {
                escaping = true;
                continue;
            }

            if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "{" || char === "[") {
            depth += 1;
            continue;
        }

        if (char === "}" || char === "]") {
            depth -= 1;
            if (depth === 0) {
                return {
                    frame: buffer.slice(startIndex, index + 1),
                    rest: buffer.slice(index + 1)
                };
            }
        }
    }

    return null;
}
