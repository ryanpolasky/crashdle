FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN NODE_ENV=development npm install --legacy-peer-deps
ENV PATH /app/node_modules/.bin:$PATH
COPY . .
RUN npm run build

# Stage 2
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]