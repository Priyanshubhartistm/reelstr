FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -o /crew .

FROM alpine:3.21
COPY --from=build /crew /crew
# RELAY_SECRET must be set and kept: group state is signed by it
ENV PORT=3335 DB_PATH=/data/crew
VOLUME /data
EXPOSE 3335
CMD ["/crew"]
