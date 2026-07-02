FROM node:lts-trixie-slim AS base
ARG USER_UID=1000
ARG USER_GID=1000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu curl gh git wget ripgrep python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# Modify the existing node user/group to have the specified UID/GID to match host user
RUN usermod -u $USER_UID --non-unique node \
  && groupmod -g $USER_GID --non-unique node \
  && usermod -g $USER_GID -d /paperclip node

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/skills-catalog/package.json packages/skills-catalog/
COPY packages/adapters/acpx-local/package.json packages/adapters/acpx-local/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-cloud/package.json packages/adapters/cursor-cloud/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/grok-local/package.json packages/adapters/grok-local/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY --parents packages/plugins/sandbox-providers/./*/package.json packages/plugins/sandbox-providers/
COPY packages/plugins/paperclip-plugin-fake-sandbox/package.json packages/plugins/paperclip-plugin-fake-sandbox/
COPY packages/plugins/plugin-llm-wiki/package.json packages/plugins/plugin-llm-wiki/
COPY packages/plugins/plugin-workspace-diff/package.json packages/plugins/plugin-workspace-diff/
COPY patches/ patches/
COPY scripts/link-plugin-dev-sdk.mjs scripts/

RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
# Temp workaround (DEMO): patch cursor-cloud out of source so the build
# produces a clean dist AND the tsx-loaded source at runtime is clean.
# (tsx prefers .ts over .js, so patching dist alone is insufficient.)
# Remove this block once @paperclipai/adapter-cursor-cloud's @cursor+sdk
# ajv ESM init is fixed upstream.
RUN python3 <<'PYEOF'
import sys
def patch(p):
    lines = open(p).read().split('\n')
    n = len(lines)
    to_comment = set()
    # 1) cursor-cloud import blocks (single or multi-line)
    i = 0
    while i < n:
        line = lines[i]
        if 'from "@paperclipai/adapter-cursor-cloud' in line and ';' in line:
            if line.lstrip().startswith('import '):
                to_comment.add(i)
                i += 1
                continue
            # multi-line: walk back to the opening "import {" line
            j = i
            while j > 0 and not lines[j].lstrip().startswith('import {'):
                j -= 1
            for k in range(j, i + 1):
                to_comment.add(k)
            i += 1
        else:
            i += 1
    # 2) const cursorCloudAdapter / cursorCloudCLIAdapter block
    i = 0
    while i < n:
        ls = lines[i].lstrip()
        if ls.startswith('const cursorCloudAdapter') or ls.startswith('const cursorCloudCLIAdapter'):
            j = i
            while j < n and not lines[j].startswith('};'):
                j += 1
            for k in range(i, j + 1):
                to_comment.add(k)
            i = j + 1
        else:
            i += 1
    # 3) array entry
    for idx, line in enumerate(lines):
        if line.strip() in ('cursorCloudAdapter,', 'cursorCloudCLIAdapter,'):
            to_comment.add(idx)
    for idx in sorted(to_comment):
        if not lines[idx].lstrip().startswith('//'):
            lines[idx] = '// DEMO ' + lines[idx]
    open(p, 'w').write('\n'.join(lines))
    print(f'patched {p}: {len(to_comment)} lines')

for p in ['/app/server/src/adapters/registry.ts', '/app/cli/src/adapters/registry.ts']:
    patch(p)
PYEOF
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/plugin-sdk build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
ARG USER_UID=1000
ARG USER_GID=1000
WORKDIR /app
COPY --chown=node:node --from=build /app /app
# Temp workaround (DEMO): remove cursor-cloud adapter until upstream
# @paperclipai/adapter-cursor-cloud's @cursor+sdk ajv ESM init is fixed.
# The build stage already patches the source so the compiled dist is clean.
# We only need to remove the package files (so a stray require() can't find it).
RUN rm -rf /app/packages/adapters/cursor-cloud \
  && rm -rf /app/node_modules/.pnpm/@cursor+sdk* \
  && find /app -path '*/node_modules/@cursor*' -prune -exec rm -rf {} + || true
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssh-client jq \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /paperclip \
  && chown node:node /paperclip

COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  USER_UID=${USER_UID} \
  USER_GID=${USER_GID} \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  OPENCODE_ALLOW_ALL_MODELS=true

VOLUME ["/paperclip"]
EXPOSE 3100

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
