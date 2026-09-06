# 靜態 SPA：dist 於本機 build（環境變數在 build 時注入），容器只負責 serve
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 8080
