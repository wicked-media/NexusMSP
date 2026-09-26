VERSION ?= 0.1.13-companion-health
LDFLAGS  = -s -w -X main.Version=$(VERSION)

.PHONY: all windows chat windows-chat windows-tray windows-remote linux edge-linux edge-windows test clean fmt vet tidy

all: windows windows-chat windows-tray

windows:
	@mkdir -p dist
	@echo ">> building windows/amd64 nexus-agent ($(VERSION))"
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o dist/nexus-agent.exe ./cmd/nexus-agent
	@ls -lah dist/nexus-agent.exe

windows-chat:
	@mkdir -p dist
	@echo ">> building windows/amd64 nexus-client-chat ($(VERSION))"
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o dist/nexus-client-chat.exe ./cmd/nexus-chat
	@ls -lah dist/nexus-client-chat.exe

windows-tray:
	@mkdir -p dist
	@echo ">> building windows/amd64 nexus-agent-tray ($(VERSION))"
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS) -H=windowsgui" -o dist/nexus-agent-tray.exe ./cmd/nexus-tray
	@ls -lah dist/nexus-agent-tray.exe

windows-remote:
	@mkdir -p dist
	@echo ">> building windows/amd64 nexus-remote-companion ($(VERSION))"
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o dist/nexus-remote-companion.exe ./cmd/nexus-remote-companion
	@ls -lah dist/nexus-remote-companion.exe

linux:
	@mkdir -p dist
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o dist/nexus-agent ./cmd/nexus-agent
	@ls -lah dist/nexus-agent

edge-linux:
	@mkdir -p dist
	@echo ">> building linux/amd64 nexus-edge ($(VERSION))"
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o dist/nexus-edge ./cmd/nexus-edge
	@ls -lah dist/nexus-edge

edge-windows:
	@mkdir -p dist
	@echo ">> building windows/amd64 nexus-edge ($(VERSION))"
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o dist/nexus-edge.exe ./cmd/nexus-edge
	@ls -lah dist/nexus-edge.exe

fmt:
	go fmt ./...

vet:
	go vet ./...

tidy:
	go mod tidy

test:
	go test ./...

clean:
	rm -rf dist
