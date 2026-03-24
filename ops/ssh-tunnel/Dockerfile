FROM alpine:3.20

RUN apk add --no-cache autossh openssh-client netcat-openbsd

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
