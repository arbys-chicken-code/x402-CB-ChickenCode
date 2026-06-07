# AgentForge Intelligence Suite — production container.
#
# IMPORTANT: build with the REPOSITORY ROOT as the build context, because this
# example links to the x402 packages by relative path inside the monorepo.
#
#   docker build -f examples/typescript/servers/agentforge/Dockerfile -t agentforge .
#
# On Railway / Render / Fly.io: set the Dockerfile path to
# "examples/typescript/servers/agentforge/Dockerfile" and leave the build
# context at the repo root (the default).

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate
WORKDIR /repo

# 1) Build the x402 core packages the suite depends on (produces their dist/).
COPY typescript ./typescript
RUN cd typescript \
 && pnpm install --no-frozen-lockfile \
 && pnpm exec turbo run build \
      --filter=@x402/mcp \
      --filter=@x402/express \
      --filter=@x402/evm \
      --filter=@x402/extensions

# 2) Install the examples workspace (symlinks to the freshly built packages).
COPY examples ./examples
RUN cd examples/typescript && pnpm install --no-frozen-lockfile

# 3) Run the suite.
WORKDIR /repo/examples/typescript/servers/agentforge

# Defaults; override at deploy time. EVM_ADDRESS and FACILITATOR_URL are required.
ENV NODE_ENV=production \
    HTTP_PORT=4021 \
    MCP_PORT=4022 \
    NETWORK=eip155:84532 \
    FACILITATOR_URL=https://x402.org/facilitator

EXPOSE 4021 4022

# Lightweight liveness probe against the REST health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.HTTP_PORT||4021)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
