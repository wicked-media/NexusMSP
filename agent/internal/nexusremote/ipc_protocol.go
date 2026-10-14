package nexusremote

// This protocol is deliberately credential-free. The protected Agent service
// owns its device token and bridges accepted frames to Nexus; the attended
// user-session companion sees only the public trust policy and signed grant.

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

const (
	// Every pipe is one-way. A native remote session must never use one duplex
	// stream for endpoint events, Agent control, and desktop frames: Windows can
	// block a writer behind an unread message in the opposite direction.
	CompanionPipeName      = `\\.\pipe\NexusRemoteCompanion-v1`        // Agent -> companion control
	CompanionEventPipeName = `\\.\pipe\NexusRemoteCompanion-events-v1` // companion -> Agent lifecycle events
	CompanionFramePipeName = `\\.\pipe\NexusRemoteCompanion-frames-v1` // companion -> Agent desktop frames
	maxIPCMessageSize      = 6 * 1024 * 1024
)

// DisplayInfo is one monitor rectangle in virtual-desktop frame coordinates.
// It carries geometry only so the viewer can present each monitor as its own
// view; no window titles, process names or desktop content ever travel in it.
type DisplayInfo struct {
	Index   int    `json:"index"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Primary bool   `json:"primary,omitempty"`
	Name    string `json:"name,omitempty"`
}

type IPCMessage struct {
	Type       string           `json:"type"`
	Grant      *DeliveredGrant  `json:"grant,omitempty"`
	Policy     *CompanionPolicy `json:"policy,omitempty"`
	SessionID  string           `json:"session_id,omitempty"`
	Outcome    string           `json:"outcome,omitempty"`
	Reason     string           `json:"reason,omitempty"`
	State      string           `json:"state,omitempty"`
	Active     bool             `json:"active,omitempty"`
	JPEGBase64 string           `json:"jpeg_b64,omitempty"`
	Displays   []DisplayInfo    `json:"displays,omitempty"`
	Control    *ControlEvent    `json:"control,omitempty"`
	// FramePipeReady is a lifecycle-only acknowledgement that the protected
	// Agent has created the isolated frame endpoint for this grant.
	FramePipeReady bool `json:"frame_pipe_ready,omitempty"`
	// EventPipeReady confirms that endpoint acknowledgements and transport
	// evidence have a separate protected uplink before consent is shown.
	EventPipeReady bool `json:"event_pipe_ready,omitempty"`
}

func WriteIPCMessage(writer io.Writer, message IPCMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if len(payload) == 0 || len(payload) > maxIPCMessageSize {
		return errors.New("native remote IPC message is too large")
	}
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)))
	if _, err := writer.Write(size[:]); err != nil {
		return err
	}
	_, err = writer.Write(payload)
	return err
}

func ReadIPCMessage(reader io.Reader) (IPCMessage, error) {
	var size [4]byte
	if _, err := io.ReadFull(reader, size[:]); err != nil {
		return IPCMessage{}, err
	}
	length := binary.BigEndian.Uint32(size[:])
	if length == 0 || length > maxIPCMessageSize {
		return IPCMessage{}, errors.New("native remote IPC message length is invalid")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return IPCMessage{}, err
	}
	var message IPCMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		return IPCMessage{}, err
	}
	return message, nil
}
