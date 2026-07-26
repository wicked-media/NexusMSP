// Package transport is a thin HTTP client tailored for the agent.
package transport

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
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

// SetClientIdentity presents the issued device certificate when the Nexus API
// is fronted by an mTLS-validating reverse proxy. Bearer-token authentication
// remains enabled during migration and for direct local development.
func (c *Client) SetClientIdentity(certificatePath, privateKeyPath string) error {
	if strings.TrimSpace(certificatePath) == "" || strings.TrimSpace(privateKeyPath) == "" {
		return errors.New("device certificate and private key paths are required")
	}
	certificate, err := tls.LoadX509KeyPair(certificatePath, privateKeyPath)
	if err != nil {
		return fmt.Errorf("load device identity: %w", err)
	}
	baseTransport := http.DefaultTransport.(*http.Transport).Clone()
	baseTransport.TLSClientConfig = &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{certificate},
	}
	c.mu.Lock()
	c.http.Transport = baseTransport
	c.mu.Unlock()
	return nil
}

// Do issues an authenticated JSON request and decodes the response.
// `result` may be nil if you don't need the body.
func (c *Client) Do(method, path string, body any, result any) error {
	url := c.base + path
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "nexus-agent/"+c.version)

	c.mu.RLock()
	tok := c.token
	c.mu.RUnlock()
	if tok != "" {
		req.Header.Set("X-Agent-Token", tok)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = resp.Status
		}
		return &HTTPError{Status: resp.StatusCode, Message: msg}
	}

	if result != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, result); err != nil {
			return fmt.Errorf("decode response: %w (body=%s)", err, string(respBody))
		}
	}
	return nil
}

// Download retrieves an authenticated binary or artifact and writes it to a
// caller-provided temporary path. The caller is responsible for verifying any
// expected fingerprint before making the artifact active.
func (c *Client) Download(path, destination string) error {
	req, err := http.NewRequest(http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "nexus-agent/"+c.version)
	c.mu.RLock()
	token := c.token
	c.mu.RUnlock()
	if token != "" {
		req.Header.Set("X-Agent-Token", token)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		body, _ := io.ReadAll(response.Body)
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = response.Status
		}
		return &HTTPError{Status: response.StatusCode, Message: message}
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, response.Body)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
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
