//go:build windows

package nexusremote

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"nexusagent/internal/config"
	"nexusagent/internal/transport"
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	getPipeClientPID = kernel32.NewProc("GetNamedPipeClientProcessId")
)

// StartCompanionBridge owns the privileged half of the native remote pipe.
// It validates the client image path before disclosing a grant and forwards
// only bounded, session-matching messages with the protected agent token.
func StartCompanionBridge(ctx context.Context, cfg *config.Config, client *transport.Client) error {
	if cfg == nil {
		reportCompanionHealth("configuration_unavailable", "Native Remote configuration is unavailable.")
		return errors.New("native remote configuration is unavailable")
	}
	api, err := NewAgentAPI(client)
	if err != nil {
		reportCompanionHealth("api_unavailable", "The protected Agent bridge could not initialise its API client.")
		return err
	}
	reportCompanionHealth("waiting_for_policy", "Waiting for a valid Native Remote policy and policy-pinned companion.")
	go func() {
		for ctx.Err() == nil {
			policy, policyErr := companionPolicyFromConfig(cfg)
			if policyErr == nil && policy.Enabled && cfg.NativeRemoteCompanionReady() {
				reportCompanionHealth("waiting_for_user_session", "Waiting for a signed-in user session to start the verified Remote Companion.")
				bridgeLoop(ctx, cfg.BaseDir(), policy, api)
				return
			}
			reportCompanionHealth("waiting_for_policy", "Waiting for a valid Native Remote policy and policy-pinned companion.")
			time.Sleep(10 * time.Second)
		}
	}()
	return nil
}

func companionPolicyFromConfig(cfg *config.Config) (CompanionPolicy, error) {
	if cfg == nil || cfg.PlatformPolicy == nil {
		return CompanionPolicy{}, errors.New("native remote policy is unavailable")
	}
	p := cfg.PlatformPolicy.NativeRemote
	value := CompanionPolicy{Enabled: boolValue(p["enabled"]), TenantID: stringValue(p["tenant_id"]), ManagedDeviceID: stringValue(p["managed_device_id"]), GrantKeyID: stringValue(p["grant_key_id"]), GrantPublicKey: stringValue(p["grant_public_key_b64"]), CompanionSHA256: stringValue(p["companion_sha256"])}
	if !value.Enabled {
		return value, nil
	}
	if _, err := NewCoordinator(value, NewMemoryReplayStore(1), func(string, Mode, time.Time) (bool, string) { return false, "" }, func(string, string, string) error { return nil }); err != nil {
		return CompanionPolicy{}, err
	}
	return value, nil
}
func stringValue(value any) string { result, _ := value.(string); return strings.TrimSpace(result) }
func boolValue(value any) bool     { result, _ := value.(bool); return result }

func bridgeLoop(ctx context.Context, installDir string, policy CompanionPolicy, api *AgentAPI) {
	for ctx.Err() == nil {
		pipe, err := createCompanionPipe()
		if err != nil {
			log.Printf("[native-remote] bridge pipe unavailable: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}
		err = windows.ConnectNamedPipe(pipe, nil)
		if err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
			_ = windows.CloseHandle(pipe)
			continue
		}
		if err := verifyCompanionClient(pipe, filepath.Join(installDir, "nexus-remote-companion.exe"), policy.CompanionSHA256); err != nil {
			log.Printf("[native-remote] rejected pipe client: %v", err)
			_ = windows.DisconnectNamedPipe(pipe)
			_ = windows.CloseHandle(pipe)
			continue
		}
		reportCompanionHealth("ready", "A verified signed-in Remote Companion is connected and can present attended consent.")
		file := os.NewFile(uintptr(pipe), "nexus-remote-bridge")
		if err := serveCompanion(ctx, file, policy, api); err != nil && !errors.Is(err, io.EOF) {
			log.Printf("[native-remote] companion session ended: %v", err)
		}
		_ = file.Close()
		if ctx.Err() == nil {
			reportCompanionHealth("waiting_for_user_session", "The verified Remote Companion disconnected; waiting for the signed-in user session to recover it.")
		}
	}
}

func createCompanionPipe() (windows.Handle, error) {
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;GA;;;SY)(A;;GRGW;;;AU)")
	if err != nil {
		return 0, err
	}
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	return windows.CreateNamedPipe(windows.StringToUTF16Ptr(CompanionPipeName), windows.PIPE_ACCESS_DUPLEX|windows.FILE_FLAG_FIRST_PIPE_INSTANCE, windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS, 1, maxIPCMessageSize, maxIPCMessageSize, 0, &sa)
}

