# @sourceregistry/node-ovsdb

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)


A lightweight, typesafe TypeScript client for the Open vSwitch Database (OVSDB) Management Protocol, as defined in [RFC 7047](https://datatracker.ietf.org/doc/html/rfc7047).

This library provides a low-level wrapper to interact with the OVSDB over a Unix socket, enabling programmatic configuration and management of Open vSwitch instances.

## Installation

Install the package using npm:

```bash
npm install @sourceregistry/node-ovsdb
```

## Usage

### Getting Started

The primary class is `OVSDBClient`, which handles the connection to the OVSDB server (typically located at `/var/run/openvswitch/db.sock`).

```typescript
import { OVSDBClient } from '@sourceregistry/node-ovsdb';

async function main() {
  // Create a new client instance
  const client = new OVSDBClient();

  try {
    // Connect to the OVSDB Unix socket
    await client.connect();
    console.log('Connected to OVSDB');

    // Example: Get the list of available databases
    const databases = await client.listDbs();
    console.log('Databases:', databases);

    // Example: Get the schema of the 'Open_vSwitch' database
    const schema = await client.getSchema('Open_vSwitch');
    console.log('OVS Version:', schema.version);

    // Example: Perform a transaction to select all bridges
    const operations = [
      {
        op: 'select',
        table: 'Bridge',
        where: [],
        columns: ['name']
      }
    ];

    const result = await client.transact('Open_vSwitch', operations);
    console.log('Bridges:', result);

  } catch (error) {
    console.error('An error occurred:', error.message);
  } finally {
    // Always close the connection
    client.close();
  }
}

main();
```

### Using Async Disposable (Recommended)

For guaranteed resource cleanup, use the client with the `using` statement (requires Node.js 18+ or the `--harmony-explicit-resource-management` flag):

```typescript
import { OVSDBClient } from '@sourceregistry/node-ovsdb';

async function main() {
  // The 'using' statement ensures the client is closed even if an error occurs
  using client = new OVSDBClient();

  await client.connect();
  console.log('Connected to OVSDB');

  const dbs = await client.listDbs();
  console.log('Available databases:', dbs);
}

main();
```

### Core Methods

The `OVSDBClient` class provides direct access to the core OVSDB RPC methods:

- `connect()`: Establishes a connection to the Unix socket.
- `listDbs()`: Retrieves the names of available databases.
- `getSchema(dbName)`: Retrieves the schema for a specific database.
- `transact(dbName, operations)`: Executes a series of database operations atomically.
- `monitor(...)`: Subscribes to database change notifications.
- `echo()`: Tests the connection liveness.
- `close()`: Closes the connection.

### Advanced: Entity Wrappers (Coming Soon)

For higher-level operations (e.g., `createBridge`, `addPort`), consider building wrapper classes on top of `OVSDBClient`. A future version of this library may include these.

## Development

### Prerequisites

- Node.js (v18 or higher recommended)

### Scripts

- `npm run dev`: Start the development server.
- `npm run build`: Compile the TypeScript code and generate the distribution files in the `dist/` directory.
- `npm run preview`: Preview the built application.
- `npm run test`: Run the test suite with Vitest.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the Apache-2.0 License. See the [LICENSE](LICENSE) file for details.
