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
	CompanionPipeName        = `\\.\pipe\NexusRemoteCompanion-v1`
	CompanionControlPipeName = `\\.\pipe\NexusRemoteCompanion-control-v1`
	maxIPCMessageSize        = 6 * 1024 * 1024
)

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
	Control    *ControlEvent    `json:"control,omitempty"`
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
