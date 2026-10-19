package main

import (
	"strings"
	"testing"
)

func TestStartBuildsLightEnv(t *testing.T) {
	cmd := startCommand("omilo-api", "/tmp/omilodata", "7700")

	// cmd.Path / cmd.Args[0] must end with omilo-api
	if !strings.HasSuffix(cmd.Path, "omilo-api") {
		t.Errorf("cmd.Path = %q; want suffix omilo-api", cmd.Path)
	}
	if len(cmd.Args) == 0 || !strings.HasSuffix(cmd.Args[0], "omilo-api") {
		t.Errorf("cmd.Args[0] = %q; want suffix omilo-api", cmd.Args[0])
	}

	// Build a map of env vars for easy lookup
	envMap := make(map[string]string)
	for _, e := range cmd.Env {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			envMap[parts[0]] = parts[1]
		}
	}

	// Assert required env vars
	checks := map[string]string{
		"OMILO_EMBEDDED_WORKER": "true",
		"OMILO_PORT":            "7700",
		"OMILO_DATA_DIR":        "/tmp/omilodata",
		"OMILO_PUBLIC_URL":      "http://localhost:7700",
	}
	for k, want := range checks {
		if got, ok := envMap[k]; !ok {
			t.Errorf("env missing %s", k)
		} else if got != want {
			t.Errorf("env %s = %q; want %q", k, got, want)
		}
	}

	// The app must resolve the DB itself: `start` must NOT pin OMILO_DATABASE_URL, otherwise a
	// migrated install would silently revert to SQLite (OS env beats .env in pydantic).
	if _, ok := envMap["OMILO_DATABASE_URL"]; ok {
		t.Errorf("env must NOT contain OMILO_DATABASE_URL; the app resolves it from <data_dir>/.env or the SQLite default")
	}

	// Structural: no env entry may mention docker or compose.
	if strings.Contains(cmd.Path, "docker") {
		t.Errorf("cmd.Path %q references docker; start should not call compose", cmd.Path)
	}
	for _, e := range cmd.Env {
		lower := strings.ToLower(e)
		if strings.Contains(lower, "docker") || strings.Contains(lower, "compose") {
			t.Errorf("env entry %q contains docker/compose; light-tier must not use Docker", e)
		}
	}
}
