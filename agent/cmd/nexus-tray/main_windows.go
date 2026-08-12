//go:build windows

// Nexus Agent Tray runs in the signed-in user's session. The agent itself is a
// Windows service, so this companion is intentionally separate from it.
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/getlantern/systray"
	"nexusagent/internal/config"
)

const consoleAddress = "127.0.0.1:5968"

type localStatus struct {
	Agent struct {
		ID         string `json:"id"`
		Hostname   string `json:"hostname"`
		ClientName string `json:"client_name"`
		Online     bool   `json:"online"`
		LastSeen   string `json:"last_seen"`
		Version    string `json:"version"`
		Identity   string `json:"identity"`
	} `json:"agent"`
	Update struct {
		CurrentVersion    string `json:"current_version"`
		TargetVersion     string `json:"target_version"`
		State             string `json:"state"`
		SignatureVerified bool   `json:"signature_verified"`
		UpdateAvailable   bool   `json:"update_available"`
	} `json:"update"`
	Services []struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		State    string `json:"state"`
		Included bool   `json:"included"`
	} `json:"services"`
}

var (
	cfg           *config.Config
	lastStatus    localStatus
	lastErr       string
	statusMu      sync.RWMutex
	consoleServer *http.Server
)

func main() {
	var err error
	cfg, err = config.LoadOrInit("")
	if err != nil || cfg.AgentToken == "" {
		return
	}
	go startConsole()
	systray.Run(onReady, func() {
		if consoleServer != nil {
			_ = consoleServer.Shutdown(context.Background())
		}
	})
}

func onReady() {
	systray.SetIcon(nexusIcon())
	systray.SetTitle("Nexus Agent")
	systray.SetTooltip("Nexus Agent — checking service status")
	brand := systray.AddMenuItem("NexusMSP • checking managed endpoint…", "NexusMSP managed-device companion")
	brand.Disable()
	state := systray.AddMenuItem("Checking Nexus Agent…", "Live service and platform status")
	state.Disable()
	systray.AddSeparator()
	openConsole := systray.AddMenuItem("Open Nexus Agent Hub", "View health, updates, included services and support routes")
	openChat := systray.AddMenuItem("Open Client Chat", "Message your NexusMSP support team")
	openElevate := systray.AddMenuItem("Nexus Elevate — requests & progress", "Request controlled access or check existing request progress")
	about := systray.AddMenuItem("About this Nexus Agent", "View product, endpoint and trust information")
	refresh := systray.AddMenuItem("Refresh status", "Check Nexus Agent now")
	systray.AddSeparator()
	quit := systray.AddMenuItem("Quit tray app", "The protected Nexus Agent service keeps running")

	refreshStatus(brand, state)
	go func() {
		tick := time.NewTicker(45 * time.Second)
		defer tick.Stop()
		for range tick.C {
			refreshStatus(brand, state)
		}
	}()
	go func() {
		for range openConsole.ClickedCh {
			openURL("http://" + consoleAddress)
		}
	}()
	go func() {
		for range openChat.ClickedCh {
			startClientChat("")
		}
	}()
	go func() {
		for range openElevate.ClickedCh {
			startClientChat("/elevate/progress")
		}
	}()
	go func() {
		for range about.ClickedCh {
			openURL("http://" + consoleAddress + "/?view=about")
		}
	}()
	go func() {
		for range refresh.ClickedCh {
			refreshStatus(brand, state)
		}
	}()
	go func() { <-quit.ClickedCh; systray.Quit() }()
}

func refreshStatus(brand, item *systray.MenuItem) {
	serviceOK := windowsServiceRunning()
	status, err := getStatus()
	statusMu.Lock()
	defer statusMu.Unlock()
	if err != nil {
		lastErr = err.Error()
	} else {
		lastStatus, lastErr = status, ""
	}
	if status.Agent.Hostname != "" {
		brand.SetTitle("NexusMSP • " + status.Agent.Hostname)
	}
	if !serviceOK {
		item.SetTitle("● Agent service needs attention")
		systray.SetTooltip("Nexus Agent — service is not running")
		return
	}
	if err != nil {
		item.SetTitle("● Agent service running — platform unavailable")
		systray.SetTooltip("Nexus Agent — waiting for NexusMSP")
		return
	}
	if status.Update.UpdateAvailable {
		item.SetTitle("● Agent running — update ready")
		systray.SetTooltip("Nexus Agent — update available")
	} else {
		item.SetTitle("● Agent running — " + status.Agent.Hostname)
		systray.SetTooltip("Nexus Agent — protected and connected")
	}
}

func getStatus() (localStatus, error) {
	var status localStatus
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(cfg.ServerURL, "/")+"/api/nexus-agent/local/status", nil)
	if err != nil {
		return status, err
	}
	req.Header.Set("X-Agent-Token", cfg.AgentToken)
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return status, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 256*1024))
	if res.StatusCode >= 300 {
		return status, fmt.Errorf("NexusMSP returned %s", res.Status)
	}
	if err := json.Unmarshal(body, &status); err != nil {
		return status, err
	}
	return status, nil
}

