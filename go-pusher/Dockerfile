FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy module dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build the go-pusher binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /push ./cmd/push

# Use a scratch image for the absolute smallest footprint
FROM alpine:latest

# Certificates required for HTTPS requests to ConvoSpan
RUN apk --no-cache add ca-certificates tzdata

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy the compiled binary and set permissions
COPY --from=builder /push /push
RUN chown -R appuser:appgroup /app /push

# Switch to non-root user
USER appuser

# Execution command defaults to daemon mode polling every 60 seconds
CMD ["/push", "--daemon", "--interval", "60s", "--limit", "100"]
