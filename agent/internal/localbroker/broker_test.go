package localbroker

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nexusagent/internal/config"
)

func TestBrokerOnlyForwardsWhitelistedRoutesWithServiceToken(t *testing.T) {
	var gotPath, gotToken, gotCompanionChannel string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.Header.Get("X-Agent-Token")
		gotCompanionChannel = r.Header.Get("X-Nexus-Local-Companion")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"connected":true}`)
	}))
	defer upstream.Close()

	broker, err := newServer(&config.Config{
		ServerURL:  upstream.URL,
		AgentToken: "service-token",
	}, upstream.Client())
	if err != nil {
		t.Fatalf("newServer() error = %v", err)
	}

	handler := broker.handler()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/status", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}
	if gotPath != "/api/nexus-agent/local/status" {
		t.Fatalf("forwarded path = %q", gotPath)
	}
	if gotToken != "service-token" {
		t.Fatalf("forwarded token = %q", gotToken)
	}
	if gotCompanionChannel != "" {
		t.Fatalf("status unexpectedly marked as a companion elevation request: %q", gotCompanionChannel)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cache control = %q", response.Header().Get("Cache-Control"))
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/anything-else", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unmapped route code = %d, want %d", response.Code, http.StatusNotFound)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/live-chat/session", strings.NewReader(`{}`)))
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("disallowed method code = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}

func TestBrokerMarksLocalElevationRequestsForManualReview(t *testing.T) {
	var gotCompanionChannel string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCompanionChannel = r.Header.Get("X-Nexus-Local-Companion")
		w.WriteHeader(http.StatusAccepted)
	}))
	defer upstream.Close()

	broker, err := newServer(&config.Config{ServerURL: upstream.URL, AgentToken: "service-token"}, upstream.Client())
	if err != nil {
		t.Fatalf("newServer() error = %v", err)
	}

	response := httptest.NewRecorder()
	broker.handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/elevate/requests", strings.NewReader(`{}`)))
	if response.Code != http.StatusAccepted {
		t.Fatalf("elevation response code = %d, want %d", response.Code, http.StatusAccepted)
	}
	if gotCompanionChannel != "1" {
		t.Fatalf("companion marker = %q, want 1", gotCompanionChannel)
	}
}

func TestBrokerRejectsUntrustedElevationIdentifiers(t *testing.T) {
	broker, err := newServer(&config.Config{
		ServerURL:  "http://127.0.0.1:8000",
		AgentToken: "service-token",
	}, http.DefaultClient)
	if err != nil {
		t.Fatalf("newServer() error = %v", err)
	}

	response := httptest.NewRecorder()
	broker.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/elevate/requests/not%20valid", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid request id code = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestBrokerDoesNotExposeRemoteGrantAuthority(t *testing.T) {
	var gotPath, gotToken string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.Header.Get("X-Agent-Token")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	broker, err := newServer(&config.Config{ServerURL: upstream.URL, AgentToken: "service-token"}, upstream.Client())
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	broker.handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/remote/grants/session-123/ack", strings.NewReader(`{"outcome":"accepted"}`)))
	if response.Code != http.StatusNotFound {
		t.Fatalf("response code = %d", response.Code)
	}
	if gotPath != "" || gotToken != "" {
		t.Fatalf("unexpected forward path=%q token=%q", gotPath, gotToken)
	}

	response = httptest.NewRecorder()
	broker.handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/remote/grants/not%20valid/ack", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("invalid session id code = %d", response.Code)
	}
}
