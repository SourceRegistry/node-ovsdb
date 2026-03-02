/**
 * JSON primitive values.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A JSON object value.
 */
export interface JsonObject {
    [key: string]: JsonValue;
}

/**
 * Any JSON-compatible value.
 */
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

/**
 * A UUID wrapper used by OVSDB atoms and transaction results.
 */
export type Uuid = ["uuid", string];

/**
 * A named UUID wrapper used to reference values created earlier in a transaction.
 */
export type NamedUuid = ["named-uuid", string];

/**
 * An OVSDB set value.
 */
export type OvsSet<T = JsonValue> = ["set", T[]];

/**
 * An OVSDB map value.
 */
export type OvsMap<TKey = JsonValue, TValue = JsonValue> = ["map", Array<[TKey, TValue]>];

/**
 * Any commonly exchanged OVSDB value.
 */
export type OvsdbValue = JsonValue | Uuid | NamedUuid | OvsSet | OvsMap;

/**
 * A generic row shape for application-level table typing.
 */
export type RowRecord = Record<string, OvsdbValue>;

/**
 * A generic table map keyed by table name.
 */
export type DatabaseTableMap = Record<string, RowRecord>;

/**
 * Extracts valid table names from a database type.
 */
export type TableName<TDatabase extends DatabaseTableMap> = Extract<keyof TDatabase, string>;

/**
 * Extracts the row type for a table in a database type.
 */
export type TableRow<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase>
> = TDatabase[TTable];

/**
 * Extracts valid column names for a table in a database type.
 */
export type ColumnName<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase>
> = Extract<keyof TableRow<TDatabase, TTable>, string>;

/**
 * OVSDB operation and RPC errors.
 */
export interface OvsdbError {
    error: string;
    details?: string | null;
    [key: string]: JsonValue | undefined;
}

/**
 * A successful JSON-RPC response envelope.
 */
export interface OvsdbSuccessResponse<TResult = JsonValue> {
    result: TResult;
    error: null;
    id: JsonValue;
}

/**
 * A failed JSON-RPC response envelope.
 */
export interface OvsdbErrorResponse {
    result?: null;
    error: OvsdbError;
    id: JsonValue;
}

/**
 * A JSON-RPC response returned by an OVSDB server.
 */
export type OvsdbResponse<TResult = JsonValue> = OvsdbSuccessResponse<TResult> | OvsdbErrorResponse;

/**
 * A JSON-RPC notification emitted by the server.
 */
export interface OvsdbNotificationBase<TMethod extends string, TParams extends unknown[]> {
    method: TMethod;
    params: TParams;
    id: null;
}

/**
 * RFC 7047 condition operators plus Open vSwitch extensions used by monitor condition APIs.
 */
export type ConditionFunction = "<" | "<=" | "==" | "!=" | ">" | ">=" | "includes" | "excludes";

/**
 * OVSDB mutation operators.
 */
export type MutationOperator = "+=" | "-=" | "*=" | "/=" | "%=" | "insert" | "delete";

/**
 * A column condition for a specific table.
 */
export type ConditionForTable<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase>
> = {
    [TColumn in ColumnName<TDatabase, TTable>]:
        [TColumn, ConditionFunction, TableRow<TDatabase, TTable>[TColumn] | OvsdbValue]
}[ColumnName<TDatabase, TTable>] | [string, ConditionFunction, OvsdbValue];

/**
 * A column mutation for a specific table.
 */
export type MutationForTable<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase>
> = {
    [TColumn in ColumnName<TDatabase, TTable>]:
        [TColumn, MutationOperator, TableRow<TDatabase, TTable>[TColumn] | OvsdbValue]
}[ColumnName<TDatabase, TTable>] | [string, MutationOperator, OvsdbValue];

/**
 * Select clauses for monitor requests.
 */
export interface MonitorSelect {
    initial?: boolean;
    insert?: boolean;
    delete?: boolean;
    modify?: boolean;
}

/**
 * A standard OVSDB monitor request for a table.
 */
