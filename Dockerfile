# Dockerfile

# Stage 1: Build Frontend
FROM node:16 AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:16 AS backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./

# Stage 3: Final Stage
FROM node:16
WORKDIR /app
COPY --from=frontend /app/frontend/.next/ ./.next/
COPY --from=frontend /app/frontend/public/ ./public/
COPY --from=backend /app/backend/ .
EXPOSE 3000
CMD [ "npm", "start" ]