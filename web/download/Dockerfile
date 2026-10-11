FROM nginx:1.27-alpine
COPY index.html orbit-ui.css orbit-ui.js /usr/share/nginx/html/
COPY art/ /usr/share/nginx/html/art/
COPY downloads/ /usr/share/nginx/html/downloads/
# Production Compose mounts the existing HTTP/feedback routing configuration.