func windowsServiceRunning() bool {
	out, err := exec.Command("sc", "query", "NexusOpsAgent").CombinedOutput()
	return err == nil && strings.Contains(string(out), "RUNNING")
}

func startClientChat(path string) {
	if conn, err := net.DialTimeout("tcp", "127.0.0.1:5967", 180*time.Millisecond); err == nil {
		_ = conn.Close()
	} else if exe, err := os.Executable(); err == nil {
		_ = exec.Command(filepath.Join(filepath.Dir(exe), "nexus-client-chat.exe")).Start()
		time.Sleep(250 * time.Millisecond)
	}
	if path != "" {
		openURL("http://127.0.0.1:5967" + path)
	}
}

func startConsole() {
	consoleServer = &http.Server{Addr: consoleAddress, Handler: http.HandlerFunc(consolePage)}
	_ = consoleServer.ListenAndServe()
}

func consolePage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	statusMu.RLock()
	status, errText := lastStatus, lastErr
	statusMu.RUnlock()
	if status.Agent.ID == "" && errText == "" {
		refreshed, err := getStatus()
		if err != nil {
			errText = err.Error()
		} else {
			status = refreshed
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	serviceOK := windowsServiceRunning()
	if r.URL.Query().Get("view") == "about" {
		_, _ = fmt.Fprint(w, aboutHTML(status, serviceOK, errText))
		return
	}
	_, _ = fmt.Fprint(w, consoleHTML(status, windowsServiceRunning(), errText))
}

func aboutHTML(s localStatus, serviceOK bool, errText string) string {
	state := "Connected"
	if !serviceOK {
		state = "Service needs attention"
	}
	if errText != "" {
		state = "Platform unavailable"
	}
	return fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><title>About Nexus Agent</title><style>body{margin:0;background:#071018;color:#f4f9fc;font:14px Inter,Segoe UI,Arial,sans-serif}.shell{max-width:720px;margin:auto;padding:48px 28px}.orb{width:58px;height:58px;border-radius:20px;background:radial-gradient(circle at 30%% 28%%,#7fffe4,#11b9d7 42%%,#073b63 72%%);box-shadow:0 0 38px #19d9e477}.eyebrow{margin-top:20px;font-size:10px;color:#69e8ff;font-weight:800;letter-spacing:.16em}.title{font-size:30px;font-weight:780;margin:7px 0}.lead{max-width:610px;color:#9fb0bf;line-height:1.65}.card{margin-top:24px;background:#0c1823;border:1px solid #ffffff12;border-radius:16px;padding:19px}.row{display:flex;justify-content:space-between;gap:20px;padding:10px 0;border-bottom:1px solid #ffffff0d}.row:last-child{border:0}.label{color:#8ca2b7;font-size:11px;font-weight:750;letter-spacing:.1em}.value{text-align:right;font-weight:650}.actions{display:flex;gap:10px;margin-top:24px}a{color:#eaffff;text-decoration:none;border:1px solid #30d5ca55;background:#0d4d4b;padding:10px 13px;border-radius:10px;font-weight:700}</style></head><body><main class="shell"><div class="orb"></div><div class="eyebrow">NEXUSMSP · ENDPOINT EXPERIENCE</div><h1 class="title">Nexus Agent</h1><p class="lead">The local, user-visible companion for your managed NexusMSP endpoint. It gives you a clear path to support chat and controlled Nexus Elevate requests while the protected service continues in the background.</p><section class="card"><div class="row"><span class="label">ENDPOINT</span><span class="value">%s</span></div><div class="row"><span class="label">CLIENT</span><span class="value">%s</span></div><div class="row"><span class="label">AGENT VERSION</span><span class="value">%s</span></div><div class="row"><span class="label">SERVICE STATE</span><span class="value">%s</span></div></section><div class="actions"><a href="/">Open Agent Hub</a><a href="http://127.0.0.1:5967/elevate/progress">Elevate progress</a></div></main></body></html>`, htmlEscape(s.Agent.Hostname), htmlEscape(s.Agent.ClientName), htmlEscape(s.Agent.Version), htmlEscape(state))
}

func consoleHTML(s localStatus, serviceOK bool, errText string) string {
	state := "Connected"
	stateClass := "good"
	if !serviceOK {
		state, stateClass = "Service needs attention", "bad"
	} else if errText != "" {
		state, stateClass = "Platform unavailable", "warn"
	}
	services := ""
	for _, service := range s.Services {
		badge := "Included"
		class := "good"
		if !service.Included {
			badge, class = "Not included", "muted"
		} else if service.State != "active" {
			badge, class = service.State, "warn"
		}
		services += fmt.Sprintf(`<article class="service"><strong>%s</strong><span class="pill %s">%s</span></article>`, htmlEscape(service.Name), class, htmlEscape(strings.ReplaceAll(badge, "_", " ")))
	}
	if services == "" {
		services = `<p class="empty">Service entitlement will appear after the next secure check-in.</p>`
	}
	update := "Up to date"
	if s.Update.UpdateAvailable {
		update = "Update ready: " + s.Update.TargetVersion
	}
	return fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><title>Nexus Agent Console</title><style>body{margin:0;background:#071018;color:#f4f9fc;font:14px Inter,Segoe UI,Arial,sans-serif}.shell{max-width:980px;margin:auto;padding:32px}.top{display:flex;align-items:center;justify-content:space-between}.mark{display:flex;gap:12px;align-items:center}.orb{width:38px;height:38px;border-radius:13px;background:radial-gradient(circle at 30%% 28%%,#7fffe4,#11b9d7 42%%,#073b63 72%%);box-shadow:0 0 25px #19d9e466}.eyebrow{font-size:10px;color:#69e8ff;font-weight:800;letter-spacing:.15em}.title{font-size:22px;font-weight:750;margin:2px 0}.status{padding:9px 12px;border:1px solid #ffffff14;border-radius:999px;font-size:12px}.good{color:#8ff4c7;background:#0c513d66;border-color:#35d39155}.warn{color:#fde68a;background:#6a501755;border-color:#f6c45355}.bad{color:#fecdd3;background:#641c2d66;border-color:#fb718555}.muted{color:#a8b4c2;background:#ffffff0c}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:24px 0}.card{background:#0c1823;border:1px solid #ffffff12;border-radius:16px;padding:18px;box-shadow:0 12px 28px #0004}.label{font-size:10px;color:#8ca2b7;font-weight:750;letter-spacing:.11em}.value{font-size:19px;font-weight:700;margin-top:7px}.sub{margin-top:6px;color:#95a7b8;font-size:12px}.services{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.service{display:flex;justify-content:space-between;align-items:center;border:1px solid #ffffff10;background:#09141f;border-radius:12px;padding:13px}.pill{padding:4px 7px;border-radius:999px;font-size:10px;text-transform:capitalize}.empty{color:#95a7b8}.error{margin-top:15px;color:#fecdd3}@media(max-width:700px){.grid,.services{grid-template-columns:1fr}.shell{padding:20px}}</style></head><body><main class="shell"><header class="top"><div class="mark"><div class="orb"></div><div><div class="eyebrow">NEXUSOPS · LOCAL TRUST CONSOLE</div><div class="title">Nexus Agent</div></div></div><div class="status %s">%s</div></header><section class="grid"><article class="card"><div class="label">MANAGED ENDPOINT</div><div class="value">%s</div><div class="sub">%s</div></article><article class="card"><div class="label">AGENT VERSION</div><div class="value">%s</div><div class="sub">%s</div></article><article class="card"><div class="label">DEVICE IDENTITY</div><div class="value">%s</div><div class="sub">Last platform contact: %s</div></article></section><section class="card"><div class="label">INCLUDED NEXUS SERVICES</div><div class="services" style="margin-top:13px">%s</div></section>%s</main></body></html>`, stateClass, htmlEscape(state), htmlEscape(s.Agent.Hostname), htmlEscape(s.Agent.ClientName), htmlEscape(s.Agent.Version), htmlEscape(update), htmlEscape(strings.ReplaceAll(s.Agent.Identity, "_", " ")), htmlEscape(s.Agent.LastSeen), services, func() string {
		if errText == "" {
			return ""
		}
		return `<p class="error">` + htmlEscape(errText) + `</p>`
	}())
}

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}
func openURL(url string) { _ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start() }