export interface MonitorRequest<
    TDatabase extends DatabaseTableMap = DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> {
    columns?: Array<ColumnName<TDatabase, TTable> | string>;
    select?: MonitorSelect;
}

/**
 * A conditional monitor request for a table.
 */
export interface MonitorCondRequest<
    TDatabase extends DatabaseTableMap = DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> extends MonitorRequest<TDatabase, TTable> {
    where?: Array<ConditionForTable<TDatabase, TTable>>;
}

/**
 * Table update payload used by RFC 7047 monitor notifications.
 */
export type TableUpdate<
    TDatabase extends DatabaseTableMap = DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = Record<string, RowUpdate<TableRow<TDatabase, TTable>>>;

/**
 * RFC 7047 row update payload.
 */
export interface RowUpdate<TRow extends RowRecord = RowRecord> {
    old?: Partial<TRow>;
    new?: Partial<TRow>;
}

/**
 * Open vSwitch conditional monitor update payload.
 */
export type TableUpdate2<
    TDatabase extends DatabaseTableMap = DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = Record<string, RowUpdate2<TableRow<TDatabase, TTable>>>;

/**
 * Open vSwitch conditional row update payload.
 */
export interface RowUpdate2<TRow extends RowRecord = RowRecord> {
    initial?: Partial<TRow>;
    insert?: Partial<TRow>;
    modify?: Partial<TRow>;
    delete?: Partial<TRow>;
    old?: Partial<TRow>;
    new?: Partial<TRow>;
}

/**
 * Multi-table update payload returned by RFC 7047 `monitor`.
 */
export type TableUpdates<TDatabase extends DatabaseTableMap = DatabaseTableMap> = Partial<{
    [TTable in TableName<TDatabase>]: TableUpdate<TDatabase, TTable>;
}> & Record<string, TableUpdate>;

/**
 * Multi-table update payload returned by conditional monitor extensions.
 */
export type TableUpdates2<TDatabase extends DatabaseTableMap = DatabaseTableMap> = Partial<{
    [TTable in TableName<TDatabase>]: TableUpdate2<TDatabase, TTable>;
}> & Record<string, TableUpdate2>;

/**
 * OVSDB schema response payload.
 */
export interface DatabaseSchema {
    name: string;
    version: string;
    cksum?: string;
    tables: Record<string, TableSchema>;
}

/**
 * Table schema metadata.
 */
export interface TableSchema {
    columns: Record<string, ColumnSchema>;
    maxRows?: number;
    isRoot?: boolean;
    indexes?: string[][];
}

/**
 * Column schema metadata.
 */
export interface ColumnSchema {
    type: Type;
    ephemeral?: boolean;
    mutable?: boolean;
}

/**
 * OVSDB type metadata.
 */
export type Type = AtomicType | {
    key: BaseType;
    value?: BaseType;
    min?: number;
    max?: number | "unlimited";
};

/**
 * OVSDB atomic types.
 */
export type AtomicType = "integer" | "real" | "boolean" | "string" | "uuid";

/**
 * OVSDB base type metadata.
 */
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
    refType?: "strong" | "weak";
};

/**
 * Insert operation.
 */
export type InsertOperation<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = {
    op: "insert";
    table: TTable;
    row: Partial<TableRow<TDatabase, TTable>> & RowRecord;
    uuidName?: string;
};

/**
 * Select operation.
 */
export type SelectOperation<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = {
    op: "select";
    table: TTable;
    where: Array<ConditionForTable<TDatabase, TTable>>;
    columns?: Array<ColumnName<TDatabase, TTable> | string>;
};

/**
 * Update operation.
 */
export type UpdateOperation<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = {
    op: "update";
    table: TTable;
    where: Array<ConditionForTable<TDatabase, TTable>>;
    row: Partial<TableRow<TDatabase, TTable>> & RowRecord;
};

/**
 * Mutate operation.
 */
