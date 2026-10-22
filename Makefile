.PHONY: dev test lint typecheck build contracts

# The web app is served on port 5173. The API on port 8000 starts once it exists.
dev:
	@set -e; \
	if [ -f services/api/src/api/main.py ]; then \
		env_args=""; \
		if [ -f .env ]; then env_args="--env-file .env"; fi; \
		uv run --package api uvicorn api.main:app --host 127.0.0.1 --port 8000 $$env_args & \
		api_pid=$$!; \
		trap 'kill $$api_pid 2>/dev/null' EXIT INT TERM; \
	fi; \
	npm --prefix apps/web run dev

test:
	uv run pytest
	npm --prefix apps/web test
	npm --prefix apps/web run typecheck
	npm --prefix apps/web run lint

lint:
	uv run ruff check services packages
	npm --prefix apps/web run lint

typecheck:
	npm --prefix apps/web run typecheck

build:
	npm --prefix apps/web run build

contracts:
	node packages/contracts/generate.mjs
