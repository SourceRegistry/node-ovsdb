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
 * Creates a bridge, a port, and an internal interface in one atomic transaction.
 *
 * This is a common OVS pattern in virtualized environments:
 * - the bridge acts like a virtual switch
 * - the port is the attachment point on that bridge
 * - the interface is the actual L2 endpoint created by OVS
 *
 * The transaction uses named UUIDs so later operations can reference rows
 * created earlier in the same transaction without a race.
 */
async function main(): Promise<void> {
    const client = new OVSDBClient<OpenVSwitchDb>();

    try {
        await client.connect();

        const operations = [
            {
                op: "insert",
                table: "Interface",
                uuidName: "if0",
                row: {
                    name: "vif-demo0",
                    type: "internal"
                }
            },
            {
                op: "insert",
                table: "Port",
                uuidName: "port0",
                row: {
                    name: "vif-demo0",
                    interfaces: ["set", [["named-uuid", "if0"]]]
                }
            },
            {
                op: "insert",
                table: "Bridge",
                row: {
                    name: "br-demo",
                    ports: ["set", [["named-uuid", "port0"]]]
                }
            }
        ] satisfies [
            DatabaseOperation<OpenVSwitchDb>,
            DatabaseOperation<OpenVSwitchDb>,
            DatabaseOperation<OpenVSwitchDb>
        ];

        const results = await client.transact("Open_vSwitch", operations);
        console.log("Created bridge stack:", results);
    } finally {
        await client.close();
    }
}

void main();
