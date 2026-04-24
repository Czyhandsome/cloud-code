BINARY_NAME  := claude2
VERSION      := $(shell node -e "console.log(require('./claude-code-source/package.json').version)" 2>/dev/null || grep '"version"' claude-code-source/package.json | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
INSTALL_DIR  := $(HOME)/.local/share/$(BINARY_NAME)/versions
BIN_DIR      := $(HOME)/.local/bin
SOURCE_DIR   := claude-code-source
DIST_JS      := $(SOURCE_DIR)/dist/cli.js
VERSIONED    := $(INSTALL_DIR)/$(VERSION)

.PHONY: build install clean

build: $(DIST_JS)
	bun build --compile --external sharp \
		--outfile /tmp/$(BINARY_NAME)-$(VERSION) \
		$(DIST_JS)

$(DIST_JS):
	cd $(SOURCE_DIR) && bun run build

install: build
	mkdir -p $(INSTALL_DIR)
	cp /tmp/$(BINARY_NAME)-$(VERSION) $(VERSIONED)
	chmod +x $(VERSIONED)
	ln -sf $(VERSIONED) $(BIN_DIR)/$(BINARY_NAME)
	@echo "Installed $(BINARY_NAME) $(VERSION) → $(BIN_DIR)/$(BINARY_NAME)"

clean:
	rm -f /tmp/$(BINARY_NAME)-*
