// Nexus Client Chat is a per-user companion. The Windows service keeps its
// credentials private; this local window talks only to localhost, while the
// companion relays requests to NexusMSP using the agent token.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"

	"nexusagent/internal/config"
)

const listen = "127.0.0.1:5967"

func main() {
	cfg, err := config.LoadOrInit("")
	if err != nil || cfg.AgentToken == "" {
		log.Fatal("Nexus Client Chat needs an enrolled NexusOps Agent")
	}
	proxy := func(w http.ResponseWriter, r *http.Request) {
		path := "/api/live-chat/agent/session"
		if r.URL.Path == "/api/send" {
			path += "/messages"
		}
		if r.URL.Path == "/api/typing" {
			path += "/typing"
		}
		var body io.Reader
		if r.Method == http.MethodPost {
			body = r.Body
		}
		req, err := http.NewRequest(r.Method, strings.TrimRight(cfg.ServerURL, "/")+path, body)
		if err != nil {
			http.Error(w, "Unable to reach NexusMSP", 502)
			return
		}
		req.Header.Set("X-Agent-Token", cfg.AgentToken)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "NexusMSP is unavailable", 502)
			return
		}
		defer res.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(res.StatusCode)
		_, _ = io.Copy(w, res.Body)
	}
	http.HandleFunc("/api/session", proxy)
	http.HandleFunc("/api/send", proxy)
	http.HandleFunc("/api/typing", proxy)
	http.HandleFunc("/api/elevate/request", elevationRequestProxy(cfg))
	http.HandleFunc("/api/elevate/status", elevationStatusProxy(cfg))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.URL.Path == "/elevate" {
			_, _ = io.WriteString(w, elevationPage)
			return
		}
		chatPage := strings.Replace(page, "</header>", `<a href="/elevate" style="margin-left:auto;border:1px solid #34d39955;background:#064e3b;color:#d1fae5;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;text-decoration:none">Request admin access</a></header>`, 1)
		_, _ = io.WriteString(w, chatPage)
	})
	go func() { _ = open("http://" + listen) }()
	log.Printf("Nexus Client Chat listening at http://%s", listen)
	log.Fatal(http.ListenAndServe(listen, nil))
}

type elevationForm struct {
	ProgramPath   string `json:"program_path"`
	ArgumentsText string `json:"arguments_text"`
	Justification string `json:"justification"`
	TicketID      string `json:"ticket_id"`
}

func elevationRequestProxy(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var form elevationForm
		if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&form); err != nil {
			http.Error(w, "Invalid elevation request", http.StatusBadRequest)
			return
		}
		programPath := strings.TrimSpace(form.ProgramPath)
		if !filepath.IsAbs(programPath) || !strings.EqualFold(filepath.Ext(programPath), ".exe") {
			http.Error(w, "Choose an absolute Windows .exe path", http.StatusBadRequest)
			return
		}
		if len(strings.TrimSpace(form.Justification)) < 8 {
			http.Error(w, "Explain why administrator access is required", http.StatusBadRequest)
			return
		}
		hash, err := sha256File(programPath)
		if err != nil {
			http.Error(w, "Unable to fingerprint the selected program: "+err.Error(), http.StatusBadRequest)
			return
		}
		arguments := make([]string, 0)
		for _, line := range strings.Split(form.ArgumentsText, "\n") {
			argument := strings.TrimSpace(line)
			if argument != "" {
				arguments = append(arguments, argument)
			}
		}
		if len(arguments) > 64 {
			http.Error(w, "Too many arguments", http.StatusBadRequest)
			return
		}
		hostname, _ := os.Hostname()
		requester := map[string]string{"name": "Endpoint user"}
		if current, currentErr := user.Current(); currentErr == nil {
			requester["name"] = current.Name
			if requester["name"] == "" {
				requester["name"] = current.Username
			}
			requester["sid"] = current.Uid
		}
		payload := map[string]any{
			"program_path":  programPath,
			"arguments":     arguments,
			"sha256":        hash,
			"publisher":     "Authenticode publisher not supplied by the companion",
			"hostname":      hostname,
			"requester":     requester,
			"justification": strings.TrimSpace(form.Justification),
			"ticket_id":     strings.TrimSpace(form.TicketID),
			"agent_version": "nexus-client-companion",
		}
		forwardJSON(w, r, cfg, "/api/nexus-elevate/agent/requests", http.MethodPost, payload)
	}
}

func elevationStatusProxy(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.URL.Query().Get("id"))
		if requestID == "" || len(requestID) > 100 {
			http.Error(w, "A request id is required", http.StatusBadRequest)
			return
		}
		forwardJSON(w, r, cfg, "/api/nexus-elevate/agent/requests/"+requestID, http.MethodGet, nil)
	}
}

