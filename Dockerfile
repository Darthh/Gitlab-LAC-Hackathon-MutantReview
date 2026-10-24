# Front Desk console for Cloud Run. Evidence is produced by CI (demo:evidence) and copied in.
FROM node:24.16.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ARG REVISION=unavailable
ENV REVISION=$REVISION HOST=0.0.0.0 PORT=8080
EXPOSE 8080
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/front-desk/server/index.ts", "--production"]
