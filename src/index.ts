import {createConnection, Socket} from "net";
import {existsSync} from "fs";

import {
    DatabaseOperation,
    DatabaseSchema, EchoResponse,
    GetSchemaResponse,
    JsonValue,
    ListDbsResponse, LockedNotification, MonitorCancelResponse, MonitorConfig, MonitorResponse, OvsdbResponse,
    OvsdbResult, StolenNotification, TableUpdate,
    TransactResponse, UpdateNotification
} from "./types";

/**
 * Options for configuring the OVSDBClient.
 */
export interface OvsdbClientOptions {
    socketPath?: string;
    timeout?: number;
}

/**
 * A lightweight, typesafe client for interacting with the OVSDB over a Unix socket.
 * Implements the AsyncDisposable interface for resource management.
 * No extra functionality should be added to this client than only interact with the low-level database functions of ovs
 */
export class OVSDBClient implements AsyncDisposable {
    private readonly socketPath: string;
    private readonly timeout: number;
    private socket: Socket | null = null;
    private requestId = 1;
    private pendingRequests = new Map<number, {
        resolve: (value: any) => void;
        reject: (reason?: any) => void;
        timeoutId: NodeJS.Timeout;
    }>();
    private isConnected = false;

    /**
     * Creates a new OVSDBClient instance.
     * @param options - Configuration options for the client.
     */
    constructor(options: OvsdbClientOptions = {}) {
        this.socketPath = options.socketPath || '/var/run/openvswitch/db.sock';
        this.timeout = options.timeout || 5000;
    }

    /**
     * Connects to the OVSDB Unix socket.
     * @returns A promise that resolves when connected.
     * @throws An error if the socket file does not exist or the connection fails.
     */
    public connect(): Promise<this> {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve(this);
                return;
            }

            if (!existsSync(this.socketPath)) {
                reject(new Error(`OVSDB socket not found: ${this.socketPath}`));
                return;
            }

            this.socket = createConnection(this.socketPath);

            const timeoutId = setTimeout(() => {
                this._cleanup();
                reject(new Error(`Connection timeout after ${this.timeout}ms`));
            }, this.timeout);

            this.socket.on('connect', () => {
                clearTimeout(timeoutId);
                this.isConnected = true;
                resolve(this);
            });

            this.socket.on('error', (err) => {
                clearTimeout(timeoutId);
                this._cleanup();
                reject(err);
            });

            this.socket.on('close', () => {
                this._cleanup();
            });

