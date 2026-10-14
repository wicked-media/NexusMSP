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
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
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
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
	"nexusagent/internal/nexusremote"
)

// Version is injected at build time.  Health and release tooling may execute
// the companion with --version; that must never start a second IPC client.
var Version = "0.1.18-oneway-relay"

const (
	messageBoxYes = 6
	messageBoxNo  = 7
)

const (
	taskDialogYesButton               = 0x0002
	taskDialogNoButton                = 0x0004
	taskDialogAllowCancellation       = 0x0008
	taskDialogPositionRelativeToOwner = 0x1000
	taskDialogSizeToContent           = 0x01000000

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
	comctl32           = syscall.NewLazyDLL("comctl32.dll")
	taskDialogIndirect = comctl32.NewProc("TaskDialogIndirect")
)

// taskDialogConfig mirrors TASKDIALOGCONFIG. Using the native Task Dialog
// keeps the consent decision entirely local while giving endpoint users a
// first-class, accessible Windows surface instead of an ambiguous message box.
type taskDialogConfig struct {
	cbSize               uint32
	hwndParent           windows.Handle
	hInstance            windows.Handle
	flags                uint32
	commonButtons        uint32
	windowTitle          *uint16
	mainIcon             uintptr
	mainInstruction      *uint16
	content              *uint16
	buttonCount          uint32
	buttons              uintptr
	defaultButton        int32
	radioButtonCount     uint32
	radioButtons         uintptr
	defaultRadioButton   int32
	verificationText     *uint16
	expandedInformation  *uint16
	expandedControlText  *uint16
	collapsedControlText *uint16
	footerIcon           uintptr
	footer               *uint16
	callback             uintptr
	callbackData         uintptr
	width                uint32
}

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
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Printf("nexus-remote-companion %s\n", Version)
		return
	}
	configureDiagnosticLog()
	instance, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(`Local\NexusRemoteCompanion-v1`))
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		log.Printf("remote companion: unable to acquire single-instance guard: %s", boundedDiagnostic(err.Error()))
		return
	}
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		_ = windows.CloseHandle(instance)
		log.Printf("remote companion: another signed-in companion instance is already active")
		return
	}
	defer windows.CloseHandle(instance)
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
	handle, err := windows.CreateFile(windows.StringToUTF16Ptr(nexusremote.CompanionPipeName), windows.GENERIC_READ, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), "nexus-remote-companion"), nil
}

