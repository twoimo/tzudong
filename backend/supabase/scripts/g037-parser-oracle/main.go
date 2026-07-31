package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/supabase/cli/pkg/parser"
)

func main() {
	var (
		input []byte
		err   error
	)

	switch len(os.Args) {
	case 1:
		input, err = io.ReadAll(os.Stdin)
	case 2:
		input, err = os.ReadFile(os.Args[1])
	default:
		err = fmt.Errorf("usage: %s [sql-file]", os.Args[0])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	statements, err := parser.SplitAndTrim(bytes.NewReader(input))
	if err == nil {
		err = json.NewEncoder(os.Stdout).Encode(statements)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
