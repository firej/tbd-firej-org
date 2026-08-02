package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	// Пояса юзеров (/tz) без tzdata в контейнере
	_ "time/tzdata"

	"github.com/evbogdanov/tobedone/internal/bot"
)

func main() {
	cfg, err := bot.Load()
	if err != nil {
		log.Fatal("config: ", err)
	}
	store, err := bot.OpenStore(cfg.DBPath)
	if err != nil {
		log.Fatal("store: ", err)
	}
	defer store.Close()

	app, err := bot.New(cfg, store)
	if err != nil {
		log.Fatal("bot: ", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	app.Run(ctx)
	log.Println("bot: stopped")
}
