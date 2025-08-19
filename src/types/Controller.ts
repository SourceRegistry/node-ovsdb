import {DatabaseOperation, OVSDBClient, OvsdbError} from "../index";

/**
 * Wrapper class for the 'Controller' table.
 */
export class Controller {
    public readonly target: string;
    private _uuid: string | null = null;
    private client: OVSDBClient;

    constructor(target: string, client: OVSDBClient) {
        this.client = client;
        this.target = target;
    }

    /**
     * Creates a new controller in the OVS database.
     * @param client - The OVSDB client instance.
     * @param target - The target address (e.g., "tcp:127.0.0.1:6653").
     * @returns A Promise that resolves to a new Controller instance.
     */
    static async create(target: string, client: OVSDBClient): Promise<Controller> {
        const controller = new Controller(target, client);
        const operations: DatabaseOperation[] = [
            {
                op: "insert",
                table: "Controller",
                row: {target},
                uuidName: "new_controller"
            }
        ];
        await client.transact("Open_vSwitch", operations);
        return controller;
    }

    /**
     * Gets the UUID of the controller by querying the database.
     * @public
     */
    public async getUuid(): Promise<string> {
        if (this._uuid) return this._uuid;

        const result = await this.client.transact("Open_vSwitch", [
            {
                op: "select",
                table: "Controller",
                where: [["target", "==", this.target]],
                columns: ["_uuid"]
            }
        ]);

        const rows = result[0] as { _uuid: string }[] | OvsdbError;
        if ('error' in rows) {
            throw new Error(`Failed to get UUID for controller ${this.target}: ${rows.error}`);
        }
        if (rows.length === 0) {
            throw new Error(`Controller ${this.target} not found`);
        }
        this._uuid = rows[0]._uuid;
        return this._uuid;
    }
}
