#!/usr/bin/env node
// Copies the built SDK bundles from ../sdk/dist into docs/public/sdk/ so
// VitePress serves them as static assets at:
//   /sdk/latest.js   — alias to current build, never cache long
//   /sdk/v{major}.js — alias to latest in this major
//   /sdk/v{exact}.js — pinned exact version, safe to cache forever
//
// Run automatically before `vitepress build`. Also creates a stub when the SDK
// hasn't been built yet so `vitepress build` doesn't 404 on the public folder.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const docsRoot = resolve(here, '..')
const sdkRoot = resolve(docsRoot, '../sdk')
const sdkDist = resolve(sdkRoot, 'dist')
const publicSdk = resolve(docsRoot, 'docs/public/sdk')

mkdirSync(publicSdk, { recursive: true })

const sdkPkg = JSON.parse(readFileSync(resolve(sdkRoot, 'package.json'), 'utf8'))
const version = sdkPkg.version
const major = `v${version.split('.')[0]}`
const exact = `v${version}`

const iife = resolve(sdkDist, 'bridle.js')
const esm = resolve(sdkDist, 'bridle.mjs')
const iifeMap = resolve(sdkDist, 'bridle.js.map')
const esmMap = resolve(sdkDist, 'bridle.mjs.map')

if (!existsSync(iife)) {
  console.warn(
    `[copy-sdk] ${iife} not found — writing a stub so VitePress build can proceed.\n` +
      `           Run \`npm run build:sdk\` first for a real bundle.`,
  )
  const stub =
    `/* Bridle SDK stub — real bundle missing.\n` +
    `   Run: cd bridle/sdk && npm install && npm run build\n` +
    `   Then: cd bridle/docs && node scripts/copy-sdk.mjs\n` +
    `*/\n` +
    `console.error('[bridle] SDK bundle is a stub — rebuild before deploying.')\n`
  writeFileSync(resolve(publicSdk, 'latest.js'), stub)
  writeFileSync(resolve(publicSdk, `${major}.js`), stub)
  writeFileSync(resolve(publicSdk, `${exact}.js`), stub)
  process.exit(0)
}

const targets = [
  ['latest.js', iife],
  [`${major}.js`, iife],
  [`${exact}.js`, iife],
  ['latest.mjs', esm],
  [`${major}.mjs`, esm],
  [`${exact}.mjs`, esm],
]

for (const [outName, src] of targets) {
  if (!existsSync(src)) continue
  copyFileSync(src, resolve(publicSdk, outName))
}

if (existsSync(iifeMap)) copyFileSync(iifeMap, resolve(publicSdk, `${exact}.js.map`))
if (existsSync(esmMap)) copyFileSync(esmMap, resolve(publicSdk, `${exact}.mjs.map`))

console.log(`[copy-sdk] Copied SDK ${version} → docs/public/sdk/`)
console.log(`           latest.js, ${major}.js, ${exact}.js (+ .mjs)`)
