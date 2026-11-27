# Backend Éclat Pressing — multi-stage, aucun Node requis.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/api ./cmd/api

FROM alpine:3.21
RUN addgroup -S eclat && adduser -S -G eclat eclat \
    && mkdir -p /var/lib/eclat/storage /app/migrations \
    && chown -R eclat:eclat /var/lib/eclat
COPY --from=build /out/api /app/api
COPY migrations /app/migrations
USER eclat
EXPOSE 8080
ENV ECLAT_MIGRATIONS_DIR=/app/migrations
ENTRYPOINT ["/app/api"]
