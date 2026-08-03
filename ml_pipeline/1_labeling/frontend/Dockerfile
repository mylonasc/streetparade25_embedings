FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_ANNOTATION_API_BASE_URL=http://localhost:8100
ENV VITE_ANNOTATION_API_BASE_URL=$VITE_ANNOTATION_API_BASE_URL

COPY package.json package-lock.json* ./
RUN npm install

COPY index.html ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
