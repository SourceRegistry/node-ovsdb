# @sourceregistry/node-ovsdb

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![npm version](https://img.shields.io/npm/v/%40sourceregistry%2Fnode-ovsdb)](https://www.npmjs.com/package/@sourceregistry/node-ovsdb)
[![codecov](https://codecov.io/gh/SourceRegistry/node-ovsdb/graph/badge.svg)](https://codecov.io/gh/SourceRegistry/node-ovsdb)
[![Release to NPM](https://github.com/SourceRegistry/node-ovsdb/actions/workflows/publish-npm.yml/badge.svg)](https://github.com/SourceRegistry/node-ovsdb/actions/workflows/publish-npm.yml)

Low-level OVSDB client for Node.js with:

- Unix socket, TCP, and TLS transports
- RFC 7047 core RPC support
- Open vSwitch monitor extensions
- typed transaction and monitor payloads
- event-driven notifications
- schema-to-TypeScript generation CLI
- TSDoc-ready public API for Typedoc

## Installation

```bash
npm install @sourceregistry/node-ovsdb
```

Generate types from a schema with:

```bash
npx ovsdb-generate --help
```

## What It Supports

The client is intentionally low-level and maps closely to the wire protocol.

- `list_dbs`
- `get_schema`
- `transact`
- `cancel`
- `monitor`
- `monitor_cond`
- `monitor_cond_since`
- `monitor_cancel`
- `lock`
- `steal`
- `unlock`
- `echo`
- `set_db_change_aware`
- notifications: `update`, `update2`, `update3`, `locked`, `stolen`

## Quick Start

Unix socket:

```ts
import {OVSDBClient} from "@sourceregistry/node-ovsdb";

const client = new OVSDBClient({
  socketPath: "/var/run/openvswitch/db.sock",
  timeout: 5000
});

try {
  await client.connect();

  const databases = await client.listDbs();
  const schema = await client.getSchema("Open_vSwitch");

  console.log(databases, schema.version);
} finally {
  await client.close();
}
```

Plain TCP:

```ts
import {OVSDBClient} from "@sourceregistry/node-ovsdb";

const client = new OVSDBClient({
  host: "127.0.0.1",
  port: 6640
});
```

TLS:

```ts
import {OVSDBClient} from "@sourceregistry/node-ovsdb";

const client = new OVSDBClient({
  host: "ovsdb.example.internal",
  port: 6640,
  tls: true,
  tlsOptions: {
    servername: "ovsdb.example.internal",
    rejectUnauthorized: true
  }
});
```

## Schema Generation

The package includes an `ovsdb-generate` CLI that emits TypeScript row and database model types you can use with `OVSDBClient<...>`.

Generate from a checked-in schema file:

```bash
npx ovsdb-generate --schema ./Open_vSwitch.schema.json --out ./src/generated/ovsdb.ts
```

Generate directly from a live OVSDB server:

```bash
npx ovsdb-generate --socket /var/run/openvswitch/db.sock --db Open_vSwitch --out ./src/generated/ovsdb.ts
```

Generate from a live TCP endpoint:

```bash
npx ovsdb-generate --host 127.0.0.1 --port 6640 --db Open_vSwitch --out ./src/generated/ovsdb.ts
```

Generate from a live TLS endpoint:

```bash
npx ovsdb-generate \
  --host ovsdb.example.internal \
  --port 6640 \
  --tls \
  --tls-ca-file ./pki/ca.pem \
  --tls-cert-file ./pki/client.pem \
  --tls-key-file ./pki/client.key \
  --db Open_vSwitch \
  --out ./src/generated/ovsdb.ts
```

You can override the generated top-level type name with `--name OpenVSwitchDb`.

## Typed Transactions

You can provide your own table model to get typed table names, rows, selected columns, conditions, mutations, and tuple-shaped transaction results.

```ts
import {OVSDBClient, type DatabaseOperation, type OvsSet} from "@sourceregistry/node-ovsdb";

type OpenVSwitchDb = {
  Bridge: {
    name: string;
    ports: OvsSet<string>;
  };
  Port: {
    name: string;
    interfaces: OvsSet<string>;
  };
};

const client = new OVSDBClient<OpenVSwitchDb>();
await client.connect();

const operations = [
  {
    op: "select",
    table: "Bridge",
    where: [["name", "==", "br-int"]],
    columns: ["name", "ports"]
  },
  {
    op: "insert",
    table: "Port",
    row: {
      name: "uplink0",
      interfaces: ["set", []]
    }
  }
] satisfies [DatabaseOperation<OpenVSwitchDb>, DatabaseOperation<OpenVSwitchDb>];

const [bridges, insertedPort] = await client.transact("Open_vSwitch", operations);
```

For a higher-level staged flow, use `client.transaction(...)`. The callback can build operations against a transaction-scoped helper, and the library will send one `transact` request only if the callback completes successfully. By default it appends a trailing `commit` operation automatically.

```ts
const outcome = await client.transaction("Open_vSwitch", (tx) => {
  tx.comment("prepare bridge lookup");
  tx.select({
    op: "select",
    table: "Bridge",
    where: [["name", "==", "br-int"]],
    columns: ["name"]
  });

  return "ok";
});
```

## Monitoring

```ts
import {OVSDBClient} from "@sourceregistry/node-ovsdb";

const client = new OVSDBClient();
await client.connect();

client.on("update", (notification) => {
  const [monitorId, updates] = notification.params;
  console.log("monitor", monitorId, updates);
});

await client.monitor("Open_vSwitch", "bridges", {
  Bridge: {
    columns: ["name"],
    select: {
      initial: true,
      insert: true,
      modify: true,
      delete: true
    }
  }
});
```

For conditional monitoring, use `monitorCond()` or `monitorCondSince()`.

### Detect When an Interface Is Attached to a Bridge

OVSDB does not usually emit a single semantic event like "interface attached to bridge". Instead, you observe the row changes that together mean an attachment happened:

- a new `Interface` row may appear
- a new `Port` row may appear
- an existing `Bridge` row may be modified so its `ports` set now includes that port

In practice, the bridge update is usually the strongest signal that something was attached to the virtual switch.

Why this works:

- the `Bridge.ports` column is the relationship that tells you which ports are attached to the bridge
- when that set grows, something new was connected to the bridge
- you can then inspect `Port` and `Interface` tables to resolve names or metadata for the newly attached objects

If you want richer correlation, monitor `Bridge`, `Port`, and `Interface` together and keep a small in-memory cache keyed by UUID so you can map a changed bridge port set back to the concrete port and interface names.

Example: [examples/detect-interface-added.ts](./examples/detect-interface-added.ts)

## Common OVS Workflows

These examples focus on patterns that show up often in virtualized environments, where OVS is used to connect VM or container networking to a virtual switch.

### Create a Bridge With an Internal Interface

What this does:

- creates an `Interface` row of type `internal`
- creates a `Port` that owns that interface
- creates a `Bridge` that owns that port

Why it is done this way:

- in OVS, a bridge usually owns ports, and ports own interfaces
- creating all three rows in one transaction keeps the change atomic
- named UUIDs let later operations refer to rows inserted earlier in the same transaction

Example: [examples/bridge-port-interface.ts](./examples/bridge-port-interface.ts)

### Attach a New Interface to an Existing Bridge

What this does:

- creates a new `Interface`
- creates a `Port` that references that interface
- mutates the existing bridge so the new port is added to its `ports` set

Why this is a common pattern:

- hypervisors and container hosts often attach new virtual NICs dynamically
- mutating the bridge `ports` set avoids rewriting the whole bridge row
- keeping it in one transaction prevents partial attachment state

Example: [examples/attach-interface-to-bridge.ts](./examples/attach-interface-to-bridge.ts)

In practice, `type: "internal"` is useful when you want OVS itself to create the interface device. Leaving `type` unset is common when attaching an already existing device such as a tap interface created by a hypervisor.

## Resource Management

The client implements `AsyncDisposable`, so it also works with `await using` in runtimes that support explicit resource management.

```ts
await using client = new OVSDBClient();
await client.connect();
const dbs = await client.listDbs();
```

## Error Handling

- Transport/request failures reject with `Error`
- OVSDB JSON-RPC errors reject with `OvsdbRpcError`
- malformed inbound frames emit `protocolError`
- socket-level failures emit `transportError`

## Documentation

Generate API docs with Typedoc:

```bash
npm run docs:build
```

The public API is documented with TSDoc so the generated output is usable as a reference, not just a symbol dump.

## Roadmap

Planned work for the next iterations of the library:

- relation-aware schema generation so UUID reference columns can emit stronger types such as `PortRef` or `InterfaceRef` instead of plain `Uuid`
- richer codegen metadata for table relationships derived from `refTable` and `refType`
- helper utilities for working with generated reference types in transactions and monitor snapshots
- live TLS integration coverage for the transport and generator CLI
- stricter runtime validation for inbound notifications and response payloads

The intended direction is to make the generator more relation-aware first, before attempting a larger ORM-style layer.

## Development

```bash
npm test
npm run build
npm run docs:build
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
