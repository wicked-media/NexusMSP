VERSION ?= 0.1.7-nexus-identity
LDFLAGS  = -s -w -X main.Version=$(VERSION)

.PHONY: all windows chat windows-chat linux test clean fmt vet tidy

all: windows

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

linux:
	@mkdir -p dist
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o dist/nexus-agent ./cmd/nexus-agent
	@ls -lah dist/nexus-agent

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
