#!/usr/bin/env node

const {runCli} = require("../dist-cli/cli.js");

void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