export type MutateOperation<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = {
    op: "mutate";
    table: TTable;
    where: Array<ConditionForTable<TDatabase, TTable>>;
    mutations: Array<MutationForTable<TDatabase, TTable>>;
};

/**
 * Delete operation.
 */
export type DeleteOperation<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = {
    op: "delete";
    table: TTable;
    where: Array<ConditionForTable<TDatabase, TTable>>;
};

/**
 * Wait operation.
 */
export type WaitOperation<
    TDatabase extends DatabaseTableMap,
    TTable extends TableName<TDatabase> = TableName<TDatabase>
> = {
    op: "wait";
    timeout?: number;
    table: TTable;
    where: Array<ConditionForTable<TDatabase, TTable>>;
    columns: Array<ColumnName<TDatabase, TTable> | string>;
    until: "==" | "!=";
    rows: Array<Partial<TableRow<TDatabase, TTable>> & RowRecord>;
};

/**
 * Commit operation.
 */
export interface CommitOperation {
    op: "commit";
    durable: boolean;
}

/**
 * Abort operation.
 */
export interface AbortOperation {
    op: "abort";
}

/**
 * Comment operation.
 */
export interface CommentOperation {
    op: "comment";
    comment: string;
}

/**
 * Assert operation.
 */
export interface AssertOperation {
    op: "assert";
    lock: string;
}

/**
 * Any OVSDB transaction operation.
 */
export type DatabaseOperation<TDatabase extends DatabaseTableMap = DatabaseTableMap> =
    | InsertOperation<TDatabase>
    | SelectOperation<TDatabase>
    | UpdateOperation<TDatabase>
    | MutateOperation<TDatabase>
    | DeleteOperation<TDatabase>
    | WaitOperation<TDatabase>
    | CommitOperation
    | AbortOperation
    | CommentOperation
    | AssertOperation;

/**
 * Insert operation result.
 */
export interface InsertResult {
    uuid: Uuid;
}

/**
 * Count-based operation result.
 */
export interface CountResult {
    count: number;
}

/**
 * Select operation result.
 */
export interface SelectResult<TRow extends RowRecord = RowRecord> {
    rows: TRow[];
}

/**
 * Acknowledge-style operation result.
 */
export type EmptyResult = Record<string, never>;

/**
 * Maps a transaction operation type to its result payload.
 */
export type OperationResult<
    TDatabase extends DatabaseTableMap,
    TOperation extends DatabaseOperation<TDatabase>
> =
    TOperation extends InsertOperation<TDatabase> ? InsertResult :
        TOperation extends SelectOperation<TDatabase, infer TTable> ? SelectResult<TableRow<TDatabase, TTable>> :
            TOperation extends UpdateOperation<TDatabase> ? CountResult :
                TOperation extends MutateOperation<TDatabase> ? CountResult :
                    TOperation extends DeleteOperation<TDatabase> ? CountResult :
                        TOperation extends WaitOperation<TDatabase> ? EmptyResult :
                            TOperation extends CommitOperation ? EmptyResult :
                                TOperation extends AbortOperation ? EmptyResult :
                                    TOperation extends CommentOperation ? EmptyResult :
                                        TOperation extends AssertOperation ? EmptyResult :
                                            never;

/**
 * Maps a transaction tuple to its response tuple.
 */
export type OperationResults<
    TDatabase extends DatabaseTableMap,
    TOperations extends readonly DatabaseOperation<TDatabase>[]
> = {
    [TIndex in keyof TOperations]: TOperations[TIndex] extends DatabaseOperation<TDatabase>
        ? OperationResult<TDatabase, TOperations[TIndex]> | OvsdbError
        : never;
};

/**
 * `list_dbs` response payload.
 */
export type ListDbsResult = string[];

/**
 * `monitor_cond_since` response payload.
 */
export type MonitorCondSinceResult<TDatabase extends DatabaseTableMap = DatabaseTableMap> = [
    found: boolean,
    lastTransactionId: string | null,
    updates: TableUpdates2<TDatabase>
];

/**
 * `list_dbs` request envelope.
 */
