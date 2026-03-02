#!/usr/bin/env bash
set -euo pipefail

mkdir -p /var/lib/openvswitch /var/run/openvswitch /var/log/openvswitch

if [ ! -f /var/lib/openvswitch/conf.db ]; then
    ovsdb-tool create /var/lib/openvswitch/conf.db /usr/share/openvswitch/vswitch.ovsschema
fi

ovsdb-server /var/lib/openvswitch/conf.db \
    --remote=punix:/var/run/openvswitch/db.sock \
    --remote=ptcp:6640:0.0.0.0 \
    --pidfile=/var/run/openvswitch/ovsdb-server.pid \
    --log-file=/var/log/openvswitch/ovsdb-server.log \
    --detach

ovs-vsctl --db=unix:/var/run/openvswitch/db.sock --no-wait init

exec tail -F /var/log/openvswitch/ovsdb-server.log
