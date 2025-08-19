import {DatabaseOperation, OVSDBClient, OvsdbError} from "../index";

/**
 * Wrapper class for the 'Manager' table.
 */
export class Manager {
    public readonly target: string;
    private _uuid: string | null = null;
    private client: OVSDBClient;

    constructor(target: string, client: OVSDBClient) {
        this.client = client;
        this.target = target;
    }

    /**
     * Creates a new manager in the OVS database.
     * @param client - The OVSDB client instance.
     * @param target - The target address (e.g., "ssl:127.0.0.1:6641").
     * @returns A Promise that resolves to a new Manager instance.
     */
    static async create(target: string, client: OVSDBClient): Promise<Manager> {
        const manager = new Manager(target, client);
        const operations: DatabaseOperation[] = [
            {
                op: "insert",
                table: "Manager",
                row: {target},
                uuidName: "new_manager"
            },
            {
                op: "mutate",
                table: "Open_vSwitch",
                where: [],
                mutations: [
                    [
                        "manager_options",
                        "insert",
                        ["named-uuid", "new_manager"]
                    ]
                ]
            }
        ];
        await client.transact("Open_vSwitch", operations);
        return manager;
    }

    /**
     * Gets the UUID of the manager by querying the database.
     * @public
     */
    public async getUuid(): Promise<string> {
        if (this._uuid) return this._uuid;

        const result = await this.client.transact("Open_vSwitch", [
            {
                op: "select",
                table: "Manager",
                where: [["target", "==", this.target]],
                columns: ["_uuid"]
            }
        ]);

        const rows = result[0] as { _uuid: string }[] | OvsdbError;
        if ('error' in rows) {
            throw new Error(`Failed to get UUID for manager ${this.target}: ${rows.error}`);
        }
        if (rows.length === 0) {
            throw new Error(`Manager ${this.target} not found`);
        }
        this._uuid = rows[0]._uuid;
        return this._uuid;
    }
}
