package nexusremote

import (
	"errors"
	"strings"
)

// ControlEvent is the only input shape the protected bridge may forward to
// the user-session companion. It is deliberately not a command, macro,
// clipboard or file-transfer protocol.
type ControlEvent struct {
	Sequence uint64   `json:"sequence"`
	Kind     string   `json:"kind"`
	X        *float64 `json:"x,omitempty"`
	Y        *float64 `json:"y,omitempty"`
	Button   string   `json:"button,omitempty"`
	Pressed  *bool    `json:"pressed,omitempty"`
	Key      string   `json:"key,omitempty"`
}

// ValidateControlEvent normalises and restricts the envelope before the
// endpoint companion considers SendInput. Each injected event must still call
// Session.Authorize(true, now), so validation never grants input authority.
func ValidateControlEvent(event ControlEvent) (ControlEvent, error) {
	if event.Sequence == 0 {
		return ControlEvent{}, errors.New("remote control sequence is required")
	}
	event.Kind = strings.TrimSpace(strings.ToLower(event.Kind))
	switch event.Kind {
	case "pointer_move":
		if !normalised(event.X) || !normalised(event.Y) || event.Button != "" || event.Pressed != nil || event.Key != "" {
			return ControlEvent{}, errors.New("invalid pointer movement")
		}
	case "pointer_button":
		if !normalised(event.X) || !normalised(event.Y) || event.Pressed == nil || event.Key != "" {
			return ControlEvent{}, errors.New("invalid pointer button")
		}
		event.Button = strings.TrimSpace(strings.ToLower(event.Button))
		if event.Button != "left" && event.Button != "right" && event.Button != "middle" {
			return ControlEvent{}, errors.New("unsupported pointer button")
		}
	case "key":
		if event.X != nil || event.Y != nil || event.Button != "" || event.Pressed == nil {
			return ControlEvent{}, errors.New("invalid key input")
		}
		event.Key = strings.ToUpper(strings.TrimSpace(event.Key))
		if !allowedRemoteKey(event.Key) {
			return ControlEvent{}, errors.New("unsupported remote key")
		}
	default:
		return ControlEvent{}, errors.New("unsupported remote input")
	}
	return event, nil
}

func normalised(value *float64) bool {
	return value != nil && *value >= 0 && *value <= 1
}

func allowedRemoteKey(key string) bool {
	if len(key) == 1 && ((key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= '0' && key[0] <= '9')) {
		return true
	}
	switch key {
	case "ENTER", "ESC", "TAB", "BACKSPACE", "DELETE", "SPACE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "PAGEUP", "PAGEDOWN", "SHIFT", "CTRL", "ALT", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12":
		return true
	default:
		return false
	}
}
