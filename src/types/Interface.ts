import {DatabaseOperation, OVSDBClient, OvsdbError} from "../index";

/**
 * Wrapper class for the 'Interface' table.
 */
export class Interface {
    public readonly name: string;
    private _uuid: string | null = null;
    private client: OVSDBClient;

    constructor(name: string, client: OVSDBClient) {
        this.client = client;
        this.name = name;
    }

    /**
     * Creates a new interface in the OVS database.
     * @param client - The OVSDB client instance.
     * @param name - The name of the interface.
     * @param type - The type of the interface (e.g., "internal", "dpdk").
     * @returns A Promise that resolves to a new Interface instance.
     */
    static async create(name: string, type: string = "internal", client: OVSDBClient): Promise<Interface> {
        const iface = new Interface(name, client);
        const operations: DatabaseOperation[] = [
            {
                op: "insert",
                table: "Interface",
                row: {name, type},
                uuidName: "new_iface"
            }
        ];
        await client.transact("Open_vSwitch", operations);
        return iface;
    }

    /**
     * Gets the UUID of the interface by querying the database.
     * @public
     */
    public async getUuid(): Promise<string> {
        if (this._uuid) return this._uuid;

        const result = await this.client.transact("Open_vSwitch", [
            {
                op: "select",
                table: "Interface",
                where: [["name", "==", this.name]],
                columns: ["_uuid"]
            }
        ]);

        const rows = result[0] as { _uuid: string }[] | OvsdbError;
        if ('error' in rows) {
            throw new Error(`Failed to get UUID for interface ${this.name}: ${rows.error}`);
        }
        if (rows.length === 0) {
            throw new Error(`Interface ${this.name} not found`);
        }
        this._uuid = rows[0]._uuid;
        return this._uuid;
    }
}
