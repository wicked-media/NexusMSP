package nexusremote

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"nexusagent/internal/transport"
)

func TestAgentAPIBindsOnlyNativeRemoteRoutes(t *testing.T) {
	var path, token string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, token = r.URL.Path, r.Header.Get("X-Agent-Token")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"grant":null}`))
	}))
	defer server.Close()
	client := transport.New(server.URL, "test")
	client.SetToken("agent-token")
	api, err := NewAgentAPI(client)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := api.Pending()
	if err != nil || grant != nil {
		t.Fatalf("pending grant=%v err=%v", grant, err)
	}
	if path != "/api/nexus-agent/native-remote/grants/pending" || token != "agent-token" {
		t.Fatalf("path=%q token=%q", path, token)
	}
}

func TestAgentAPIReadsProtectedGrantStatus(t *testing.T) {
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"active":false}`))
	}))
	defer server.Close()
	client := transport.New(server.URL, "test")
	client.SetToken("agent-token")
	api, err := NewAgentAPI(client)
	if err != nil {
		t.Fatal(err)
	}
	active, err := api.Status("session-1")
	if err != nil || active {
		t.Fatalf("active=%v err=%v", active, err)
	}
	if path != "/api/nexus-agent/native-remote/grants/session-1/status" {
		t.Fatalf("path=%q", path)
	}
}
