import {OVSDBClient, type OvsSet, type Uuid} from "../src";

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
 * Watches bridge updates and detects when a port set grows.
 *
 * OVSDB normally reports row changes, not a single high-level event like
 * "interface attached to bridge", so this example derives that meaning from
 * `Bridge.ports` modifications.
 */
async function main(): Promise<void> {
    const client = new OVSDBClient<OpenVSwitchDb>();

    try {
        await client.connect();

        client.on("update", (notification) => {
            const [, updates] = notification.params;
            const bridgeUpdates = updates.Bridge;
            if (!bridgeUpdates) {
                return;
            }

            for (const rowUpdate of Object.values(bridgeUpdates)) {
                const oldPorts = rowUpdate.old?.ports?.[1] ?? [];
                const newPorts = rowUpdate.new?.ports?.[1] ?? [];

                if (newPorts.length > oldPorts.length) {
                    console.log("A port was attached to a bridge", {
                        bridgeName: rowUpdate.new?.name ?? rowUpdate.old?.name,
                        oldPorts,
                        newPorts
                    });
                }
            }
        });

        await client.monitor("Open_vSwitch", "bridge-watch", {
            Bridge: {
                columns: ["name", "ports"],
                select: {
                    initial: false,
                    insert: false,
                    modify: true,
                    delete: false
                }
            }
        });
    } finally {
        await client.close();
    }
}

void main();
