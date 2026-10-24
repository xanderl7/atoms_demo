# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app

# 先拷依赖清单利用层缓存：源码变了不用重装依赖
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
# 纯静态产物，nginx 托管即可；镜像里没有 Node、没有源码
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
