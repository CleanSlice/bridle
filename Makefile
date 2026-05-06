.PHONY: install dev hub app clean

install:
	cd nestjs && bun install
	cd nuxt && bun install

dev: hub app

hub:
	cd nestjs && bun --watch main.ts &

app:
	cd nuxt && bun run nuxi dev &

clean:
	rm -rf nestjs/node_modules nuxt/node_modules nestjs/dist nuxt/.nuxt
