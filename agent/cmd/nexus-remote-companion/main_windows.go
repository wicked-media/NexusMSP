//go:build windows

// Nexus Remote Companion runs in the signed-in user's session. It has no
// agent token and cannot create remote sessions. It receives one signed grant
// at a time from the protected Agent service over a local named pipe. It
// displays attended consent unless the signed grant verifies a configured
// standing authorisation, captures only after authorisation, and returns
// bounded frames to that service for authenticated relay.
package main

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"nexusagent/internal/nexusremote"
)

const messageBoxYes = 6

const (
	remoteStopHotkeyID = 0x4E5852
	modControl         = 0x0002
	modShift           = 0x0004
	vkF12              = 0x7B
	wmHotkey           = 0x0312
	wmQuit             = 0x0012
	pmNoRemove         = 0x0000
)

var (
	user32             = syscall.NewLazyDLL("user32.dll")
	registerHotKey     = user32.NewProc("RegisterHotKey")
	unregisterHotKey   = user32.NewProc("UnregisterHotKey")
	getMessage         = user32.NewProc("GetMessageW")
	peekMessage        = user32.NewProc("PeekMessageW")
	postThreadMessage  = user32.NewProc("PostThreadMessageW")
	getCurrentThreadID = syscall.NewLazyDLL("kernel32.dll").NewProc("GetCurrentThreadId")
)

type point struct{ x, y int32 }
type windowsMessage struct {
	hwnd     uintptr
	message  uint32
	wparam   uintptr
	lparam   uintptr
	time     uint32
	pt       point
	lprivate uint32
}

