# Used by MCP directories (e.g. Glama) to build and inspect the server.
# Real users run it locally with `npx -y saywatch-mcp`; recordings are read from a mounted folder.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
RUN mkdir -p /data/recordings
ENTRYPOINT ["node", "server.mjs", "--dir", "/data"]
