//go:build windows

package nexusremote

import (
	"errors"
	"math"
	"syscall"
	"time"
	"unsafe"
)

// WindowsInputInjector is deliberately small: it maps a previously validated
// ControlEvent to Windows SendInput. It cannot execute a shell command,
// transfer data or change endpoint policy. The companion invokes it only after
// its local consent controller authorises the signed control grant.
type WindowsInputInjector struct{}

const (
	inputMouse    = 0
	inputKeyboard = 1

	mouseMove       = 0x0001
	mouseLeftDown   = 0x0002
	mouseLeftUp     = 0x0004
	mouseRightDown  = 0x0008
	mouseRightUp    = 0x0010
	mouseMiddleDown = 0x0020
	mouseMiddleUp   = 0x0040
	mouseAbsolute   = 0x8000
	mouseVirtualDesk = 0x4000

	keyEventKeyUp = 0x0002
)

var sendInput = syscall.NewLazyDLL("user32.dll").NewProc("SendInput")

// windowsInput retains the native INPUT union alignment on 64-bit Windows.
// The union is written using its documented binary offsets below.
type windowsInput struct {
	typ  uint32
	_    uint32
	data [32]byte
}

func (WindowsInputInjector) Inject(session *Session, event ControlEvent, now time.Time) error {
	if session == nil {
		return errors.New("native remote session is required")
	}
	if err := session.Authorize(true, now); err != nil {
		return err
	}
	validated, err := ValidateControlEvent(event)
	if err != nil {
		return err
	}
	input, err := windowsInputFor(validated)
	if err != nil {
		return err
	}
	count, _, callErr := sendInput.Call(1, uintptr(unsafe.Pointer(&input)), unsafe.Sizeof(input))
	if count != 1 {
		if callErr != nil && callErr != syscall.Errno(0) {
			return callErr
		}
		return errors.New("Windows rejected remote input")
	}
	return nil
}

func windowsInputFor(event ControlEvent) (windowsInput, error) {
	var result windowsInput
	switch event.Kind {
	case "pointer_move", "pointer_button":
		result.typ = inputMouse
		putU32(result.data[:], 0, uint32(math.Round(*event.X*65535)))
		putU32(result.data[:], 4, uint32(math.Round(*event.Y*65535)))
		// Absolute coordinates map over the full virtual desktop so input
		// lands on the monitor the technician clicked in the multi-display view.
		flags := uint32(mouseMove | mouseAbsolute | mouseVirtualDesk)
		if event.Kind == "pointer_button" {
			flags |= pointerButtonFlag(event.Button, *event.Pressed)
		}
		putU32(result.data[:], 12, flags)
	case "key":
		result.typ = inputKeyboard
		vk, ok := remoteVirtualKey(event.Key)
		if !ok {
			return windowsInput{}, errors.New("unsupported remote key")
		}
		putU16(result.data[:], 0, vk)
		if !*event.Pressed {
			putU32(result.data[:], 4, keyEventKeyUp)
		}
	default:
		return windowsInput{}, errors.New("unsupported remote input")
	}
	return result, nil
}

func pointerButtonFlag(button string, pressed bool) uint32 {
	switch button {
	case "left":
		if pressed {
			return mouseLeftDown
		}
		return mouseLeftUp
	case "right":
		if pressed {
			return mouseRightDown
		}
		return mouseRightUp
	case "middle":
		if pressed {
			return mouseMiddleDown
		}
		return mouseMiddleUp
	default:
		return 0
	}
}

func remoteVirtualKey(key string) (uint16, bool) {
	if len(key) == 1 && key[0] >= 'A' && key[0] <= 'Z' {
		return uint16(key[0]), true
	}
	if len(key) == 1 && key[0] >= '0' && key[0] <= '9' {
		return uint16(key[0]), true
	}
	keys := map[string]uint16{
		"BACKSPACE": 0x08, "TAB": 0x09, "ENTER": 0x0d, "SHIFT": 0x10, "CTRL": 0x11, "ALT": 0x12,
		"ESC": 0x1b, "SPACE": 0x20, "PAGEUP": 0x21, "PAGEDOWN": 0x22, "END": 0x23, "HOME": 0x24,
		"LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28, "DELETE": 0x2e,
		"F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F5": 0x74, "F6": 0x75,
		"F7": 0x76, "F8": 0x77, "F9": 0x78, "F10": 0x79, "F11": 0x7a, "F12": 0x7b,
	}
	value, ok := keys[key]
	return value, ok
}

func putU16(data []byte, offset int, value uint16) {
	data[offset] = byte(value)
	data[offset+1] = byte(value >> 8)
}

func putU32(data []byte, offset int, value uint32) {
	data[offset] = byte(value)
	data[offset+1] = byte(value >> 8)
	data[offset+2] = byte(value >> 16)
	data[offset+3] = byte(value >> 24)
}
