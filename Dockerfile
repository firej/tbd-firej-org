# ── builder ──────────────────────────────────────────────────
FROM golang:1.25-bookworm AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -ldflags '-w -s' -o tobedone ./cmd/server/main.go

# ── runtime ──────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates tzdata && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/tobedone .
COPY static/    ./static/
COPY templates/ ./templates/

ENV PORT=8080
ENV DATABASE_DSN=tobedone:tobedone@tcp(mariadb:3306)/tobedone?parseTime=true&charset=utf8mb4&loc=UTC
ENV SESSION_SECRET=change-me-in-production
ENV SECURE_COOKIE=false

EXPOSE 8080
CMD ["./tobedone"]
