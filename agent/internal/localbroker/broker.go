// Package localbroker provides the narrow user-session bridge owned by the
// protected Nexus Agent service. It keeps the long-lived device token out of
// the Chat and Tray companion processes while still allowing those companions
// to request their small, audited set of endpoint actions.
package localbroker

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"nexusagent/internal/config"
)

const Address = "127.0.0.1:5968"

const (
	maxRequestBytes  int64 = 128 * 1024
	maxResponseBytes int64 = 1024 * 1024
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

// Server is intentionally local-only. It is not a general HTTP proxy: each
// route maps to one backend endpoint and every request is bounded.
type Server struct {
	server *http.Server
	client *http.Client
	base   string
	token  string
}

// Start listens only on IPv4 loopback. The caller should log a non-fatal
// warning when another local process owns the port; the core Agent must keep
// running even if a user companion is unavailable.
func Start(cfg *config.Config) (*Server, error) {
	s, err := newServer(cfg, &http.Client{Timeout: 15 * time.Second})
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp4", Address)
	if err != nil {
		return nil, err
	}
	s.server = &http.Server{
		Handler:           s.handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() { _ = s.server.Serve(listener) }()
	return s, nil
}

func newServer(cfg *config.Config, client *http.Client) (*Server, error) {
	if cfg == nil || strings.TrimSpace(cfg.ServerURL) == "" || strings.TrimSpace(cfg.AgentToken) == "" {
		return nil, errors.New("an enrolled agent configuration is required")
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &Server{
		client: client,
		base:   strings.TrimRight(cfg.ServerURL, "/"),
		token:  cfg.AgentToken,
	}, nil
}

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", s.forward("/api/nexus-agent/local/status", http.MethodGet))
	mux.HandleFunc("/live-chat/session", s.forward("/api/live-chat/agent/session", http.MethodGet))
	mux.HandleFunc("/live-chat/messages", s.forward("/api/live-chat/agent/session/messages", http.MethodPost))
	mux.HandleFunc("/live-chat/typing", s.forward("/api/live-chat/agent/session/typing", http.MethodPost))
	mux.HandleFunc("/elevate/requests", s.forward("/api/nexus-elevate/agent/requests", http.MethodGet, http.MethodPost))
	mux.HandleFunc("/elevate/requests/", s.elevationStatus)
	return noStore(mux)
}

// Shutdown releases the local listener during an Agent stop or foreground exit.
func (s *Server) Shutdown(ctx context.Context) error {
	if s == nil || s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func (s *Server) elevationStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	requestID := strings.TrimPrefix(r.URL.Path, "/elevate/requests/")
	if !requestIDPattern.MatchString(requestID) {
		http.Error(w, "A valid request id is required", http.StatusBadRequest)
		return
	}
	s.proxy(w, r, "/api/nexus-elevate/agent/requests/"+requestID)
}

func (s *Server) forward(path string, allowedMethods ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		for _, method := range allowedMethods {
			if r.Method == method {
				s.proxy(w, r, path)
				return
			}
		}
		methodNotAllowed(w)
	}
}

func (s *Server) proxy(w http.ResponseWriter, r *http.Request, path string) {
	if r.ContentLength > maxRequestBytes {
		http.Error(w, "Request is too large", http.StatusRequestEntityTooLarge)
		return
	}
	var body io.Reader
	if r.Method == http.MethodPost {
		body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	}
	request, err := http.NewRequestWithContext(r.Context(), r.Method, s.base+path, body)
	if err != nil {
		http.Error(w, "NexusMSP is unavailable", http.StatusBadGateway)
		return
	}
	request.Header.Set("X-Agent-Token", s.token)
	// A user-session companion is intentionally never allowed to obtain an
	// automatic privilege grant. The API downgrades any matching auto-allow
	// policy to an auditable technician review until this bridge is replaced by
	// caller-bound Windows IPC.
	if strings.HasPrefix(path, "/api/nexus-elevate/agent/") {
		request.Header.Set("X-Nexus-Local-Companion", "1")
	}
	if r.Method == http.MethodPost {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := s.client.Do(request)
	if err != nil {
		http.Error(w, "NexusMSP is unavailable", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, maxResponseBytes))
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", "GET, POST")
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}
