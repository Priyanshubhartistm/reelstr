FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -o /relay .

FROM alpine:3.21
COPY --from=build /relay /relay
ENV PORT=3334 DB_PATH=/data/relay
VOLUME /data
EXPOSE 3334
CMD ["/relay"]
