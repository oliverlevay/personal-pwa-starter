# Multi-stage: build the frontend, then run the zero-build (native TS) backend.
FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist
ENV NODE_ENV=production
ENV PORT=3000
# DATA_DIR should point at a mounted volume in production (Railway volume).
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "backend/server.ts"]
