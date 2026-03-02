import {OVSDBClient, type DatabaseOperation, type OvsSet, type Uuid} from "../src";

type OpenVSwitchDb = {
    Bridge: {
        name: string;
        ports: OvsSet<Uuid>;
    };
    Port: {
        name: string;
        interfaces: OvsSet<Uuid>;
    };
    Interface: {
        name: string;
        type?: string;
    };
};

/**
 * Attaches a new interface to an existing bridge in one atomic transaction.
 *
 * This is common when a hypervisor or container runtime creates a device first
 * and OVS must then attach it to an existing virtual switch.
 */
async function main(): Promise<void> {
    const client = new OVSDBClient<OpenVSwitchDb>();

    try {
        await client.connect();

        const operations = [
            {
                op: "insert",
                table: "Interface",
                uuidName: "if1",
                row: {
                    name: "tap100"
                }
            },
            {
                op: "insert",
                table: "Port",
                uuidName: "port1",
                row: {
                    name: "tap100",
                    interfaces: ["set", [["named-uuid", "if1"]]]
                }
            },
            {
                op: "mutate",
                table: "Bridge",
                where: [["name", "==", "br-int"]],
                mutations: [
                    ["ports", "insert", ["set", [["named-uuid", "port1"]]]]
                ]
            }
        ] satisfies [
            DatabaseOperation<OpenVSwitchDb>,
            DatabaseOperation<OpenVSwitchDb>,
            DatabaseOperation<OpenVSwitchDb>
        ];

        const results = await client.transact("Open_vSwitch", operations);
        console.log("Attached interface to bridge:", results);
    } finally {
        await client.close();
    }
}

void main();
