package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/zalando/go-keyring"
)

// SidecarInfo tells the frontend where the local sidecar listens and which
// session token to use. Exposed to the UI through Wails bindings.
type SidecarInfo struct {
	URL   string
	Token string
}

type readyLine struct {
	Event string `json:"event"`
	Port  int    `json:"port"`
	Pid   int    `json:"pid"`
}

type App struct {
	ctx  context.Context
	cmd  *exec.Cmd
	info SidecarInfo
}

func NewApp() *App {
	return &App{}
}

// startup launches the sidecar and waits for its ready line on stdout.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.startSidecar(); err != nil {
		fmt.Fprintf(os.Stderr, "sidecar failed to start: %v\n", err)
	}
}

func (a *App) startSidecar() error {
	root, err := resolveProjectRoot()
	if err != nil {
		return fmt.Errorf("locate project root: %w", err)
	}

	entry := filepath.Join(root, "sidecar", "dist", "index.js")
	if _, statErr := os.Stat(entry); statErr != nil {
		return fmt.Errorf("sidecar build missing at %s (run `pnpm build:sidecar` first)", entry)
	}

	token, err := randomToken()
	if err != nil {
		return err
	}

	cmd := exec.Command("node", entry)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "SIDCAR_TOKEN="+token)
	// Keep the sidecar out of the user's shell profile; python resolution is
	// driven by DEEPNOTE_PYTHON when set, else by the project venv discovery.
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn sidecar: %w", err)
	}
	a.cmd = cmd

	type result struct {
		line readyLine
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			var line readyLine
			if jsonErr := json.Unmarshal(scanner.Bytes(), &line); jsonErr == nil && line.Event == "ready" {
				ch <- result{line: line}
				return
			}
		}
		ch <- result{err: fmt.Errorf("sidecar exited before reporting ready")}
	}()

	select {
	case r := <-ch:
		if r.err != nil {
			return r.err
		}
		a.info = SidecarInfo{
			URL:   fmt.Sprintf("http://127.0.0.1:%d", r.line.Port),
			Token: token,
		}
		return nil
	case <-time.After(30 * time.Second):
		return fmt.Errorf("timed out waiting for sidecar ready line")
	case <-a.ctx.Done():
		return a.ctx.Err()
	}
}

// GetSidecarInfo is called by the frontend to discover the local sidecar.
func (a *App) GetSidecarInfo() SidecarInfo {
	return a.info
}

const keyringService = "deepnote-desktop"

// SetSecret stores an integration secret in the OS keychain (libsecret on
// Linux, Credential Manager on Windows, Keychain on macOS).
func (a *App) SetSecret(envVar string, value string) error {
	if value == "" {
		return keyring.Delete(keyringService, envVar)
	}
	return keyring.Set(keyringService, envVar, value)
}

// GetSecret reads a stored integration secret. Returns an empty string when
// the entry does not exist.
func (a *App) GetSecret(envVar string) (string, error) {
	secret, err := keyring.Get(keyringService, envVar)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", nil
	}
	return secret, err
}

// DeleteSecret removes an integration secret from the OS keychain.
func (a *App) DeleteSecret(envVar string) error {
	return keyring.Delete(keyringService, envVar)
}

// shutdown asks the sidecar to close orderly, then terminates it.
func (a *App) shutdown(ctx context.Context) {
	if a.info.URL != "" {
		url := fmt.Sprintf("%s/shutdown?token=%s", a.info.URL, a.info.Token)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
		if err == nil {
			client := &http.Client{Timeout: 3 * time.Second}
			if resp, doErr := client.Do(req); doErr == nil {
				_ = resp.Body.Close()
			}
		}
	}

	if a.cmd != nil && a.cmd.Process != nil {
		done := make(chan struct{})
		go func() {
			_, _ = a.cmd.Process.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			_ = a.cmd.Process.Kill()
		}
	}
}

func randomToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// resolveProjectRoot finds the repository root that holds sidecar/dist.
// Order: DND_ROOT env, working directory, directory of the executable.
func resolveProjectRoot() (string, error) {
	var candidates []string
	if env := os.Getenv("DND_ROOT"); env != "" {
		candidates = append(candidates, env)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, wd)
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Dir(exe))
		if resolved, symErr := filepath.EvalSymlinks(exe); symErr == nil {
			candidates = append(candidates, filepath.Dir(resolved))
		}
	}

	for _, candidate := range candidates {
		marker := filepath.Join(candidate, "sidecar", "dist", "index.js")
		if _, err := os.Stat(marker); err == nil {
			return candidate, nil
		}
		// Installed layout: binary next to a sidecar/ directory.
		nested := filepath.Join(candidate, "..", "sidecar", "dist", "index.js")
		if _, err := os.Stat(nested); err == nil {
			return filepath.Clean(filepath.Join(candidate, "..")), nil
		}
	}
	return "", fmt.Errorf("sidecar/dist not found from %v (set DND_ROOT)", candidates)
}

// keep runtime import used on all platforms (windows process handling lands in phase 6)
var _ = runtime.GOOS
