.PHONY: help build run dev clean test fmt vet lint deps up down logs shell db-shell db-only rebuild docker deploy

BINARY_NAME=tobedone
BUILD_DIR=bin
MAIN_PATH=cmd/server/main.go

GREEN=\033[0;32m
NC=\033[0m

help: ## Показать справку
	@echo "Доступные команды:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}'

# ── Go ────────────────────────────────────────────────────────
build: ## Собрать бинарник в bin/
	@echo "$(GREEN)Сборка...$(NC)"
	@mkdir -p $(BUILD_DIR)
	@CGO_ENABLED=0 go build -o $(BUILD_DIR)/$(BINARY_NAME) $(MAIN_PATH)
	@echo "$(GREEN)✓ Готово: $(BUILD_DIR)/$(BINARY_NAME)$(NC)"

run: ## Запустить локально (требуется MariaDB на localhost:3306)
	@echo "$(GREEN)Запуск...$(NC)"
	@set -a; [ -f .env.local ] && . ./.env.local; set +a; go run $(MAIN_PATH)

clean: ## Очистить bin/
	@rm -rf $(BUILD_DIR)

test: ## Запустить тесты
	@go test -v ./...

fmt: ## go fmt
	@go fmt ./...

vet: ## go vet
	@go vet ./...

lint: fmt vet ## fmt + vet

deps: ## Установить зависимости
	@go mod download
	@go mod tidy

# ── Docker (локально) ─────────────────────────────────────────
COMPOSE_ENGINE ?= $(shell command -v podman-compose 2>/dev/null || command -v docker-compose 2>/dev/null || echo "docker compose")

up: ## Поднять весь стек (app + mariadb) в docker
	@$(COMPOSE_ENGINE) up -d
	@echo "$(GREEN)✓ http://localhost:8080$(NC)"

down: ## Остановить стек
	@$(COMPOSE_ENGINE) down

logs: ## Логи стека
	@$(COMPOSE_ENGINE) logs -f

shell: ## Shell внутри app-контейнера
	@$(COMPOSE_ENGINE) exec app /bin/sh

db-shell: ## MariaDB shell
	@$(COMPOSE_ENGINE) exec mariadb mariadb -u tobedone -ptobedone tobedone

db-only: ## Поднять только MariaDB (для debug-сборки локально через go run)
	@echo "$(GREEN)Запуск MariaDB...$(NC)"
	@$(COMPOSE_ENGINE) up -d mariadb
	@echo "$(GREEN)Ожидание готовности MariaDB...$(NC)"
	@sleep 3
	@echo "$(GREEN)✓ MariaDB на localhost:3306$(NC)"

dev: db-only run ## MariaDB в docker + go run (отладочная сборка)

rebuild: ## Пересобрать и поднять контейнеры
	@$(COMPOSE_ENGINE) up -d --build

# ── Container engine (для одиночного build) ───────────────────
CONTAINER_ENGINE ?= $(shell command -v podman 2>/dev/null || echo docker)
IMAGE_NAME=tobedone
IMAGE_TAG=latest

docker: ## Собрать образ
	@$(CONTAINER_ENGINE) build -t $(IMAGE_NAME):$(IMAGE_TAG) .

# ── Деплой (по образцу finforme) ──────────────────────────────
DEPLOY_HOST=firej@finfor.me
DEPLOY_PATH=/opt/tobedone

deploy: ## Задеплоить на сервер firej@finfor.me
	@echo "$(GREEN)Синхронизация исходников...$(NC)"
	@rsync -avz --exclude='.git' --exclude='bin' --exclude='design-preview-tbd.finfor.me' \
	             --exclude='*.db' --exclude='.idea' --exclude='.vscode' . $(DEPLOY_HOST):$(DEPLOY_PATH)/
	@echo "$(GREEN)Сборка образа на сервере...$(NC)"
	@ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && docker build -t tobedone:latest .'
	@echo "$(GREEN)Перезапуск контейнера...$(NC)"
	@ssh $(DEPLOY_HOST) 'cd /opt/traefik && docker compose up -d --force-recreate tobedone'
	@echo "$(GREEN)✓ Деплой завершён$(NC)"
