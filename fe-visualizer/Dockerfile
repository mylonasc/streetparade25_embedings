FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=
ARG VITE_BASE_PATH=/
ARG VITE_ENABLE_SONG_DL_AND_EMBEDINGS=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_ENABLE_SONG_DL_AND_EMBEDINGS=$VITE_ENABLE_SONG_DL_AND_EMBEDINGS

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html vite.config.ts ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
