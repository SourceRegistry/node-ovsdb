import {DatabaseOperation, Interface, OvsdbError} from "./index";
import {uuidCondition} from "../helpers/uuid.helper";
import {OVSDBClient} from "../index";

/**
 * Wrapper class for the 'Port' table.
 */
export class Port {
    public readonly name: string;
    private _uuid: string | null = null;
    private client: OVSDBClient;

    constructor(name: string, client: OVSDBClient) {
        this.client = client;
        this.name = name;
    }

    /**
     * Creates a new port in the OVS database.
     * @param client - The OVSDB client instance.
     * @param name - The name of the port.
     * @returns A Promise that resolves to a new Port instance.
     */
    static async create(name: string, client: OVSDBClient): Promise<Port> {
        const port = new Port(name, client);
        const operations: DatabaseOperation[] = [
            {
                op: "insert",
                table: "Port",
                row: {name},
                uuidName: "new_port"
            }
        ];
        await client.transact("Open_vSwitch", operations);
        return port;
    }

    /**
     * Gets the UUID of the port by querying the database.
     * @public
     */
    public async getUuid(): Promise<string> {
        if (this._uuid) return this._uuid;

        const result = await this.client.transact("Open_vSwitch", [
            {
                op: "select",
                table: "Port",
                where: [["name", "==", this.name]],
                columns: ["_uuid"]
            }
        ]);

        const rows = result[0] as { _uuid: string }[] | OvsdbError;
        if ('error' in rows) {
            throw new Error(`Failed to get UUID for port ${this.name}: ${rows.error}`);
        }
        if (rows.length === 0) {
            throw new Error(`Port ${this.name} not found`);
        }
        this._uuid = rows[0]._uuid;
        return this._uuid;
    }

    /**
     * Adds an interface to this port.
     * @param iface - The Interface instance to add.
     */
    async addInterface(iface: Interface): Promise<void> {
        const portUuid = await this.getUuid();
        const ifaceUuid = await iface.getUuid();

        const operations: DatabaseOperation[] = [
            {
                op: "mutate",
                table: "Port",
                where: [uuidCondition("_uuid", portUuid)],
                mutations: [
                    ["interfaces", "insert", ["uuid", ifaceUuid]]
                ]
            }
        ];
        await this.client.transact("Open_vSwitch", operations);
    }
}
