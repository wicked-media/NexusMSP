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
	"strings"
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
	configureDiagnosticLog()
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
			// This is deliberately local and contains only the bounded failure
			// returned by the protected bridge; it gives support a diagnostic trail
			// without putting grants, credentials, or desktop content on disk.
			log.Printf("remote companion: bridge disconnected: %s", boundedDiagnostic(err.Error()))
		}
		time.Sleep(time.Second)
	}
}

func configureDiagnosticLog() {
	dir := userStateDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	file, err := os.OpenFile(filepath.Join(dir, "remote-companion.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	log.SetOutput(file)
}

func boundedDiagnostic(detail string) string {
	detail = strings.Join(strings.Fields(detail), " ")
	if len(detail) > 320 {
		return detail[:320]
	}
	return detail
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
	if message.Grant.Mode == nexusremote.Control {
		go receiveControlEvents(ctx, cancel, session, message.Grant.SessionID)
	}
	go activeSessionNotice(technicianName, purpose, cancel, &locallyStopped)
	// Keep a wide margin above the relay's 500 ms minimum. Windows capture and
	// scheduling can bunch timer wakeups after a busy period; a cadence close to
	// the server boundary can then arrive too early and correctly fail closed.
	// One second is deliberately conservative for this preview transport. It
	// keeps the session durable while later transport work can safely improve
	// frame pacing without weakening the relay's anti-flooding contract.
	err = nexusremote.StreamViewOnly(ctx, session, nexusremote.WindowsDesktopCapture{}, &pipeFrameSink{writer: writer}, statusChecker.Active, func(sessionID, state, detail string) error {
		return writer.send(nexusremote.IPCMessage{Type: "transport", SessionID: sessionID, State: state, Reason: detail})
	}, nexusremote.StreamOptions{FrameInterval: time.Second, StatusEvery: 5 * time.Second, JPEGQuality: 82})
	if locallyStopped.Load() {
		if stopErr := writer.send(nexusremote.IPCMessage{Type: "stop", SessionID: message.Grant.SessionID, Reason: "Endpoint user used the local stop shortcut"}); stopErr != nil {
			return stopErr
		}
		return nil
	}
	return err
}

// receiveControlEvents uses a separate verified Agent-owned pipe so inbound
// input cannot race frame uploads or the grant-status request/response pipe.
func receiveControlEvents(ctx context.Context, cancel context.CancelFunc, session *nexusremote.Session, sessionID string) {
	var lastSequence uint64
	var lastConnectDiagnostic time.Time
	for ctx.Err() == nil {
		handle, err := windows.CreateFile(windows.StringToUTF16Ptr(nexusremote.CompanionControlPipeName), windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
		if err != nil {
			if time.Since(lastConnectDiagnostic) >= 10*time.Second {
				log.Printf("remote companion: control pipe unavailable: %s", boundedDiagnostic(err.Error()))
				lastConnectDiagnostic = time.Now()
			}
			time.Sleep(time.Second)
			continue
		}
		pipe := os.NewFile(uintptr(handle), "nexus-remote-control")
		for ctx.Err() == nil {
			message, readErr := nexusremote.ReadIPCMessage(pipe)
			if readErr != nil {
				break
			}
			if message.Type != "input" || message.SessionID != sessionID || message.Control == nil {
				continue
			}
			event, validErr := nexusremote.ValidateControlEvent(*message.Control)
			if validErr != nil {
				continue
			}
			if event.Sequence > lastSequence {
				if injectErr := (nexusremote.WindowsInputInjector{}).Inject(session, event, time.Now().UTC()); injectErr != nil {
					// Preserve only bounded local delivery diagnostics.  The browser
					// receives compact queue/acknowledgement evidence; it must never
					// receive endpoint screen data or a Windows error verbatim.
					log.Printf("remote companion: control input %d rejected: %s", event.Sequence, boundedDiagnostic(injectErr.Error()))
					if session.Authorize(true, time.Now().UTC()) != nil {
						cancel()
						_ = pipe.Close()
						return
					}
					continue
				}
				lastSequence = event.Sequence
			}
			_ = nexusremote.WriteIPCMessage(pipe, nexusremote.IPCMessage{Type: "input_ack", SessionID: sessionID, Control: &event})
		}
		_ = pipe.Close()
	}
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
	access := "VIEW-ONLY SUPPORT REQUEST"
	capability := "They cannot control your mouse or keyboard."
	prompt := "Allow view-only screen sharing now?"
	if mode == nexusremote.Control {
		access = "INTERACTIVE SUPPORT REQUEST"
		capability = "They will be able to use your mouse and keyboard while this session is active."
		prompt = "Allow interactive remote support now?"
	}
	text, _ := windows.UTF16PtrFromString(
		access + "\r\n\r\n" +
			technicianName + " would like to assist you on this desktop. " + capability + "\r\n\r\n" +
			"Purpose: " + purpose + "\r\n\r\n" +
			"Session reference: " + sessionID + "\r\n" +
			"Automatically ends: " + expiresAt.Local().Format("Mon 2 Jan, 3:04 PM") + "\r\n\r\n" +
			"You remain in control. Press Ctrl + Shift + F12 at any time to stop sharing immediately.\r\n\r\n" +
			prompt,
	)
	caption, _ := windows.UTF16PtrFromString("Nexus Remote · Your approval is required")
	result, err := windows.MessageBox(0, text, caption, windows.MB_YESNO|windows.MB_ICONINFORMATION|windows.MB_TOPMOST|windows.MB_DEFBUTTON2)
	if err != nil || result != messageBoxYes {
		return false, "The endpoint user declined remote access"
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
