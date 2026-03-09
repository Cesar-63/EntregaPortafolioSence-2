FROM node:18-alpine

WORKDIR /app

# Instalar dependencias primero (aprovecha el cache de Docker)
COPY package*.json ./
RUN npm ci --only=production

# Copiar código fuente
COPY src/ ./src/

EXPOSE 3000

# Usar el server.js local que simula API Gateway
CMD ["node", "src/server.js"]