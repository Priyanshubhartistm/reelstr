# Bitcoin Core as patched for Mutinynet (its difficulty rules differ from stock, so stock bitcoind stalls at block 4031).
# Community fork: github.com/benthecarman/bitcoin, release mutinynet-inq-29. Pinned by SHA-256, valueless chain only.
FROM debian:bookworm-slim
ARG TAG=mutinynet-inq-29
ARG FILE=bitcoin-d091f70435c9-x86_64-linux-gnu.tar.gz
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /tmp/b.tgz "https://github.com/benthecarman/bitcoin/releases/download/$TAG/$FILE" \
  && curl -fsSL -o /tmp/SUMS "https://github.com/benthecarman/bitcoin/releases/download/$TAG/SHA256SUMS" \
  && grep " $FILE\$" /tmp/SUMS | sed "s# $FILE# /tmp/b.tgz#" | sha256sum -c - \
  && tar -xzf /tmp/b.tgz -C /opt && mv /opt/bitcoin-* /opt/bitcoin && rm /tmp/b.tgz /tmp/SUMS
ENV PATH=/opt/bitcoin/bin:$PATH
RUN useradd -m bitcoin && mkdir -p /home/bitcoin/.bitcoin && chown bitcoin:bitcoin /home/bitcoin/.bitcoin
USER bitcoin
ENTRYPOINT ["bitcoind"]
