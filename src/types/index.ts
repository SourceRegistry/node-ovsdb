// === Type Definitions from RFC 7047 ===
/**
 * A JSON value of any type.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * An error object as defined in RFC 7047, Section 3.1.
 */
export interface OvsdbError {
    error: string;
    details: string | null;
    [key: string]: JsonValue; // For any other implementation-specific members
}

/**
 * A result that can be either a success value or an error.
 */
export type OvsdbResult<T> = T | OvsdbError;

/**
 * The response to an RPC request as defined in RFC 7047, Section 4.1.
 */
export interface OvsdbResponse<T = JsonValue> {
    result: OvsdbResult<T>;
    error: null;
    id: JsonValue;
}

/**
 * A monitor request configuration as defined in RFC 7047, Section 4.1.5.
 * Renamed from 'MonitorRequest' to avoid conflict with the top-level request.
 */
export interface MonitorConfig {
    columns?: string[];
    select?: {
        initial?: boolean;
        insert?: boolean;
        delete?: boolean;
        modify?: boolean;
    };
}

// --- Core OVSDB RPC Request Types ---

/**
 * The request for the 'list_dbs' method.
 */
export type ListDbsRequest = {
    method: 'list_dbs';
    params: [];
    id: JsonValue;
};

/**
 * The response for the 'list_dbs' method.
 */
export type ListDbsResponse = OvsdbResponse<string[]>;

/**
 * The request for the 'get_schema' method.
 */
export type GetSchemaRequest = {
    method: 'get_schema';
    params: [string];
    id: JsonValue;
};

/**
 * The response for the 'get_schema' method.
 */
export type GetSchemaResponse = OvsdbResponse<DatabaseSchema>;

/**
 * The request for the 'transact' method.
 */
export type TransactRequest = {
    method: 'transact';
    params: [string, DatabaseOperation[]];
    id: JsonValue;
};

/**
 * The response for the 'transact' method.
 */
export type TransactResponse = OvsdbResponse<Array<OvsdbResult<unknown>>>;

/**
 * The request for the 'monitor' method.
 */
export type MonitorRequest = {
    method: 'monitor';
    params: [string, JsonValue, Record<string, MonitorConfig[]>]; // Now uses MonitorConfig
    id: JsonValue;
};

/**
 * The response for the 'monitor' method.
 */
export type MonitorResponse = OvsdbResponse<Record<string, TableUpdate>>;

/**
 * The request for the 'monitor_cancel' method.
 */
export type MonitorCancelRequest = {
    method: 'monitor_cancel';
    params: [JsonValue];
    id: JsonValue;
};

/**
 * The response for the 'monitor_cancel' method.
 */
export type MonitorCancelResponse = OvsdbResponse<Record<string, never>>;

/**
 * The request for the 'echo' method.
 */
export type EchoRequest = {
    method: 'echo';
    params: JsonValue[];
    id: JsonValue;
};

/**
 * The response for the 'echo' method.
 */
export type EchoResponse = OvsdbResponse<JsonValue[]>;

/**
 * The notification for the 'update' method.
 */
export type UpdateNotification = {
    method: 'update';
    params: [JsonValue, Record<string, TableUpdate>];
    id: null;
};

/**
 * The notification for the 'locked' method.
 */
export type LockedNotification = {
    method: 'locked';
    params: [string];
    id: null;
};

/**
 * The notification for the 'stolen' method.
 */
export type StolenNotification = {
    method: 'stolen';
    params: [string];
    id: null;
};

// === Other Type Definitions (Unchanged) ===

export interface DatabaseSchema {
    name: string;
    version: string;
    cksum?: string;
    tables: Record<string, TableSchema>;
}

export interface TableSchema {
    columns: Record<string, ColumnSchema>;
    maxRows?: number;
    isRoot?: boolean;
    indexes?: string[][];
}

export interface ColumnSchema {
    type: Type;
    ephemeral?: boolean;
    mutable?: boolean;
}

export type Type = AtomicType | {
    key: BaseType;
    value?: BaseType;
    min?: number;
    max?: number | 'unlimited';
};

export type AtomicType = 'integer' | 'real' | 'boolean' | 'string' | 'uuid';

export type BaseType = AtomicType | {
    type: AtomicType;
    enum?: JsonValue;
    minInteger?: number;
    maxInteger?: number;
    minReal?: number;
    maxReal?: number;
    minLength?: number;
    maxLength?: number;
    refTable?: string;
    refType?: 'strong' | 'weak';
};

export type TableUpdate = Record<string, RowUpdate>;

export interface RowUpdate {
    old?: Record<string, JsonValue>;
    new?: Record<string, JsonValue>;
}

export type DatabaseOperation =
    | { op: 'insert'; table: string; row: Record<string, JsonValue>; uuidName?: string }
    | { op: 'select'; table: string; where: Condition[]; columns?: string[] }
    | { op: 'update'; table: string; where: Condition[]; row: Record<string, JsonValue> }
    | { op: 'mutate'; table: string; where: Condition[]; mutations: Mutation[] }
    | { op: 'delete'; table: string; where: Condition[] }
    | {
    op: 'wait';
    timeout?: number;
    table: string;
    where: Condition[];
    columns: string[];
    until: '==' | '!=';
    rows: Record<string, JsonValue>[]
}
    | { op: 'commit'; durable: boolean }
    | { op: 'abort' }
    | { op: 'comment'; comment: string }
    | { op: 'assert'; lock: string };

export type Condition = [string, string, JsonValue];
export type Mutation = [string, string, JsonValue];
