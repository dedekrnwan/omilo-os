// omilo: install, run and talk to your Omilo gateway from a terminal.
package main

import (
	"bufio"
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"text/tabwriter"
	"time"
)

var version = "0.3.0"

//go:embed compose.yml
var composeFile []byte

type config struct {
	URL     string `json:"url"`
	Token   string `json:"token"`
	Company string `json:"company,omitempty"` // which company commands work on (empty = the first one)
}

func dataDir() string {
	if d := os.Getenv("OMILO_HOME"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		return filepath.Join(home, "Omilo")
	}
	return filepath.Join(home, ".omilo")
}

func configPath() string { return filepath.Join(dataDir(), "cli.json") }

func loadConfig() config {
	c := config{URL: "http://localhost:7700"}
	if b, err := os.ReadFile(configPath()); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	if u := os.Getenv("OMILO_URL"); u != "" {
		c.URL = u
	}
	if t := os.Getenv("OMILO_TOKEN"); t != "" {
		c.Token = t
	}
	if co := os.Getenv("OMILO_COMPANY"); co != "" {
		c.Company = co
	}
	c.URL = strings.TrimRight(c.URL, "/")
	return c
}

func saveConfig(c config) error {
	if err := os.MkdirAll(dataDir(), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(configPath(), b, 0o600)
}

// ------------------------------------------------------------------ HTTP
type apiError struct {
	Status int
	Detail string
}

func (e *apiError) Error() string { return fmt.Sprintf("%d: %s", e.Status, e.Detail) }

func call(method, path string, body any, out any) error {
	c := loadConfig()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.URL+"/api"+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if c.Company != "" {
		req.Header.Set("X-Omilo-Company", c.Company)
	}
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach Omilo at %s (is it running? try `omilo up`): %w", c.URL, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var e struct {
			Detail any `json:"detail"`
		}
		_ = json.Unmarshal(data, &e)
		msg := fmt.Sprint(e.Detail)
		if e.Detail == nil {
			msg = strings.TrimSpace(string(data))
		}
		if resp.StatusCode == 401 {
			msg += " (run `omilo login`)"
		}
		return &apiError{resp.StatusCode, msg}
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// ------------------------------------------------------------------ helpers
func die(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func must(err error) {
	if err != nil {
		die(err)
	}
}

var stdin = bufio.NewReader(os.Stdin)

func prompt(label string) string {
	fmt.Print(label)
	s, _ := stdin.ReadString('\n')
	return strings.TrimSpace(s)
}

func promptSecret(label string) string {
	fmt.Print(label)
	if runtime.GOOS != "windows" {
		_ = exec.Command("stty", "-F", "/dev/tty", "-echo").Run()
		_ = exec.Command("stty", "-f", "/dev/tty", "-echo").Run()
		defer func() {
			_ = exec.Command("stty", "-F", "/dev/tty", "echo").Run()
			_ = exec.Command("stty", "-f", "/dev/tty", "echo").Run()
			fmt.Println()
		}()
	}
	s, _ := stdin.ReadString('\n')
	return strings.TrimSpace(s)
}

func table(header string, rows [][]string) {
	w := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(w, header)
	for _, r := range rows {
		fmt.Fprintln(w, strings.Join(r, "\t"))
	}
	w.Flush()
}

func short(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > n {
		return s[:n-1] + "…"
	}
	return s
}

func str(m map[string]any, k string) string {
	if v, ok := m[k]; ok && v != nil {
		return fmt.Sprint(v)
	}
	return ""
}

// ------------------------------------------------------------------ docker compose (up / down / logs)
func composePath() (string, error) {
	if err := os.MkdirAll(dataDir(), 0o700); err != nil {
		return "", err
	}
	p := filepath.Join(dataDir(), "compose.yml")
	if err := os.WriteFile(p, composeFile, 0o600); err != nil {
		return "", err
	}
	return p, nil
}

func compose(args ...string) error {
	if _, err := exec.LookPath("docker"); err != nil {
		return errors.New("Docker is not installed. Install Docker Desktop (macOS, Windows) or Docker Engine (Linux), then try again")
	}
	p, err := composePath()
	if err != nil {
		return err
	}
	cmd := exec.Command("docker", append([]string{"compose", "-f", p, "-p", "omilo"}, args...)...)
	cmd.Stdout, cmd.Stderr, cmd.Stdin = os.Stdout, os.Stderr, os.Stdin
	cmd.Env = append(os.Environ(), "OMILO_HOME="+dataDir())
	return cmd.Run()
}

func waitHealthy(url string) bool {
	for i := 0; i < 60; i++ {
		r, err := http.Get(url + "/healthz")
		if err == nil && r.StatusCode == 200 {
			r.Body.Close()
			return true
		}
		time.Sleep(time.Second)
	}
	return false
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

// ------------------------------------------------------------------ commands
func cmdUp(args []string) {
	fs := flag.NewFlagSet("up", flag.ExitOnError)
	port := fs.String("port", "7700", "port on this machine")
	noOpen := fs.Bool("no-open", false, "don't open the browser")
	_ = fs.Parse(args)
	os.Setenv("OMILO_PORT", *port)
	must(compose("up", "-d", "--pull", "missing"))
	url := "http://localhost:" + *port
	c := loadConfig()
	c.URL = url
	must(saveConfig(c))
	fmt.Print("Waiting for Omilo to start")
	if !waitHealthy(url) {
		die(errors.New("it did not become healthy in 60s; see `omilo logs`"))
	}
	fmt.Println(" ready:", url)
	if !*noOpen {
		openBrowser(url)
	}
}

func cmdLogin(args []string) {
	fs := flag.NewFlagSet("login", flag.ExitOnError)
	url := fs.String("url", loadConfig().URL, "Omilo address")
	_ = fs.Parse(args)
	c := loadConfig()
	c.URL = strings.TrimRight(*url, "/")
	c.Token = ""
	must(saveConfig(c))
	email := prompt("Email: ")
	pw := promptSecret("Password: ")
	host, _ := os.Hostname()
	var out struct {
		Token string `json:"token"`
	}
	must(call("POST", "/auth/login", map[string]string{"email": email, "password": pw, "token_name": "cli@" + host}, &out))
	c.Token = out.Token
	must(saveConfig(c))
	fmt.Println("Signed in. Token saved in", configPath())
}

func cmdStatus() {
	var o map[string]any
	must(call("GET", "/overview", nil, &o))
	inbox := o["inbox"].(map[string]any)
	tasks := o["tasks"].(map[string]any)
	state := "live"
	if o["paused"] == true {
		state = "PAUSED"
	}
	fmt.Printf("%s · %s · inbox %v open (%v blocking) · %v working, %v queued · done 24h %v, failed 24h %v\n",
		str(o, "company_name"), state, inbox["open"], inbox["blocking"], tasks["running"], tasks["queued"], tasks["done_24h"], tasks["failed_24h"])
}

func cmdInbox() {
	var items []map[string]any
	must(call("GET", "/inbox", nil, &items))
	if len(items) == 0 {
		fmt.Println("Nothing waiting for you.")
		return
	}
	rows := [][]string{}
	for _, i := range items {
		ref := str(i, "id")
		if i["kind"] == "proposal" {
			ref = str(i, "ref_id")
		}
		flag := ""
		if i["blocking"] == true {
			flag = "BLOCKING"
		}
		rows = append(rows, []string{ref, str(i, "kind"), str(i, "staff_id"), flag, short(str(i, "title"), 70)})
	}
	table("ID\tKIND\tFROM\t\tTITLE", rows)
	fmt.Println("\nomilo show <id> · approve <id> · reject <id> -note \"...\" · changes <id> -note \"...\" · answer <id> \"...\"")
}

func cmdShow(id string) {
	var p map[string]any
	if err := call("GET", "/proposals/"+id, nil, &p); err == nil {
		fmt.Printf("%s  [%s · %s risk · %s]\nfrom %s, revision %v\n\n%s\n", str(p, "title"), str(p, "type"), str(p, "risk"), str(p, "status"),
			str(p, "staff_id"), p["current_revision"], str(p, "body_md"))
		return
	}
	var t map[string]any
	must(call("GET", "/tasks/"+id, nil, &t))
	fmt.Printf("%s · %s · %s\n%s\n", str(t, "staff_id"), str(t, "origin"), str(t, "status"), str(t, "brief"))
	if r, ok := t["report"].(map[string]any); ok {
		fmt.Printf("\n# %s\n\n%s\n", str(r, "headline"), str(r, "body_md"))
	}
	if e := str(t, "error"); e != "" {
		fmt.Println("\nerror:", e)
	}
}

func cmdDecide(decision string, args []string) {
	fs := flag.NewFlagSet(decision, flag.ExitOnError)
	note := fs.String("note", "", "note for the agent (required to reject or ask for changes)")
	_ = fs.Parse(reorder(args))
	if fs.NArg() != 1 {
		die(fmt.Errorf("usage: omilo %s <proposal id> [-note \"...\"]", decision))
	}
	d := map[string]string{"approve": "approve", "reject": "reject", "changes": "changes"}[decision]
	var p map[string]any
	must(call("POST", "/proposals/"+fs.Arg(0)+"/decide", map[string]string{"decision": d, "note": *note}, &p))
	fmt.Printf("%s: %s\n", str(p, "status"), str(p, "title"))
}

// reorder lets flags come after positional args: `approve prp_1 -note x`
func reorder(args []string) []string {
	var flags, pos []string
	for i := 0; i < len(args); i++ {
		if strings.HasPrefix(args[i], "-") {
			flags = append(flags, args[i])
			if !strings.Contains(args[i], "=") && i+1 < len(args) {
				flags = append(flags, args[i+1])
				i++
			}
		} else {
			pos = append(pos, args[i])
		}
	}
	return append(flags, pos...)
}

func cmdCompanies() {
	var res struct {
		Current   string           `json:"current"`
		Companies []map[string]any `json:"companies"`
	}
	must(call("GET", "/companies", nil, &res))
	rows := [][]string{}
	for _, c := range res.Companies {
		mark := ""
		if str(c, "id") == res.Current {
			mark = "← using"
		}
		rows = append(rows, []string{str(c, "id"), str(c, "name"), fmt.Sprint(c["inbox"]), fmt.Sprint(c["running"]), mark})
	}
	table("ID\tNAME\tINBOX\tRUNNING\t\t", rows)
}

func cmdUse(args []string) {
	if len(args) != 1 {
		die(errors.New("usage: omilo use <company id>   (see `omilo companies`)"))
	}
	c := loadConfig()
	c.Company = args[0]
	if args[0] == "main" {
		c.Company = ""
	}
	var co map[string]any
	if err := call("POST", "/companies/switch", map[string]string{"id": args[0]}, &co); err != nil {
		die(err)
	}
	must(saveConfig(c))
	fmt.Println("now working on", str(co, "name"))
}

func cmdStaff() {
	var staff []map[string]any
	must(call("GET", "/staff", nil, &staff))
	rows := [][]string{}
	for _, s := range staff {
		eng, _ := s["engine"].(map[string]any)
		shifts, _ := s["shifts"].([]any)
		chief := ""
		if s["is_chief"] == true {
			chief = "chief"
		}
		rows = append(rows, []string{str(s, "id"), str(s, "name"), str(s, "status"), str(eng, "type"), fmt.Sprint(len(shifts)), chief})
	}
	table("ID\tNAME\tSTATUS\tENGINE\tSHIFTS\t", rows)
}

func cmdTasks(args []string) {
	fs := flag.NewFlagSet("tasks", flag.ExitOnError)
	staff := fs.String("staff", "", "only this staff agent")
	status := fs.String("status", "", "queued | running | done | failed")
	n := fs.Int("n", 20, "how many")
	_ = fs.Parse(args)
	q := fmt.Sprintf("?limit=%d", *n)
	if *staff != "" {
		q += "&staff_id=" + *staff
	}
	if *status != "" {
		q += "&status=" + *status
	}
	var tasks []map[string]any
	must(call("GET", "/tasks"+q, nil, &tasks))
	rows := [][]string{}
	for _, t := range tasks {
		res := str(t, "brief")
		if r, ok := t["report"].(map[string]any); ok {
			res = str(r, "headline")
		} else if e := str(t, "error"); e != "" {
			res = e
		}
		rows = append(rows, []string{str(t, "id"), str(t, "status"), str(t, "staff_id"), str(t, "origin"), short(res, 70)})
	}
	table("ID\tSTATUS\tSTAFF\tORIGIN\tRESULT", rows)
}

func cmdRun(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	note := fs.String("note", "", "extra instructions")
	_ = fs.Parse(reorder(args))
	if fs.NArg() < 2 {
		die(errors.New(`usage: omilo run <staff id> "what to do" [-note "..."]`))
	}
	var t map[string]any
	must(call("POST", "/tasks", map[string]string{"staff_id": fs.Arg(0), "brief": strings.Join(fs.Args()[1:], " "), "founder_note": *note}, &t))
	fmt.Println("started", str(t, "id"), "— follow it with `omilo show", str(t, "id")+"`")
}

func cmdChat(args []string) {
	if len(args) == 0 {
		die(errors.New(`usage: omilo chat "your message"`))
	}
	var th map[string]any
	must(call("POST", "/threads", map[string]string{"scope": "master"}, &th))
	id := str(th, "id")
	must(call("POST", "/threads/"+id+"/messages", map[string]string{"text": strings.Join(args, " ")}, &th))
	for i := 0; i < 300; i++ {
		time.Sleep(time.Second)
		must(call("GET", "/threads/"+id, nil, &th))
		if th["awaiting_reply"] == false {
			msgs, _ := th["messages"].([]any)
			last, _ := msgs[len(msgs)-1].(map[string]any)
			fmt.Println(str(last, "text"))
			return
		}
	}
	die(errors.New("no reply after 5 minutes; check the Chat page"))
}

func cmdImport(args []string) {
	if len(args) != 1 {
		die(errors.New("usage: omilo import <path to the v0 company-os folder>"))
	}
	root := args[0]
	files := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == ".demo" || d.Name() == "node_modules" || d.Name() == ".git" || d.Name() == "accounts") {
			return filepath.SkipDir
		}
		if d.IsDir() || !(strings.HasSuffix(p, ".json") || strings.HasSuffix(p, ".md")) {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		b, err := os.ReadFile(p)
		if err == nil {
			files[filepath.ToSlash(rel)] = string(b)
		}
		return nil
	})
	must(err)
	var out map[string]any
	must(call("POST", "/import/prototype", map[string]any{"files": files}, &out))
	keys := make([]string, 0, len(out))
	for k := range out {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("%s: %v\n", k, out[k])
	}
}

func cmdDoctor() {
	ok := true
	if _, err := exec.LookPath("docker"); err != nil {
		fmt.Println("✕ docker not found (needed for `omilo up`)")
		ok = false
	} else {
		fmt.Println("✓ docker found")
	}
	c := loadConfig()
	if r, err := http.Get(c.URL + "/healthz"); err == nil && r.StatusCode == 200 {
		fmt.Println("✓ gateway reachable at", c.URL)
	} else {
		fmt.Println("✕ gateway not reachable at", c.URL)
		ok = false
	}
	if c.Token == "" {
		fmt.Println("– not signed in (omilo login)")
	} else if err := call("GET", "/auth/me", nil, nil); err != nil {
		fmt.Println("✕ token rejected:", err)
		ok = false
	} else {
		fmt.Println("✓ signed in")
	}
	var h map[string]map[string]any
	if call("GET", "/health/engines", nil, &h) == nil {
		for k, v := range h {
			mark := "✓"
			if v["ok"] != true {
				mark, ok = "✕", false
			}
			fmt.Printf("%s engine for %s: %v\n", mark, k, v["detail"])
		}
	}
	if !ok {
		os.Exit(1)
	}
}

const usage = `omilo — run your company of AI staff agents

Run it
  up [-port 7700]        start Omilo (Docker) and open it in the browser
  down                   stop it          logs      follow the logs
  login [-url URL]       sign in from this terminal
  doctor                 check Docker, the gateway, your login and the engines

Work with it
  companies              your companies        use <id>  switch company
  status                 one-line overview
  inbox                  what needs you
  show <id>              a proposal or a task in full
  approve <id> [-note]   approve a proposal       reject <id> -note "why"
  changes <id> -note     ask the agent to revise  answer <question id> "text"
  staff                  your staff agents
  tasks [-staff id]      recent work
  run <staff> "brief"    give a staff agent a task [-note "..."]
  chat "message"         talk to the Chief of Staff
  pause | resume         stop or restart all agents
  import <folder>        import a v0 company-os prototype

  version
`

func main() {
	if len(os.Args) < 2 {
		fmt.Print(usage)
		return
	}
	cmd, args := os.Args[1], os.Args[2:]
	switch cmd {
	case "up":
		cmdUp(args)
	case "down":
		must(compose("down"))
	case "logs":
		must(compose("logs", "-f", "--tail", "200"))
	case "login":
		cmdLogin(args)
	case "doctor":
		cmdDoctor()
	case "status":
		cmdStatus()
	case "inbox":
		cmdInbox()
	case "show":
		if len(args) != 1 {
			die(errors.New("usage: omilo show <id>"))
		}
		cmdShow(args[0])
	case "approve", "reject", "changes":
		cmdDecide(cmd, args)
	case "answer":
		if len(args) < 2 {
			die(errors.New(`usage: omilo answer <question id> "your answer"`))
		}
		must(call("POST", "/inbox/"+args[0]+"/answer", map[string]string{"answer": strings.Join(args[1:], " ")}, nil))
		fmt.Println("answered; the agent gets a follow-up task")
	case "companies":
		cmdCompanies()
	case "use":
		cmdUse(args)
	case "staff":
		cmdStaff()
	case "tasks":
		cmdTasks(args)
	case "run":
		cmdRun(args)
	case "chat":
		cmdChat(args)
	case "pause", "resume":
		must(call("POST", "/system", map[string]bool{"paused": cmd == "pause"}, nil))
		fmt.Println(map[string]string{"pause": "paused: no new work starts", "resume": "resumed"}[cmd])
	case "import":
		cmdImport(args)
	case "version", "--version", "-v":
		fmt.Println("omilo", version)
	case "help", "--help", "-h":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", cmd, usage)
		os.Exit(2)
	}
}