func connectEventPipe(ctx context.Context) (*os.File, error) {
	deadline := time.Now().Add(15 * time.Second)
	log.Printf("remote companion: connecting protected event uplink")
	for {
		handle, err := windows.CreateFile(windows.StringToUTF16Ptr(nexusremote.CompanionEventPipeName), windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
		if err == nil {
			log.Printf("remote companion: protected event uplink connected")
			return os.NewFile(uintptr(handle), "nexus-remote-event-uplink"), nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if time.Now().After(deadline) {
			log.Printf("remote companion: protected event uplink unavailable: %s", boundedDiagnostic(err.Error()))
			return nil, err
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func connectFramePipe(ctx context.Context) (*os.File, error) {
	deadline := time.Now().Add(15 * time.Second)
	log.Printf("remote companion: connecting isolated frame uplink")
	for {
		handle, err := windows.CreateFile(windows.StringToUTF16Ptr(nexusremote.CompanionFramePipeName), windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
		if err == nil {
			log.Printf("remote companion: isolated frame uplink connected")
			return os.NewFile(uintptr(handle), "nexus-remote-frame-uplink"), nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if time.Now().After(deadline) {
			log.Printf("remote companion: isolated frame uplink unavailable: %s", boundedDiagnostic(err.Error()))
			return nil, err
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func serve(pipe *os.File) error {
	message, err := nexusremote.ReadIPCMessage(pipe)
	if err != nil {
		return err
	}
	if message.Type != "grant" || message.Grant == nil || message.Policy == nil {
		return errors.New("protected bridge did not provide a signed native grant")
	}
	if !message.FramePipeReady || !message.EventPipeReady {
		return errors.New("protected bridge did not prepare the required one-way uplinks")
	}
	replay, err := nexusremote.NewFileReplayStore(filepath.Join(userStateDir(), "remote-replay.jsonl"), 4096)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	eventPipe, err := connectEventPipe(ctx)
	if err != nil {
		return fmt.Errorf("connect protected event uplink: %w", err)
	}
	defer eventPipe.Close()
	writer := &lockedWriter{writer: eventPipe}
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
	framePipe, err := connectFramePipe(ctx)
	if err != nil {
		return fmt.Errorf("connect isolated frame uplink: %w", err)
	}
	defer framePipe.Close()
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
	// Agent control is a one-way protected pipe. The companion is its sole
	// reader; acknowledgements and transport evidence return through the separate
	// event uplink, while frames use their own dedicated uplink.
	inbox := newBridgeInbox(ctx, cancel, session, message.Grant.SessionID, writer)
	go inbox.run(pipe)
	go activeSessionNotice(technicianName, purpose, message.Grant.Mode, cancel, &locallyStopped)
	// Keep a substantial margin above the relay's 500 ms minimum. Windows
	// scheduling, capture and request completion can bunch wakeups under load;
	// a nominal one-second cadence still proved too close to the server boundary
	// on a live endpoint. Two seconds keeps capture well inside the 20-second
	// freshness window while preserving the relay's anti-flooding contract.
	err = nexusremote.StreamViewOnly(ctx, session, nexusremote.WindowsDesktopCapture{}, &pipeFrameSink{writer: &lockedWriter{writer: framePipe}}, inbox.Active, func(sessionID, state, detail string) error {
		return writer.send(nexusremote.IPCMessage{Type: "transport", SessionID: sessionID, State: state, Reason: detail})
	}, nexusremote.StreamOptions{FrameInterval: 2 * time.Second, StatusEvery: 5 * time.Second, JPEGQuality: 82})
	if err != nil && !errors.Is(err, context.Canceled) {
		// Keep the endpoint log bounded and actionable. The protected Agent
		// reports the same failure to the server lifecycle, while this local
		// evidence distinguishes capture failure from relay delivery failure.
		log.Printf("remote companion: desktop capture stream ended: %s", boundedDiagnostic(err.Error()))
	}
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

// bridgeInbox is the sole reader for the protected companion bridge.  The
// user-session companion never receives an API credential; it can only ask the
// verified Agent to check status, and it accepts input only for this grant.
type bridgeInbox struct {
	ctx          context.Context
	cancel       context.CancelFunc
	session      *nexusremote.Session
	sessionID    string
	writer       *lockedWriter
	done         chan struct{}
	lastSequence uint64
	active       atomic.Bool
}

func newBridgeInbox(ctx context.Context, cancel context.CancelFunc, session *nexusremote.Session, sessionID string, writer *lockedWriter) *bridgeInbox {
	inbox := &bridgeInbox{ctx: ctx, cancel: cancel, session: session, sessionID: sessionID, writer: writer, done: make(chan struct{})}
	// The signed grant has already passed local verification and consent. The
	// Agent immediately replaces this provisional state with its authenticated
	// liveness feed; a negative or failed feed cancels capture fail-closed.
	inbox.active.Store(true)
	return inbox
}

func (b *bridgeInbox) Active(sessionID string) (bool, error) {
	if b == nil || b.writer == nil || sessionID == "" || sessionID != b.sessionID {
		return false, errors.New("native remote status bridge is unavailable")
	}
	select {
	case <-b.done:
		return false, errors.New("native remote status bridge closed")
	case <-b.ctx.Done():
		return false, b.ctx.Err()
	default:
		return b.active.Load(), nil
	}
}

func (b *bridgeInbox) run(reader io.Reader) {
	defer close(b.done)
	for b.ctx.Err() == nil {
		message, err := nexusremote.ReadIPCMessage(reader)
		if err != nil {
			if b.ctx.Err() == nil {
				log.Printf("remote companion: protected bridge closed: %s", boundedDiagnostic(err.Error()))
				b.cancel()
			}
			return
		}
		if message.SessionID != b.sessionID {
			log.Printf("remote companion: protected bridge rejected a mismatched session message")
			b.cancel()
			return
		}
		switch message.Type {
		case "status":
			b.active.Store(message.Active)
			if !message.Active {
				log.Printf("remote companion: Agent revoked the signed session liveness")
				b.cancel()
				return
			}
		case "input":
			b.handleInput(message)
		default:
			log.Printf("remote companion: protected bridge rejected unsupported message type")
			b.cancel()
			return
		}
	}
}

func (b *bridgeInbox) handleInput(message nexusremote.IPCMessage) {
	if message.Control == nil || b.session == nil {
		return
	}
	event, err := nexusremote.ValidateControlEvent(*message.Control)
	if err != nil {
		return
	}
	if event.Sequence > b.lastSequence {
		log.Printf("remote companion: control input %d received", event.Sequence)
		if injectErr := (nexusremote.WindowsInputInjector{}).Inject(b.session, event, time.Now().UTC()); injectErr != nil {
			log.Printf("remote companion: control input %d rejected: %s", event.Sequence, boundedDiagnostic(injectErr.Error()))
			return
		}
		b.lastSequence = event.Sequence
	}
	if ackErr := b.writer.send(nexusremote.IPCMessage{Type: "input_ack", SessionID: b.sessionID, Control: &event}); ackErr != nil {
		log.Printf("remote companion: control acknowledgement %d failed: %s", event.Sequence, boundedDiagnostic(ackErr.Error()))
	} else {
		log.Printf("remote companion: control input %d acknowledged locally", event.Sequence)
	}
}

func (w *lockedWriter) send(message nexusremote.IPCMessage) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return nexusremote.WriteIPCMessage(w.writer, message)
}

type pipeFrameSink struct {
	writer    *lockedWriter
	firstSent atomic.Bool
}

func (s *pipeFrameSink) SendFrame(_ context.Context, sessionID string, jpeg []byte, displays []nexusremote.DisplayInfo) error {
	first := s.firstSent.CompareAndSwap(false, true)
	if first {
		log.Printf("remote companion: relaying first desktop frame (%d bytes)", len(jpeg))
	}
	err := s.writer.send(nexusremote.IPCMessage{Type: "frame", SessionID: sessionID, JPEGBase64: base64.StdEncoding.EncodeToString(jpeg), Displays: displays})
	if err == nil && first {
		log.Printf("remote companion: first desktop frame relayed to protected Agent")
	}
	return err
}

func consentPrompt(sessionID string, mode nexusremote.Mode, expiresAt time.Time, technicianName, purpose string) (bool, string) {
	log.Printf("remote companion: presenting endpoint consent prompt")
	if technicianName == "" {
		technicianName = "Nexus Support"
	}
	if purpose == "" {
		purpose = "Technician support session"
	}
	access := "View-only support is requested"
	capability := "The technician can view your screen but cannot control your mouse or keyboard."
	prompt := "Allow view-only support for this session?"
	if mode == nexusremote.Control {
		access = "Interactive support is requested"
		capability = "The technician can view your screen and use your mouse and keyboard while this session is active."
		prompt = "Allow interactive support for this session?"
	}
	if approved, displayed := showPremiumConsentWindow(access, capability, prompt, sessionID, expiresAt, technicianName, purpose); displayed {
		log.Printf("remote companion: premium endpoint consent prompt completed")
		if approved {
			return true, ""
		}
		return false, "The endpoint user declined remote access"
	}
	// An attended request must always present a working local decision. Keep a
	// native fallback for Windows installations without the WPF desktop stack.
	log.Printf("remote companion: premium consent window unavailable; using Windows compatibility prompt")

	// A modern Task Dialog is available on supported Windows builds. Keep this
	// conservative MessageBox fallback for reduced Windows environments rather
	// than ever silently accepting an attended-control request.
	text, _ := windows.UTF16PtrFromString(access + "\r\n\r\n" + technicianName + " would like to assist you. " + capability + "\r\n\r\nPurpose: " + purpose + "\r\n\r\n" + prompt)
	caption, _ := windows.UTF16PtrFromString("Nexus Remote · Approval required")
	result, err := windows.MessageBox(0, text, caption, windows.MB_YESNO|windows.MB_ICONINFORMATION|windows.MB_TOPMOST|windows.MB_DEFBUTTON2)
	if err != nil {
		log.Printf("remote companion: compatibility consent prompt failed: %s", boundedDiagnostic(err.Error()))
	}
	if err != nil || result != messageBoxYes {
		return false, "The endpoint user declined remote access"
	}
	return true, ""
}

// showPremiumConsentWindow hosts a purpose-built consent surface in the
// signed-in user's desktop session. The PowerShell payload is static; the
// signed, display-only values are supplied through process environment values
// rather than interpolated into script source.
func showPremiumConsentWindow(access, capability, prompt, sessionID string, expiresAt time.Time, technicianName, purpose string) (approved bool, displayed bool) {
	const script = `Add-Type -AssemblyName PresentationFramework
$brush = { param([string]$value) return (New-Object System.Windows.Media.BrushConverter).ConvertFromString($value) }
$tech = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_TECHNICIAN')
$purpose = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_PURPOSE')
$access = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_ACCESS')
$capability = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_CAPABILITY')
$prompt = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_PROMPT')
$session = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_SESSION')
$ends = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_ENDS')
$window = New-Object System.Windows.Window
$window.Title = 'Nexus Remote · Approval required'; $window.Width = 620; $window.SizeToContent = 'Height'
$window.WindowStartupLocation = 'CenterScreen'; $window.ResizeMode = 'NoResize'; $window.Topmost = $true
$window.Background = & $brush '#0B1220'; $window.Foreground = [System.Windows.Media.Brushes]::White
$root = New-Object System.Windows.Controls.StackPanel; $root.Margin = '28'; $root.Orientation = 'Vertical'
$window.Content = $root
$badge = New-Object System.Windows.Controls.TextBlock; $badge.Text = 'NEXUS REMOTE  ·  ATTENDED SUPPORT'; $badge.FontSize = 12; $badge.FontWeight = 'SemiBold'; $badge.Foreground = & $brush '#5EEAD4'; $badge.Margin = '0,0,0,12'; $root.Children.Add($badge) | Out-Null
$heading = New-Object System.Windows.Controls.TextBlock; $heading.Text = $access; $heading.FontSize = 25; $heading.FontWeight = 'SemiBold'; $heading.TextWrapping = 'Wrap'; $root.Children.Add($heading) | Out-Null
$summary = New-Object System.Windows.Controls.TextBlock; $summary.Text = $capability; $summary.FontSize = 14; $summary.Foreground = & $brush '#CBD5E1'; $summary.TextWrapping = 'Wrap'; $summary.Margin = '0,8,0,18'; $root.Children.Add($summary) | Out-Null
function Add-Detail([string]$label, [string]$value) { $card = New-Object System.Windows.Controls.Border; $card.Background = & $brush '#162033'; $card.CornerRadius = '8'; $card.Padding = '14,10'; $card.Margin = '0,0,0,8'; $stack = New-Object System.Windows.Controls.StackPanel; $card.Child = $stack; $small = New-Object System.Windows.Controls.TextBlock; $small.Text = $label; $small.FontSize = 11; $small.FontWeight = 'SemiBold'; $small.Foreground = & $brush '#94A3B8'; $stack.Children.Add($small) | Out-Null; $body = New-Object System.Windows.Controls.TextBlock; $body.Text = $value; $body.FontSize = 14; $body.TextWrapping = 'Wrap'; $body.Margin = '0,3,0,0'; $stack.Children.Add($body) | Out-Null; $root.Children.Add($card) | Out-Null }
Add-Detail 'TECHNICIAN' $tech; Add-Detail 'PURPOSE' $purpose; Add-Detail 'SESSION' ('ID ' + $session + '  ·  Ends ' + $ends)
$notice = New-Object System.Windows.Controls.TextBlock; $notice.Text = $prompt + ' You can stop sharing at any time with Ctrl + Shift + F12.'; $notice.FontSize = 13; $notice.TextWrapping = 'Wrap'; $notice.Foreground = & $brush '#CBD5E1'; $notice.Margin = '0,12,0,18'; $root.Children.Add($notice) | Out-Null
$actions = New-Object System.Windows.Controls.StackPanel; $actions.Orientation = 'Horizontal'; $actions.HorizontalAlignment = 'Right'; $root.Children.Add($actions) | Out-Null
$decline = New-Object System.Windows.Controls.Button; $decline.Content = 'Decline'; $decline.MinWidth = 112; $decline.Height = 38; $decline.Margin = '0,0,10,0'; $decline.Background = & $brush '#243247'; $decline.Foreground = [System.Windows.Media.Brushes]::White; $decline.BorderThickness = 0; $decline.IsDefault = $true; $decline.IsCancel = $true; $actions.Children.Add($decline) | Out-Null
$allow = New-Object System.Windows.Controls.Button; $allow.Content = 'Allow support'; $allow.MinWidth = 132; $allow.Height = 38; $allow.Background = & $brush '#14B8A6'; $allow.Foreground = & $brush '#062925'; $allow.FontWeight = 'SemiBold'; $allow.BorderThickness = 0; $actions.Children.Add($allow) | Out-Null
$script:decision = 'declined'; $decline.Add_Click({ $script:decision = 'declined'; $window.Close() }); $allow.Add_Click({ $script:decision = 'approved'; $window.Close() }); [void]$window.ShowDialog(); Write-Output $script:decision`
	command := exec.Command("powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShellCommand(script))
	command.Env = append(os.Environ(),
		"NEXUS_REMOTE_TECHNICIAN="+technicianName,
		"NEXUS_REMOTE_PURPOSE="+purpose,
		"NEXUS_REMOTE_ACCESS="+access,
		"NEXUS_REMOTE_CAPABILITY="+capability,
		"NEXUS_REMOTE_PROMPT="+prompt,
		"NEXUS_REMOTE_SESSION="+sessionID,
		"NEXUS_REMOTE_ENDS="+expiresAt.Local().Format("Mon 2 Jan, 3:04 PM"),
	)
	// Do not use CREATE_NO_WINDOW/HideWindow here: WPF consent is the visible
	// endpoint surface and Windows applies that flag to the child window too.
	output, err := command.Output()
	if err != nil {
		log.Printf("remote companion: premium consent window failed: %s", boundedDiagnostic(err.Error()))
		return false, false
	}
	decision := strings.TrimSpace(strings.ToLower(string(output)))
	if decision != "approved" && decision != "declined" {
		log.Printf("remote companion: premium consent window returned no decision")
		return false, false
	}
	return decision == "approved", true
}

func encodePowerShellCommand(script string) string {
	characters := utf16.Encode([]rune(script))
	encoded := make([]byte, len(characters)*2)
	for index, character := range characters {
		binary.LittleEndian.PutUint16(encoded[index*2:], character)
	}
	return base64.StdEncoding.EncodeToString(encoded)
}

func showConsentTaskDialog(access, capability, prompt, sessionID string, expiresAt time.Time, technicianName, purpose string) (approved bool, displayed bool) {
	title, titleErr := windows.UTF16PtrFromString("Nexus Remote · Approval required")
	main, mainErr := windows.UTF16PtrFromString(access)
	content, contentErr := windows.UTF16PtrFromString(
		"TECHNICIAN\r\n" + technicianName + "\r\n\r\n" +
			"ACCESS\r\n" + capability + "\r\n\r\n" +
			"PURPOSE\r\n" + purpose + "\r\n\r\n" +
			"SESSION\r\n" + sessionID + "\r\nEnds automatically: " + expiresAt.Local().Format("Mon 2 Jan, 3:04 PM") + "\r\n\r\n" +
			prompt,
	)
	footer, footerErr := windows.UTF16PtrFromString("You remain in control. Select No to decline, or press Ctrl + Shift + F12 at any time to stop sharing.")
	if titleErr != nil || mainErr != nil || contentErr != nil || footerErr != nil {
		return false, false
	}
	config := taskDialogConfig{
		cbSize:          uint32(unsafe.Sizeof(taskDialogConfig{})),
		flags:           taskDialogAllowCancellation | taskDialogPositionRelativeToOwner | taskDialogSizeToContent,
		commonButtons:   taskDialogYesButton | taskDialogNoButton,
		windowTitle:     title,
		mainInstruction: main,
		content:         content,
		defaultButton:   messageBoxNo,
		footer:          footer,
	}
	var selected int32
	result, _, callErr := taskDialogIndirect.Call(uintptr(unsafe.Pointer(&config)), uintptr(unsafe.Pointer(&selected)), 0, 0)
	if callErr != syscall.Errno(0) || result != 0 {
		return false, false
	}
	return selected == messageBoxYes, true
}

// activeSessionNotice is independent of capture. It makes the technician's
// presence clear without allowing a local message box to block an already
// consented remote stream. Yes opens the endpoint's local Nexus Client Chat;
// No stops the session through the same endpoint-owned revoke path as the
// hotkey. Closing the notice simply leaves the session visible in the tray.
func activeSessionNotice(technicianName, purpose string, mode nexusremote.Mode, cancel context.CancelFunc, stopped *atomic.Bool) {
	if technicianName == "" {
		technicianName = "Nexus Support"
	}
	if purpose == "" {
		purpose = "Technician support session"
	}
	if outcome, displayed := showPremiumActiveSessionWindow(technicianName, purpose, mode); displayed {
		switch outcome {
		case "chat":
			openClientChat()
		case "stop":
			stopped.Store(true)
			cancel()
		}
		return
	}

	// Keep the legacy message box only for Windows installations without WPF.
	// The primary active-session notice above is the matching Nexus surface.
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

func showPremiumActiveSessionWindow(technicianName, purpose string, mode nexusremote.Mode) (outcome string, displayed bool) {
	access := "View-only support"
	capability := "The technician can see your screen. Your mouse and keyboard stay under your control."
	if mode == nexusremote.Control {
		access = "Interactive support"
		capability = "The technician can view your screen and use your mouse and keyboard while this session is active."
	}
	const script = `Add-Type -AssemblyName PresentationFramework
$brush = { param([string]$value) return (New-Object System.Windows.Media.BrushConverter).ConvertFromString($value) }
$tech = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_TECHNICIAN'); $purpose = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_PURPOSE'); $access = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_ACCESS'); $capability = [Environment]::GetEnvironmentVariable('NEXUS_REMOTE_CAPABILITY')
$window = New-Object System.Windows.Window; $window.Title = 'Nexus Remote · Support session active'; $window.Width = 590; $window.SizeToContent = 'Height'; $window.WindowStartupLocation = 'CenterScreen'; $window.ResizeMode = 'NoResize'; $window.Topmost = $true; $window.Background = & $brush '#0B1220'; $window.Foreground = [System.Windows.Media.Brushes]::White
$root = New-Object System.Windows.Controls.StackPanel; $root.Margin = '28'; $window.Content = $root
$badge = New-Object System.Windows.Controls.TextBlock; $badge.Text = 'NEXUS REMOTE  ·  LIVE SESSION'; $badge.FontSize = 12; $badge.FontWeight = 'SemiBold'; $badge.Foreground = & $brush '#5EEAD4'; $badge.Margin = '0,0,0,12'; $root.Children.Add($badge) | Out-Null
$heading = New-Object System.Windows.Controls.TextBlock; $heading.Text = 'Support session is active'; $heading.FontSize = 25; $heading.FontWeight = 'SemiBold'; $root.Children.Add($heading) | Out-Null
$summary = New-Object System.Windows.Controls.TextBlock; $summary.Text = $capability; $summary.FontSize = 14; $summary.Foreground = & $brush '#CBD5E1'; $summary.TextWrapping = 'Wrap'; $summary.Margin = '0,8,0,18'; $root.Children.Add($summary) | Out-Null
function Add-Detail([string]$label, [string]$value) { $card = New-Object System.Windows.Controls.Border; $card.Background = & $brush '#162033'; $card.CornerRadius = '8'; $card.Padding = '14,10'; $card.Margin = '0,0,0,8'; $stack = New-Object System.Windows.Controls.StackPanel; $card.Child = $stack; $small = New-Object System.Windows.Controls.TextBlock; $small.Text = $label; $small.FontSize = 11; $small.FontWeight = 'SemiBold'; $small.Foreground = & $brush '#94A3B8'; $stack.Children.Add($small) | Out-Null; $body = New-Object System.Windows.Controls.TextBlock; $body.Text = $value; $body.FontSize = 14; $body.TextWrapping = 'Wrap'; $body.Margin = '0,3,0,0'; $stack.Children.Add($body) | Out-Null; $root.Children.Add($card) | Out-Null }
Add-Detail 'CONNECTED TECHNICIAN' $tech; Add-Detail 'SESSION PURPOSE' $purpose; Add-Detail 'ACCESS' $access
$notice = New-Object System.Windows.Controls.TextBlock; $notice.Text = 'Open chat to contact the technician, or stop access immediately. You can also stop sharing at any time with Ctrl + Shift + F12.'; $notice.FontSize = 13; $notice.TextWrapping = 'Wrap'; $notice.Foreground = & $brush '#CBD5E1'; $notice.Margin = '0,12,0,18'; $root.Children.Add($notice) | Out-Null
$actions = New-Object System.Windows.Controls.StackPanel; $actions.Orientation = 'Horizontal'; $actions.HorizontalAlignment = 'Right'; $root.Children.Add($actions) | Out-Null
$stop = New-Object System.Windows.Controls.Button; $stop.Content = 'Stop access'; $stop.MinWidth = 110; $stop.Height = 38; $stop.Margin = '0,0,10,0'; $stop.Background = & $brush '#7F1D1D'; $stop.Foreground = [System.Windows.Media.Brushes]::White; $stop.BorderThickness = 0; $actions.Children.Add($stop) | Out-Null
$dismiss = New-Object System.Windows.Controls.Button; $dismiss.Content = 'Keep open'; $dismiss.MinWidth = 110; $dismiss.Height = 38; $dismiss.Margin = '0,0,10,0'; $dismiss.Background = & $brush '#243247'; $dismiss.Foreground = [System.Windows.Media.Brushes]::White; $dismiss.BorderThickness = 0; $dismiss.IsDefault = $true; $dismiss.IsCancel = $true; $actions.Children.Add($dismiss) | Out-Null
$chat = New-Object System.Windows.Controls.Button; $chat.Content = 'Open chat'; $chat.MinWidth = 110; $chat.Height = 38; $chat.Background = & $brush '#14B8A6'; $chat.Foreground = & $brush '#062925'; $chat.FontWeight = 'SemiBold'; $chat.BorderThickness = 0; $actions.Children.Add($chat) | Out-Null
$script:outcome = 'dismiss'; $stop.Add_Click({ $script:outcome = 'stop'; $window.Close() }); $dismiss.Add_Click({ $script:outcome = 'dismiss'; $window.Close() }); $chat.Add_Click({ $script:outcome = 'chat'; $window.Close() }); [void]$window.ShowDialog(); Write-Output $script:outcome`
	command := exec.Command("powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShellCommand(script))
	command.Env = append(os.Environ(),
		"NEXUS_REMOTE_TECHNICIAN="+technicianName,
		"NEXUS_REMOTE_PURPOSE="+purpose,
		"NEXUS_REMOTE_ACCESS="+access,
		"NEXUS_REMOTE_CAPABILITY="+capability,
	)
	output, err := command.Output()
	if err != nil {
		log.Printf("remote companion: premium active-session window failed: %s", boundedDiagnostic(err.Error()))
		return "", false
	}
	value := strings.TrimSpace(strings.ToLower(string(output)))
	if value != "chat" && value != "stop" && value != "dismiss" {
		return "", false
	}
	return value, true
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
