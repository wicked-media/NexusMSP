package nexusremote

import (
	"bytes"
	"testing"
)

func TestIPCMessageRoundTripAndBound(t *testing.T) {
	var buffer bytes.Buffer
	if err := WriteIPCMessage(&buffer, IPCMessage{Type: "ack", SessionID: "session-1", Outcome: "accepted"}); err != nil {
		t.Fatal(err)
	}
	message, err := ReadIPCMessage(&buffer)
	if err != nil || message.Type != "ack" || message.SessionID != "session-1" {
		t.Fatalf("message=%+v err=%v", message, err)
	}
	if err := WriteIPCMessage(&bytes.Buffer{}, IPCMessage{Type: "frame", JPEGBase64: string(make([]byte, maxIPCMessageSize))}); err == nil {
		t.Fatal("oversized IPC message accepted")
	}
}

func TestIPCStatusResponseRoundTrip(t *testing.T) {
	var buffer bytes.Buffer
	if err := WriteIPCMessage(&buffer, IPCMessage{Type: "status", SessionID: "session-1", Active: true}); err != nil {
		t.Fatal(err)
	}
	message, err := ReadIPCMessage(&buffer)
	if err != nil || message.Type != "status" || message.SessionID != "session-1" || !message.Active {
		t.Fatalf("message=%+v err=%v", message, err)
	}
}

func TestIPCGrantPreservesOneWayUplinkReadiness(t *testing.T) {
	var buffer bytes.Buffer
	if err := WriteIPCMessage(&buffer, IPCMessage{
		Type:           "grant",
		SessionID:      "session-one-way",
		FramePipeReady: true,
		EventPipeReady: true,
	}); err != nil {
		t.Fatal(err)
	}
	message, err := ReadIPCMessage(&buffer)
	if err != nil {
		t.Fatal(err)
	}
	if !message.FramePipeReady || !message.EventPipeReady {
		t.Fatalf("one-way uplink readiness was lost: %+v", message)
	}
}
