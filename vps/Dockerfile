FROM node:20-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    git curl jq unzip build-essential \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Pipeline SDK — install deps first for Docker layer caching
COPY pipeline/package.json /app/pipeline/package.json
RUN cd /app/pipeline && npm install

COPY pipeline/ /app/pipeline/

WORKDIR /app

# Symlink node_modules so tsx/sdk are resolvable from /app
RUN ln -s /app/pipeline/node_modules /app/node_modules

# Non-root user — UID/GID is set at runtime via docker-compose `user:` directive
# (Claude Code refuses --dangerously-skip-permissions as root)
RUN groupadd -g 1001 claude-agent \
    && useradd -m -u 1001 -g 1001 -s /bin/bash claude-agent \
    && chown -R claude-agent:claude-agent /app

# Entrypoint: configure git + gh auth, then start server
COPY vps/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Default non-root — overridden at runtime by docker-compose user: directive
USER claude-agent

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "--import", "tsx", "pipeline/server.ts"]
