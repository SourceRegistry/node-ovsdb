import {Controller, DatabaseOperation, OVSDBClient, OvsdbError, Port} from "../index";
import {uuidCondition} from "../helpers/uuid.helper";

/**
 * Wrapper class for the 'Bridge' table.
 */
export class Bridge {
    public readonly name: string;
    private _uuid: string | null = null;
    private client: OVSDBClient;

    constructor(name: string, client: OVSDBClient) {
        this.client = client;
        this.name = name;
    }

    /**
     * Creates a new bridge in the OVS database.
     * @param client - The OVSDB client instance.
     * @param name - The name of the bridge.
     * @returns A Promise that resolves to a new Bridge instance.
     */
    static async create(name: string, client: OVSDBClient): Promise<Bridge> {
        const bridge = new Bridge(name, client);
        const operations: DatabaseOperation[] = [
            {
                op: "insert",
                table: "Bridge",
                row: {name},
                uuidName: "new_bridge"
            },
            {
                op: "mutate",
                table: "Open_vSwitch",
                where: [], // There's only one row in Open_vSwitch
                mutations: [
                    [
                        "bridges",
                        "insert",
                        ["named-uuid", "new_bridge"]
                    ]
                ]
            }
        ];
        await client.transact("Open_vSwitch", operations);
        return bridge;
    }

    /**
     * Gets the UUID of the bridge by querying the database.
     * @private
     */
    private async getUuid(): Promise<string> {
        if (this._uuid) return this._uuid;

        const result = await this.client.transact("Open_vSwitch", [
            {
                op: "select",
                table: "Bridge",
                where: [["name", "==", this.name]],
                columns: ["_uuid"]
            }
        ]);

        // The result is an array of results for each operation.
        // The first (and only) operation's result is an array of rows.
        const rows = result[0] as { _uuid: string }[] | OvsdbError;
        if ('error' in rows) {
            throw new Error(`Failed to get UUID for bridge ${this.name}: ${rows.error}`);
        }
        if (rows.length === 0) {
            throw new Error(`Bridge ${this.name} not found`);
        }
        this._uuid = rows[0]._uuid;
        return this._uuid;
    }

    /**
     * Adds a port to this bridge.
     * @param port - The Port instance to add.
     */
    async addPort(port: Port): Promise<void> {
        const bridgeUuid = await this.getUuid();
        const portUuid = await port.getUuid();

        const operations: DatabaseOperation[] = [
            {
                op: "mutate",
                table: "Bridge",
                where: [uuidCondition("_uuid", bridgeUuid)],
                mutations: [
                    ["ports", "insert", ["uuid", portUuid]]
                ]
            }
        ];
        await this.client.transact("Open_vSwitch", operations);
    }

    /**
     * Sets the controller for this bridge.
     * @param controller - The Controller instance to set.
     */
    async setController(controller: Controller): Promise<void> {
        const bridgeUuid = await this.getUuid();
        const controllerUuid = await controller.getUuid();

        const operations: DatabaseOperation[] = [
            {
                op: "mutate",
                table: "Bridge",
                where: [uuidCondition("_uuid", bridgeUuid)],
                mutations: [
                    ["controller", "insert", ["uuid", controllerUuid]]
                ]
            }
        ];
        await this.client.transact("Open_vSwitch", operations);
    }
}
