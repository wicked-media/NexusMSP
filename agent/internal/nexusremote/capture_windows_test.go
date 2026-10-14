//go:build windows

package nexusremote

import "testing"

func TestWindowsDesktopCaptureProducesJPEG(t *testing.T) {
	frame, err := (WindowsDesktopCapture{}).CaptureJPEG(65)
	if err != nil {
		t.Fatalf("capture desktop: %v", err)
	}
	if len(frame) < 128 {
		t.Fatalf("capture produced an implausibly small JPEG: %d bytes", len(frame))
	}
	t.Logf("captured JPEG size: %d bytes", len(frame))
}
