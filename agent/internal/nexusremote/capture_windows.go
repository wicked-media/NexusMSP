//go:build windows

package nexusremote

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"syscall"
	"unsafe"
)

const (
	metricScreenWidth      = 0
	metricScreenHeight     = 1
	metricXVirtualScreen   = 76
	metricYVirtualScreen   = 77
	metricCXVirtualScreen  = 78
	metricCYVirtualScreen  = 79
	srccopy                = 0x00CC0020
	dibRGBColors           = 0
	biRGB                  = 0
	monitorInfoFPrimary    = 0x00000001
	maxRemoteDisplays      = 16
)

var (
	user32        = syscall.NewLazyDLL("user32.dll")
	gdi32         = syscall.NewLazyDLL("gdi32.dll")
	procGetDC            = user32.NewProc("GetDC")
	procReleaseDC        = user32.NewProc("ReleaseDC")
	procMetrics          = user32.NewProc("GetSystemMetrics")
	procEnumDisplayMons  = user32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfoW  = user32.NewProc("GetMonitorInfoW")
	procCreateDC  = gdi32.NewProc("CreateCompatibleDC")
	procCreateBMP = gdi32.NewProc("CreateCompatibleBitmap")
	procSelect    = gdi32.NewProc("SelectObject")
	procBitBlt    = gdi32.NewProc("BitBlt")
	procGetDIBits = gdi32.NewProc("GetDIBits")
	procDeleteDC  = gdi32.NewProc("DeleteDC")
	procDeleteObj = gdi32.NewProc("DeleteObject")
)

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type bitmapInfo struct{ Header bitmapInfoHeader }

type monitorRect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type monitorInfo struct {
	cbSize    uint32
	rcMonitor monitorRect
	rcWork    monitorRect
	dwFlags   uint32
}

// WindowsDesktopCapture captures the full visible virtual desktop, so every
// attached monitor is present in one bounded frame.  Secure desktop, lock
// screen and credential prompts are intentionally never captured.
type WindowsDesktopCapture struct{}

func systemMetric(name uintptr) int32 {
	value, _, _ := procMetrics.Call(name)
	return int32(uint32(value))
}

// Displays reports monitor geometry in virtual-desktop frame coordinates so
// the viewer can present each monitor as its own view of the captured frame.
// It is topology only: no window titles, process names or desktop content.
func (WindowsDesktopCapture) Displays() []DisplayInfo {
	originX := systemMetric(metricXVirtualScreen)
	originY := systemMetric(metricYVirtualScreen)
	var displays []DisplayInfo
	callback := syscall.NewCallback(func(monitor, _ uintptr, _ uintptr, _ uintptr) uintptr {
		if len(displays) >= maxRemoteDisplays {
			return 0
		}
		info := monitorInfo{cbSize: uint32(unsafe.Sizeof(monitorInfo{}))}
		ok, _, _ := procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&info)))
		if ok == 0 {
			return 1
		}
		display := DisplayInfo{
			Index:   len(displays),
			X:       int(info.rcMonitor.Left - originX),
			Y:       int(info.rcMonitor.Top - originY),
			Width:   int(info.rcMonitor.Right - info.rcMonitor.Left),
			Height:  int(info.rcMonitor.Bottom - info.rcMonitor.Top),
			Primary: info.dwFlags&monitorInfoFPrimary != 0,
			Name:    fmt.Sprintf("DISPLAY%d", len(displays)+1),
		}
		if display.X < 0 || display.Y < 0 || display.Width < 1 || display.Height < 1 {
			return 1
		}
		displays = append(displays, display)
		return 1
	})
	procEnumDisplayMons.Call(0, 0, callback, 0)
	return displays
}

func (WindowsDesktopCapture) CaptureJPEG(quality int) ([]byte, error) {
	if quality < 30 || quality > 85 {
		quality = 65
	}
	width := int(systemMetric(metricCXVirtualScreen))
	height := int(systemMetric(metricCYVirtualScreen))
	originX := systemMetric(metricXVirtualScreen)
	originY := systemMetric(metricYVirtualScreen)
	if width < 1 || height < 1 || width > 16384 || height > 16384 {
		return nil, errors.New("unsupported desktop dimensions")
	}
	w, h := width, height
	screen, _, callErr := procGetDC.Call(0)
	if screen == 0 {
		return nil, callErr
	}
	defer procReleaseDC.Call(0, screen)
	compatible, _, callErr := procCreateDC.Call(screen)
	if compatible == 0 {
		return nil, callErr
	}
	defer procDeleteDC.Call(compatible)
	bitmap, _, callErr := procCreateBMP.Call(screen, uintptr(w), uintptr(h))
	if bitmap == 0 {
		return nil, callErr
	}
	defer procDeleteObj.Call(bitmap)
	previous, _, _ := procSelect.Call(compatible, bitmap)
	defer procSelect.Call(compatible, previous)
	if result, _, err := procBitBlt.Call(compatible, 0, 0, uintptr(w), uintptr(h), screen, uintptr(originX), uintptr(originY), srccopy); result == 0 {
		return nil, err
	}
	info := bitmapInfo{Header: bitmapInfoHeader{Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: int32(w), Height: int32(h), Planes: 1, BitCount: 32, Compression: biRGB, SizeImage: uint32(w * h * 4)}}
	pixels := make([]byte, w*h*4)
	if result, _, err := procGetDIBits.Call(compatible, bitmap, 0, uintptr(h), uintptr(unsafe.Pointer(&pixels[0])), uintptr(unsafe.Pointer(&info)), dibRGBColors); result == 0 {
		return nil, err
	}
	imageRGBA := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			source := ((h-1-y)*w + x) * 4
			target := (y*w + x) * 4
			imageRGBA.Pix[target], imageRGBA.Pix[target+1], imageRGBA.Pix[target+2], imageRGBA.Pix[target+3] = pixels[source+2], pixels[source+1], pixels[source], 0xff
		}
	}
	var output bytes.Buffer
	if err := jpeg.Encode(&output, imageRGBA, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
