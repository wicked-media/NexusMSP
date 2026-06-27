// Package transport is a thin HTTP client tailored for the agent.
package transport

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Client struct {
	base    string
	version string
	token   string
	mu      sync.RWMutex
	http    *http.Client
}

func New(serverURL, version string) *Client {
	return &Client{
		base:    strings.TrimRight(serverURL, "/"),
		version: version,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) SetToken(t string) {
	c.mu.Lock()
	c.token = t
	c.mu.Unlock()
}

// Do issues an authenticated JSON request and decodes the response.
// `result` may be nil if you don't need the body.
func (c *Client) Do(method, path string, body any, result any) error {
	url := c.base + path
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil { return fmt.Errorf("marshal: %w", err) }
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil { return err }
	if reqBody != nil { req.Header.Set("Content-Type", "application/json") }
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "nexus-agent/"+c.version)

	c.mu.RLock()
	tok := c.token
	c.mu.RUnlock()
	if tok != "" {
		req.Header.Set("X-Agent-Token", tok)
	}

	resp, err := c.http.Do(req)
	if err != nil { return err }
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" { msg = resp.Status }
		return &HTTPError{Status: resp.StatusCode, Message: msg}
	}

	if result != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, result); err != nil {
			return fmt.Errorf("decode response: %w (body=%s)", err, string(respBody))
		}
	}
	return nil
}

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("http %d: %s", e.Status, e.Message) }

// IsAuth returns true if the error indicates an auth problem (token rotation needed).
func IsAuth(err error) bool {
	var he *HTTPError
	return errors.As(err, &he) && (he.Status == 401 || he.Status == 403)
}