            this.socket.on('data', (data) => {
                this._handleData(data);
            });
        });
    }

    /**
     * Sends a JSON-RPC request to the OVSDB server.
     * @param method - The RPC method name.
     * @param params - The parameters for the RPC method.
     * @returns A promise that resolves with the result.
     * @throws An error if not connected, if the request times out, or if there is a network error.
     */
    public request<T>(method: string, params: JsonValue[]): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Not connected to OVSDB'));
                return;
            }

            const id = this.requestId++;
            const request = JSON.stringify({
                method,
                params,
                id
            }) + '\n';

            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout for method: ${method}`));
            }, this.timeout);

            this.pendingRequests.set(id, {resolve, reject, timeoutId});

            this.socket!.write(request, (err) => {
                if (err) {
                    clearTimeout(timeoutId);
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });
        });
    }

    // --- Core OVSDB RPC Methods (Fixed to handle the response structure) ---

    public async listDbs(): Promise<string[]> {
        const response = await this.request<ListDbsResponse>('list_dbs', []);
        // Check if the response is an error object
        if ('error' in response && response.error !== null) {
            throw new Error(`RPC Error: ${response.error}`);
        }
        const result = response.result;
        // Check if the OvsdbResult itself is an error
        if ('error' in result) {
            throw new Error(`OVSDB Error: ${result.error}`);
        }
        return result;
    }

    public async getSchema(dbName: string = 'Open_vSwitch'): Promise<DatabaseSchema> {
        const response = await this.request<GetSchemaResponse>('get_schema', [dbName]);
        if ('error' in response && response.error !== null) {
            throw new Error(`RPC Error: ${response.error}`);
        }
        const result = response.result;
        if ('error' in result) {
            throw new Error(`OVSDB Error: ${result.error}`);
        }
        return result;
    }

    public async transact(dbName: string, operations: DatabaseOperation[]): Promise<Array<OvsdbResult<unknown>>> {
        const response = await this.request<TransactResponse>('transact', [dbName, ...operations]);
        if ('error' in response && response.error !== null) {
            throw new Error(`RPC Error: ${response.error}`);
        }
        return response.result as Array<OvsdbResult<unknown>>;
        // Note: The result here is already an array of OvsdbResult<unknown>.
        // The caller is responsible for checking each element for errors.
    }

    public async monitor(dbName: string, monitorId: JsonValue, monitorRequests: Record<string, MonitorConfig[]>): Promise<Record<string, TableUpdate>> {
        const response = await this.request<MonitorResponse>('monitor', [dbName, monitorId, monitorRequests as JsonValue]);
        if ('error' in response && response.error !== null) {
            throw new Error(`RPC Error: ${response.error}`);
        }
        const result = response.result;
        if ('error' in result) {
            throw new Error(`OVSDB Error: ${result.error}`);
        }
        return result;
    }

    public async monitorCancel(monitorId: JsonValue): Promise<Record<string, never>> {
        const response = await this.request<MonitorCancelResponse>('monitor_cancel', [monitorId]);
        if ('error' in response && response.error !== null) {
            throw new Error(`RPC Error: ${response.error}`);
        }
        const result = response.result;
        if ('error' in result) {
            throw new Error(`OVSDB Error: ${result.error}`);
        }
        return result;
    }

    public async echo(payload: JsonValue = 'ping'): Promise<JsonValue[]> {
        const response = await this.request<EchoResponse>('echo', Array.isArray(payload) ? payload : [payload]);
        if ('error' in response && response.error !== null) {
            throw new Error(`RPC Error: ${response.error}`);
        }
        const result = response.result;
        if ('error' in result) {
            throw new Error(`OVSDB Error: ${result.error}`);
        }
        return result;
    }

    /**
     * Closes the connection to the OVSDB server.
     * @returns A promise that resolves when the connection is closed.
     */
    public async close(): Promise<void> {
        await this[Symbol.asyncDispose]();
    }

    /**
     * Implements the AsyncDisposable interface for use with 'using' statements.
     * This method is called automatically when exiting a 'using' block.
     * @returns A promise that resolves when cleanup is complete.
     */
    public async [Symbol.asyncDispose](): Promise<void> {
        if (this.isConnected) {
            const closePromise = new Promise<void>((resolve) => {
                if (this.socket) {
                    if (this.socket.destroyed || this.socket.readyState === 'closed') {
                        resolve();
                        return;
                    }
                    this.socket.once('close', () => {
                        resolve();
                    });
                } else {
                    resolve();
                }
            });

            this._cleanup();
            await closePromise;
        }
    }

    /**
     * Cleans up the connection and pending requests.
     * @private
     */
    private _cleanup(): void {
        this.isConnected = false;
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.pendingRequests.forEach(({reject, timeoutId}) => {
            clearTimeout(timeoutId);
            reject(new Error('Connection closed'));
        });
        this.pendingRequests.clear();
    }

    /**
     * Handles incoming data from the socket.
     * @private
     * @param data - The raw data received.
     */
    private _handleData(data: Buffer): void {
        const messages = data.toString().trim().split('\n');
        messages.forEach(message => {
            if (!message) return;
            try {
                const response = JSON.parse(message);
                this._handleResponse(response);
            } catch (err) {
                console.error('Failed to parse JSON:', err);
            }
        });
    }

    /**
     * Handles a parsed JSON-RPC response.
     * @private
     * @param response - The JSON-RPC response object.
     */
    private _handleResponse(response: JsonValue): void {
        if (typeof response !== 'object' || response === null || !('id' in response)) {
            console.error('Invalid response format:', response);
            return;
        }

        const id = response.id as number;
        const request = this.pendingRequests.get(id);

        if (!request) {
            // This is a notification (e.g., "update", "locked", "stolen")
            this._handleNotification(response);
            return;
        }

        this.pendingRequests.delete(id);
        clearTimeout(request.timeoutId);

        if ('error' in response && response.error !== null) {
            request.reject(new Error(`RPC Error: ${response.error}`));
        } else {
            request.resolve((response as unknown as OvsdbResponse));
        }
    }

    /**
     * Handles JSON-RPC notifications (e.g., "update", "locked", "stolen").
     * This can be overridden by subclasses or event listeners.
     * @private
     * @param notification - The notification object.
     */
    private _handleNotification(notification: JsonValue): void {
        if (typeof notification !== 'object' || notification === null || !('method' in notification)) {
            console.error('Invalid notification format:', notification);
            return;
        }

        const method = (notification as { method: string }).method;

        switch (method) {
            case 'update':
                console.log('Received update notification:', (notification as UpdateNotification).params[0]);
                break;
            case 'locked':
                console.log('Received locked notification:', (notification as LockedNotification).params[0]);
                break;
            case 'stolen':
                console.log('Received stolen notification:', (notification as StolenNotification).params[0]);
                break;
            default:
                console.log('Received notification:', method);
        }
    }
}

export * from "./types"