func verifyCompanionClient(pipe windows.Handle, expected, expectedSHA256 string) error {
	var pid uint32
	result, _, err := getPipeClientPID.Call(uintptr(pipe), uintptr(unsafe.Pointer(&pid)))
	if result == 0 || pid == 0 {
		return err
	}
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(process)
	path := make([]uint16, 32768)
	length := uint32(len(path))
	if err := windows.QueryFullProcessImageName(process, 0, &path[0], &length); err != nil {
		return err
	}
	actual := windows.UTF16ToString(path[:length])
	if !strings.EqualFold(filepath.Clean(actual), filepath.Clean(expected)) {
		return errors.New("caller is not the installed Nexus Remote Companion")
	}
	file, err := os.Open(actual)
	if err != nil {
		return errors.New("unable to verify the connecting Remote Companion")
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return errors.New("unable to hash the connecting Remote Companion")
	}
	if len(strings.TrimSpace(expectedSHA256)) != sha256.Size*2 || !strings.EqualFold(fmt.Sprintf("%x", digest.Sum(nil)), strings.TrimSpace(expectedSHA256)) {
		return errors.New("connecting Remote Companion does not match the policy-pinned digest")
	}
	return nil
}

func serveCompanion(ctx context.Context, pipe *os.File, policy CompanionPolicy, api *AgentAPI) error {
	var grant *DeliveredGrant
	for ctx.Err() == nil && grant == nil {
		next, err := api.Pending()
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		grant = next
		if grant == nil {
			time.Sleep(time.Second)
		}
	}
	if grant == nil {
		return context.Canceled
	}
	if err := WriteIPCMessage(pipe, IPCMessage{Type: "grant", Grant: grant, Policy: &policy}); err != nil {
		return err
	}
	transportConnected := false
	defer func() {
		// If a frame relay or pipe operation fails after the companion proved it
		// was connected, remove the last desktop image at the control plane. A
		// best-effort report is intentionally ignored here: the agent may itself
		// be offline, in which case the server freshness window still fails closed.
		if transportConnected {
			if err := api.Transport(grant.SessionID, "disconnected", "agent bridge ended before companion disconnect confirmation"); err != nil {
				log.Printf("[native-remote] unable to report bridge disconnect: %v", err)
			}
		}
	}()
	for {
		message, err := ReadIPCMessage(pipe)
		if err != nil {
			return err
		}
		if message.SessionID != grant.SessionID {
			return errors.New("companion message session mismatch")
		}
		switch message.Type {
		case "ack":
			if message.Outcome != "accepted" && message.Outcome != "rejected" {
				return errors.New("invalid companion acknowledgement")
			}
			if err := api.Acknowledge(grant.SessionID, message.Outcome, message.Reason); err != nil {
				return err
			}
		case "transport":
			if err := api.Transport(grant.SessionID, message.State, message.Reason); err != nil {
				return err
			}
			transportConnected = message.State == "connected"
		case "status":
			// The user-session companion never receives the agent credential. It
			// can only ask this verified bridge to check a grant's current status.
			active, err := api.Status(grant.SessionID)
			if err != nil {
				return err
			}
			if err := WriteIPCMessage(pipe, IPCMessage{Type: "status", SessionID: grant.SessionID, Active: active}); err != nil {
				return err
			}
		case "stop":
			if err := api.LocalStop(grant.SessionID, boundedReason(message.Reason, "Endpoint user stopped view-only access")); err != nil {
				return err
			}
			return nil
		case "frame":
			jpeg, err := base64.StdEncoding.Strict().DecodeString(message.JPEGBase64)
			if err != nil {
				return errors.New("invalid companion frame")
			}
			if err := api.SendFrame(context.Background(), grant.SessionID, jpeg); err != nil {
				return err
			}
		default:
			return errors.New("unsupported companion message")
		}
	}
}