func main() {
	for {
		pipe, err := connectPipe()
		if err != nil {
			log.Printf("remote companion: waiting for protected agent bridge: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}
		err = serve(pipe)
		_ = pipe.Close()
		if err != nil && !errors.Is(err, io.EOF) {
			log.Printf("remote companion: bridge disconnected: %v", err)
		}
		time.Sleep(time.Second)
	}
}

func connectPipe() (*os.File, error) {
	handle, err := windows.CreateFile(windows.StringToUTF16Ptr(nexusremote.CompanionPipeName), windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), "nexus-remote-companion"), nil
}

func serve(pipe *os.File) error {
	message, err := nexusremote.ReadIPCMessage(pipe)
	if err != nil {
		return err
	}
	if message.Type != "grant" || message.Grant == nil || message.Policy == nil {
		return errors.New("protected bridge did not provide a signed native grant")
	}
	replay, err := nexusremote.NewFileReplayStore(filepath.Join(userStateDir(), "remote-replay.jsonl"), 4096)
	if err != nil {
		return err
	}
	writer := &lockedWriter{writer: pipe}
	statusChecker := &pipeGrantStatus{reader: pipe, writer: writer}
	coordinator, err := nexusremote.NewCoordinator(*message.Policy, replay, func(sessionID string, mode nexusremote.Mode, expiresAt time.Time) (bool, string) {
		return consentPrompt(sessionID, mode, expiresAt, message.Grant.TechnicianName, message.Grant.Purpose)
	}, func(sessionID, outcome, reason string) error {
		return writer.send(nexusremote.IPCMessage{Type: "ack", SessionID: sessionID, Outcome: outcome, Reason: reason})
	})
	if err != nil {
		return err
	}
	session, err := coordinator.Process(*message.Grant, time.Now().UTC())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var locallyStopped atomic.Bool
	stopHotkey := watchLocalStopHotkey(cancel, &locallyStopped)
	defer stopHotkey()
	technicianName, purpose := session.DisplayMetadata()
	// V1 grants are attended-only and predate signed display metadata. The
	// protected Agent bridge supplies its display-only values for that legacy
	// path; V2 values above are signed with the authorisation grant.
	if technicianName == "" {
		technicianName = message.Grant.TechnicianName
	}
	if purpose == "" {
		purpose = message.Grant.Purpose
	}
	go activeSessionNotice(technicianName, purpose, cancel, &locallyStopped)
	err = nexusremote.StreamViewOnly(ctx, session, nexusremote.WindowsDesktopCapture{}, &pipeFrameSink{writer: writer}, statusChecker.Active, func(sessionID, state, detail string) error {
		return writer.send(nexusremote.IPCMessage{Type: "transport", SessionID: sessionID, State: state, Reason: detail})
	}, nexusremote.StreamOptions{})
	if locallyStopped.Load() {
		if stopErr := writer.send(nexusremote.IPCMessage{Type: "stop", SessionID: message.Grant.SessionID, Reason: "Endpoint user used the local stop shortcut"}); stopErr != nil {
			return stopErr
		}
		return nil
	}
	return err
}

type lockedWriter struct {
	mu     sync.Mutex
	writer io.Writer
}

// pipeGrantStatus serializes request/response status checks over the same
// credential-free pipe. The Agent service, not the companion, contacts Nexus.
type pipeGrantStatus struct {
	mu     sync.Mutex
	reader io.Reader
	writer *lockedWriter
}

func (s *pipeGrantStatus) Active(sessionID string) (bool, error) {
	if s == nil || s.reader == nil || s.writer == nil || sessionID == "" {
		return false, errors.New("native remote status pipe is unavailable")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.writer.send(nexusremote.IPCMessage{Type: "status", SessionID: sessionID}); err != nil {
		return false, err
	}
	response, err := nexusremote.ReadIPCMessage(s.reader)
	if err != nil {
		return false, err
	}
	if response.Type != "status" || response.SessionID != sessionID {
		return false, errors.New("invalid native remote status response")
	}
	return response.Active, nil
}

func (w *lockedWriter) send(message nexusremote.IPCMessage) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return nexusremote.WriteIPCMessage(w.writer, message)
}

type pipeFrameSink struct{ writer *lockedWriter }

func (s *pipeFrameSink) SendFrame(_ context.Context, sessionID string, jpeg []byte) error {
	return s.writer.send(nexusremote.IPCMessage{Type: "frame", SessionID: sessionID, JPEGBase64: base64.StdEncoding.EncodeToString(jpeg)})
}

func consentPrompt(sessionID string, mode nexusremote.Mode, expiresAt time.Time, technicianName, purpose string) (bool, string) {
	if technicianName == "" {
		technicianName = "Nexus Support"
	}
	if purpose == "" {
		purpose = "Technician support session"
	}
	text, _ := windows.UTF16PtrFromString(
		"VIEW-ONLY SUPPORT REQUEST\r\n\r\n" +
			technicianName + " would like to view this desktop to assist you. " +
			"They cannot control your mouse or keyboard.\r\n\r\n" +
			"Purpose: " + purpose + "\r\n\r\n" +
			"Session reference: " + sessionID + "\r\n" +
			"Automatically ends: " + expiresAt.Local().Format("Mon 2 Jan, 3:04 PM") + "\r\n\r\n" +
			"You remain in control. Press Ctrl + Shift + F12 at any time to stop sharing immediately.\r\n\r\n" +
			"Allow view-only screen sharing now?",
	)
	caption, _ := windows.UTF16PtrFromString("Nexus Remote · Your approval is required")
	result, err := windows.MessageBox(0, text, caption, windows.MB_YESNO|windows.MB_ICONINFORMATION|windows.MB_TOPMOST|windows.MB_DEFBUTTON2)
	if err != nil || result != messageBoxYes {
		return false, "The endpoint user declined view-only remote access"
	}
	return true, ""
}

// activeSessionNotice is independent of capture. It makes the technician's
// presence clear without allowing a local message box to block an already
// consented remote stream. Yes opens the endpoint's local Nexus Client Chat;
// No stops the session through the same endpoint-owned revoke path as the
// hotkey. Closing the notice simply leaves the session visible in the tray.
func activeSessionNotice(technicianName, purpose string, cancel context.CancelFunc, stopped *atomic.Bool) {
	if technicianName == "" {
		technicianName = "Nexus Support"
	}
	if purpose == "" {
		purpose = "Technician support session"
	}
	text, _ := windows.UTF16PtrFromString(
		"NEXUS REMOTE IS ACTIVE\r\n\r\n" +
			"Connected technician: " + technicianName + "\r\n" +
			"Purpose: " + purpose + "\r\n\r\n" +
			"Your screen is being shared in view-only mode. The technician cannot control your mouse or keyboard.\r\n\r\n" +
			"Yes: Open Nexus Client Chat\r\n" +
			"No: Stop remote access now\r\n" +
			"Cancel: Keep the session running",
	)
	caption, _ := windows.UTF16PtrFromString("Nexus Remote · Support session active")
	result, err := windows.MessageBox(0, text, caption, windows.MB_YESNOCANCEL|windows.MB_ICONINFORMATION|windows.MB_TOPMOST|windows.MB_DEFBUTTON3)
	if err != nil {
		return
	}
	if result == messageBoxYes {
		openClientChat()
		return
	}
	if result == 7 { // IDNO
		stopped.Store(true)
		cancel()
	}
}

func openClientChat() {
	executable, err := os.Executable()
	if err != nil {
		return
	}
	chat := filepath.Join(filepath.Dir(executable), "nexus-client-chat.exe")
	if _, err := os.Stat(chat); err == nil {
		_ = exec.Command(chat).Start()
	}
}

// watchLocalStopHotkey is an endpoint-owned, always-local revoke action. It
// has no browser or network trigger: Ctrl+Shift+F12 cancels capture, after
// which the companion sends an audited stop message through the agent bridge.
func watchLocalStopHotkey(cancel context.CancelFunc, stopped *atomic.Bool) func() {
	done := make(chan struct{})
	ready := make(chan uint32, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		threadID, _, _ := getCurrentThreadID.Call()
		var message windowsMessage
		// Ensure the thread owns a message queue before its cleanup can post WM_QUIT.
		_, _, _ = peekMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0, pmNoRemove)
		ready <- uint32(threadID)
		registered, _, _ := registerHotKey.Call(0, remoteStopHotkeyID, modControl|modShift, vkF12)
		if registered == 0 {
			return
		}
		defer unregisterHotKey.Call(0, remoteStopHotkeyID)
		for {
			result, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
			if int32(result) <= 0 || message.message == wmQuit {
				return
			}
			if message.message == wmHotkey {
				stopped.Store(true)
				cancel()
				return
			}
		}
	}()
	threadID := <-ready
	return func() {
		select {
		case <-done:
			return
		default:
			close(done)
			_, _, _ = postThreadMessage.Call(uintptr(threadID), wmQuit, 0, 0)
		}
	}
}

func userStateDir() string {
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		return filepath.Join(local, "NexusMSP")
	}
	return filepath.Join(os.TempDir(), "NexusMSP")
}
