[conceptual reconstruction — not the user's literal words]

Could you write a `make install` in the root dir of the repo so we can install claude2 directly near the real `claude` binary?

Context: We had just packaged claude-code-source/dist/cli.js into a standalone binary using `bun build --compile --external sharp` and manually installed it to ~/.local/share/claude2/versions/2.1.88 with a symlink at ~/.local/bin/claude2. The request was to encode this process into a root-level Makefile so it can be reproduced with a single `make install`.
