FROM debian:bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openvswitch-switch ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/ovsdb/entrypoint.sh /usr/local/bin/ovsdb-entrypoint.sh

RUN chmod +x /usr/local/bin/ovsdb-entrypoint.sh

EXPOSE 6640

ENTRYPOINT ["/usr/local/bin/ovsdb-entrypoint.sh"]