func nexusIcon() []byte {
	// A compact 16px turquoise orb ICO generated at runtime; no external asset is required.
	const width, height = 16, 16
	const pixels = width * height * 4
	icon := make([]byte, 22+40+pixels+64)
	binary.LittleEndian.PutUint16(icon[2:], 1)
	binary.LittleEndian.PutUint16(icon[4:], 1)
	icon[6], icon[7] = width, height
	binary.LittleEndian.PutUint16(icon[10:], 1)
	binary.LittleEndian.PutUint16(icon[12:], 32)
	binary.LittleEndian.PutUint32(icon[14:], 40+pixels+64)
	binary.LittleEndian.PutUint32(icon[18:], 22)
	binary.LittleEndian.PutUint32(icon[22:], 40)
	binary.LittleEndian.PutUint32(icon[26:], width)
	binary.LittleEndian.PutUint32(icon[30:], height*2)
	binary.LittleEndian.PutUint16(icon[34:], 1)
	binary.LittleEndian.PutUint16(icon[36:], 32)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			dx, dy := x-7, y-7
			if dx*dx+dy*dy <= 52 {
				p := 62 + (height-1-y)*width*4 + x*4
				icon[p], icon[p+1], icon[p+2], icon[p+3] = 210, 202, 35, 255
			}
		}
	}
	return icon
}
