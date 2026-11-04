//go:build !windows

package nexusremote

import "errors"

// WindowsDesktopCapture is intentionally unavailable outside an attended
// Windows user session.
type WindowsDesktopCapture struct{}

func (WindowsDesktopCapture) CaptureJPEG(int) ([]byte, error) {
	return nil, errors.New("Windows desktop capture is unavailable on this platform")
}
