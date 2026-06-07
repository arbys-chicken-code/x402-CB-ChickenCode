# AgentForge Intelligence Suite — production container.
#
# IMPORTANT: build with the REPOSITORY ROOT as the build context, because this
# example links to the x402 packages by relative path inside the monorepo.
#
#   docker build -f examples/typescript/servers/agentforge/Dockerfile -t agentforge .
#
# On Railway the included root railway.json already points here and uses the
# repo root as context — no manual configuration needed.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate
WORKDIR /repo

# 1) Install + build ONLY the x402 packages this suite needs. Scoping the
#    install avoids pulling unrelated, heavy SDKs (Solana/Aptos/Stellar/CDP),
#    which keeps the build fast and within PaaS memory limits.
COPY typescript ./typescript
RUN cd typescript && pnpm install --no-frozen-lockfile \
      --filter "@x402/core..." \
      --filter "@x402/evm..." \
      --filter "@x402/extensions..." \
      --filter "@x402/mcp..." \
      --filter "@x402/express..."

# Build in dependency order (core first, then the rest) so type generation
# always resolves already-built upstream packages.
RUN cd typescript \
 && pnpm --filter "@x402/core" run build \
 && pnpm --filter "@x402/evm" --filter "@x402/extensions" run build \
 && pnpm --filter "@x402/mcp" --filter "@x402/express" run build

# 2) Install just this example (and its workspace deps) from the examples workspace.
COPY examples ./examples
RUN cd examples/typescript && pnpm install --no-frozen-lockfile \
      --filter "@x402/agentforge-intelligence-suite..."

# 3) Run the suite.
WORKDIR /repo/examples/typescript/servers/agentforge

# Defaults; override at deploy time. EVM_ADDRESS and FACILITATOR_URL are required.
# Railway/most PaaS inject PORT, which switches the suite to single-port mode.
ENV NODE_ENV=production \
    HTTP_PORT=4021 \
    MCP_PORT=4022 \
    NETWORK=eip155:84532 \
    FACILITATOR_URL=https://x402.org/facilitator

EXPOSE 4021 4022

# Lightweight liveness probe against the REST health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||process.env.HTTP_PORT||4021)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