export interface ListDbsRequest {
    method: "list_dbs";
    params: [];
    id: JsonValue;
}

/**
 * `get_schema` request envelope.
 */
export interface GetSchemaRequest {
    method: "get_schema";
    params: [string];
    id: JsonValue;
}

/**
 * `transact` request envelope.
 */
export interface TransactRequest<TDatabase extends DatabaseTableMap = DatabaseTableMap> {
    method: "transact";
    params: [string, ...DatabaseOperation<TDatabase>[]];
    id: JsonValue;
}

/**
 * `cancel` request envelope.
 */
export interface CancelRequest {
    method: "cancel";
    params: [JsonValue];
    id: JsonValue;
}

/**
 * `monitor` request envelope.
 */
export interface MonitorRpcRequest<TDatabase extends DatabaseTableMap = DatabaseTableMap> {
    method: "monitor";
    params: [string, JsonValue, Record<string, MonitorRequest<TDatabase>>];
    id: JsonValue;
}

/**
 * `monitor_cond` request envelope.
 */
export interface MonitorCondRpcRequest<TDatabase extends DatabaseTableMap = DatabaseTableMap> {
    method: "monitor_cond";
    params: [string, JsonValue, Record<string, MonitorCondRequest<TDatabase>>];
    id: JsonValue;
}

/**
 * `monitor_cond_since` request envelope.
 */
export interface MonitorCondSinceRpcRequest<TDatabase extends DatabaseTableMap = DatabaseTableMap> {
    method: "monitor_cond_since";
    params: [string, JsonValue, Record<string, MonitorCondRequest<TDatabase>>, string | null];
    id: JsonValue;
}

/**
 * `monitor_cancel` request envelope.
 */
export interface MonitorCancelRequest {
    method: "monitor_cancel";
    params: [JsonValue];
    id: JsonValue;
}

/**
 * `lock` request envelope.
 */
export interface LockRequest {
    method: "lock";
    params: [string];
    id: JsonValue;
}

/**
 * `steal` request envelope.
 */
export interface StealRequest {
    method: "steal";
    params: [string];
    id: JsonValue;
}

/**
 * `unlock` request envelope.
 */
export interface UnlockRequest {
    method: "unlock";
    params: [string];
    id: JsonValue;
}

/**
 * `echo` request envelope.
 */
export interface EchoRequest {
    method: "echo";
    params: JsonValue[];
    id: JsonValue;
}

/**
 * Open vSwitch `set_db_change_aware` request envelope.
 */
export interface SetDbChangeAwareRequest {
    method: "set_db_change_aware";
    params: [boolean];
    id: JsonValue;
}

/**
 * RFC 7047 `update` notification payload.
 */
export type UpdateNotification<TDatabase extends DatabaseTableMap = DatabaseTableMap> = OvsdbNotificationBase<
    "update",
    [JsonValue, TableUpdates<TDatabase>]
>;

/**
 * Open vSwitch `update2` notification payload.
 */
export type Update2Notification<TDatabase extends DatabaseTableMap = DatabaseTableMap> = OvsdbNotificationBase<
    "update2",
    [JsonValue, TableUpdates2<TDatabase>]
>;

/**
 * Open vSwitch `update3` notification payload.
 */
export type Update3Notification<TDatabase extends DatabaseTableMap = DatabaseTableMap> = OvsdbNotificationBase<
    "update3",
    [JsonValue, TableUpdates2<TDatabase>, string | null]
>;

/**
 * Lock acquisition notification payload.
 */
export type LockedNotification = OvsdbNotificationBase<"locked", [string]>;

/**
 * Lock stolen notification payload.
 */
export type StolenNotification = OvsdbNotificationBase<"stolen", [string]>;

/**
 * Any server notification emitted by the client.
 */
export type OvsdbNotification<TDatabase extends DatabaseTableMap = DatabaseTableMap> =
    | UpdateNotification<TDatabase>
    | Update2Notification<TDatabase>
    | Update3Notification<TDatabase>
    | LockedNotification
    | StolenNotification;