func forwardJSON(w http.ResponseWriter, _ *http.Request, cfg *config.Config, path, method string, payload any) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			http.Error(w, "Could not prepare request", http.StatusInternalServerError)
			return
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, strings.TrimRight(cfg.ServerURL, "/")+path, body)
	if err != nil {
		http.Error(w, "Unable to reach NexusMSP", http.StatusBadGateway)
		return
	}
	req.Header.Set("X-Agent-Token", cfg.AgentToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, "NexusMSP is unavailable", http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.StatusCode)
	_, _ = io.Copy(w, res.Body)
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func open(url string) error {
	if runtime.GOOS == "windows" {
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	}
	return fmt.Errorf("open %s in a browser", url)
}

var _ = bytes.NewBuffer
var _ = json.NewEncoder

const elevationPage = `<!doctype html><html><head><meta charset="utf-8"><title>Nexus Elevate</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top right,#065f4650,transparent 36%),#10151d;color:#eef2f7;font:14px Segoe UI,Arial,sans-serif}.wrap{width:min(760px,calc(100% - 32px));margin:0 auto;padding:34px 0}.back{display:inline-flex;color:#a5f3fc;text-decoration:none;font-size:12px;margin-bottom:22px}.card{border:1px solid #ffffff16;border-radius:18px;background:#151b24;padding:26px;box-shadow:0 18px 60px #0005}.top{display:flex;gap:13px;align-items:center}.mark{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#10b981,#06b6d4);font-size:21px}.eyebrow{font-size:10px;color:#67e8f9;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.top h1{font-size:22px;margin:4px 0}.sub{color:#94a3b8;line-height:1.55;margin:18px 0}.notice{border:1px solid #34d39935;background:#064e3b35;border-radius:12px;padding:12px;color:#d1fae5;font-size:12px;line-height:1.5}.field{margin-top:17px}.field label{display:block;font-size:12px;font-weight:700;margin-bottom:7px}.field small{color:#94a3b8;display:block;margin-top:5px;line-height:1.45}input,textarea{width:100%;border:1px solid #ffffff18;border-radius:10px;background:#0d131b;color:#fff;padding:10px 11px;font:inherit}textarea{min-height:82px;resize:vertical}input:focus,textarea:focus{outline:2px solid #22d3ee66;border-color:#22d3ee}.actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}button{background:#059669;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.status{display:none;margin-top:18px;border-radius:10px;padding:12px;line-height:1.45}.status.ok{display:block;border:1px solid #38bdf833;background:#0c4a6e44;color:#dbeafe}.status.err{display:block;border:1px solid #fb718533;background:#4c051944;color:#ffe4e6}.status.done{display:block;border:1px solid #34d39933;background:#064e3b55;color:#d1fae5}.hash{font-family:Consolas,monospace;font-size:11px;word-break:break-all;color:#a7f3d0;margin-top:6px}</style></head><body><main class="wrap"><a class="back" href="/">&larr; Return to client chat</a><section class="card"><div class="top"><div class="mark">&#128737;</div><div><div class="eyebrow">NexusOps protected access</div><h1>Request administrator access</h1></div></div><p class="sub">Send a time-bound request to your support team. The selected program is fingerprinted on this device before the team can approve it.</p><div class="notice">Your support team sees the program path, SHA-256 fingerprint, device, your reason and optional ticket reference. Approval launches only that exact program; it does not give your account permanent administrator rights.</div><form id="request"><div class="field"><label for="program">Program path</label><input id="program" required placeholder="C:\\Program Files\\Vendor\\setup.exe"><small>Enter the full path to the Windows .exe that requires approval.</small></div><div class="field"><label for="arguments">Program arguments (one per line, optional)</label><textarea id="arguments" placeholder="/quiet&#10;/norestart"></textarea></div><div class="field"><label for="ticket">Related ticket (optional)</label><input id="ticket" placeholder="e.g. SLA-1042"></div><div class="field"><label for="reason">Why do you need administrator access?</label><textarea id="reason" required minlength="8" placeholder="Describe the work being performed and why it is required."></textarea></div><div class="actions"><button id="submit" type="submit">Request approval</button></div></form><div id="status" class="status"></div></section></main><script>const $=s=>document.querySelector(s);let requestId='';function show(text,kind='ok'){let e=$('#status');e.className='status '+kind;e.textContent=text}async function submit(e){e.preventDefault();let b=$('#submit');b.disabled=true;show('Fingerprinting the selected program and submitting your request...');try{let r=await fetch('/api/elevate/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({program_path:$('#program').value,arguments_text:$('#arguments').value,justification:$('#reason').value,ticket_id:$('#ticket').value})});let d=await r.json();if(!r.ok)throw Error(d.detail||d.message||'Request could not be submitted');requestId=d.id;show('Request '+requestId+' is awaiting support approval. This window will update automatically.');setTimeout(check,2500)}catch(err){show(err.message,'err');b.disabled=false}}async function check(){if(!requestId)return;try{let r=await fetch('/api/elevate/status?id='+encodeURIComponent(requestId));let d=await r.json();if(!r.ok)throw Error(d.detail||'Status unavailable');if(d.status==='pending'){show('Request '+requestId+' is awaiting support approval.');setTimeout(check,3000);return}if(d.status==='approved'){show('Approved. Nexus Agent is securely launching the exact approved program.','ok');setTimeout(check,2500);return}if(d.status==='executed'){show('Approved program launched successfully. This request has been recorded in the service audit.','done');return}if(d.status==='denied'){show('The request was not approved: '+(d.denial_reason||'Please contact support for the next step.'),'err');return}show('Request status: '+d.status+(d.denial_reason?'. '+d.denial_reason:''),'err')}catch(err){show('Could not check request status. Retrying...','err');setTimeout(check,5000)}}$('#request').addEventListener('submit',submit);</script></body></html>`

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Nexus Client Chat</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e1218;color:#eef2f7;font:14px Segoe UI,Arial,sans-serif}.app{height:100vh;display:flex;flex-direction:column;background:radial-gradient(circle at top right,#0b3b3c55,transparent 38%),#10151d}.head{padding:20px 24px;border-bottom:1px solid #ffffff14;display:flex;align-items:center;gap:12px}.mark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#10b981,#06b6d4);font-size:20px}.eyebrow{font-size:10px;color:#67e8f9;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.head h1{font-size:18px;margin:3px 0}.sub{font-size:12px;color:#94a3b8}.messages{flex:1;overflow:auto;padding:20px 24px}.message{max-width:78%;margin:10px 0;padding:11px 13px;border:1px solid #ffffff10;border-radius:14px;background:#1c2430;line-height:1.45}.mine{margin-left:auto;background:#047857;border-color:#34d39955}.meta{font-size:10px;color:#a7b4c5;margin-bottom:4px}.typing{min-height:24px;padding:0 24px;color:#a5f3fc;font-size:12px}.compose{border-top:1px solid #ffffff14;padding:14px 18px;background:#151b24}.tools{display:flex;gap:6px;margin-bottom:8px}.tools button{border:1px solid #ffffff16;background:#ffffff08;color:#dbeafe;border-radius:8px;padding:5px 8px;cursor:pointer}.row{display:flex;gap:9px}textarea{flex:1;resize:none;min-height:54px;border:1px solid #ffffff18;border-radius:12px;background:#0d131b;color:#fff;padding:11px;font:inherit}textarea:focus{outline:2px solid #22d3ee66;border-color:#22d3ee}button.send{background:#059669;color:#fff;border:0;border-radius:10px;padding:0 16px;font-weight:700;cursor:pointer}</style></head><body><main class="app"><header class="head"><div class="mark">💬</div><div><div class="eyebrow">NexusOps secure support</div><h1>Client Chat</h1><div class="sub">Directly connected to your managed device</div></div></header><section id="messages" class="messages"></section><div id="typing" class="typing"></div><footer class="compose"><div class="tools"><button onclick="add('👍')">👍</button><button onclick="add('😊')">😊</button><button onclick="add('🎉')">🎉</button><button onclick="add('✅')">✅</button></div><div class="row"><textarea id="input" placeholder="Message your support team..." oninput="changed()"></textarea><button class="send" onclick="send()">Send</button></div></footer></main><script>let last='',typingAt=0;const q=s=>document.querySelector(s);async function api(path,method='GET',body){let r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return r.json()}function add(e){q('#input').value+=e;q('#input').focus();changed()}async function load(){try{let d=await api('/api/session');let k=JSON.stringify(d.messages||[]);if(k!==last){last=k;q('#messages').innerHTML=(d.messages||[]).map(m=>'<article class="message '+(m.sender_type==='visitor'?'mine':'')+'"><div class="meta">'+(m.sender_name||'Support')+'</div>'+esc(m.content)+'</article>').join('');q('#messages').scrollTop=999999}q('#typing').textContent=(d.typing_users||[]).filter(x=>x.role==='technician').map(x=>x.name+' is typing...').join(' ')}catch(e){q('#typing').textContent='Reconnecting to NexusMSP...' }}function esc(s){let x=document.createElement('span');x.textContent=s||'';return x.innerHTML}function changed(){let v=q('#input').value;if(v.trim()&&Date.now()-typingAt>1800){typingAt=Date.now();api('/api/typing','POST',{typing:true})}if(!v.trim())api('/api/typing','POST',{typing:false})}async function send(){let v=q('#input').value.trim();if(!v)return;await api('/api/send','POST',{content:v});q('#input').value='';await api('/api/typing','POST',{typing:false});load()}q('#input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};load();setInterval(load,2500)</script></body></html>`
