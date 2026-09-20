//go:build windows

package nexusremote

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"syscall"
	"unsafe"
)

const (
	metricScreenWidth  = 0
	metricScreenHeight = 1
	srccopy            = 0x00CC0020
	dibRGBColors       = 0
	biRGB              = 0
)

var (
	user32        = syscall.NewLazyDLL("user32.dll")
	gdi32         = syscall.NewLazyDLL("gdi32.dll")
	procGetDC     = user32.NewProc("GetDC")
	procReleaseDC = user32.NewProc("ReleaseDC")
	procMetrics   = user32.NewProc("GetSystemMetrics")
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

// WindowsDesktopCapture captures the visible virtual primary desktop only.
// Secure desktop, lock screen, credential prompts and secondary monitors are
// intentionally not handled by this first view-only implementation.
type WindowsDesktopCapture struct{}

func (WindowsDesktopCapture) CaptureJPEG(quality int) ([]byte, error) {
	if quality < 30 || quality > 85 {
		quality = 65
	}
	width, _, _ := procMetrics.Call(metricScreenWidth)
	height, _, _ := procMetrics.Call(metricScreenHeight)
	if width == 0 || height == 0 || width > 8192 || height > 8192 {
		return nil, errors.New("unsupported desktop dimensions")
	}
	w, h := int(width), int(height)
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
	if result, _, err := procBitBlt.Call(compatible, 0, 0, uintptr(w), uintptr(h), screen, 0, 0, srccopy); result == 0 {
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
