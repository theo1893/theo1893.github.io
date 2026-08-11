'use strict'

const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const publicDir = path.join(rootDir, 'public')
const failures = []

function fail (message) {
  failures.push(message)
}

function read (filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function walk (directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(entryPath) : [entryPath]
  })
}

function jsonLdObjects (html, relativePath) {
  const objects = []
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match

  while ((match = pattern.exec(html)) !== null) {
    if (!match[1].trim()) {
      fail(`${relativePath}: empty JSON-LD block`)
      continue
    }

    try {
      objects.push(JSON.parse(match[1]))
    } catch (error) {
      fail(`${relativePath}: invalid JSON-LD (${error.message})`)
    }
  }

  return objects
}

function objectHasType (object, type) {
  if (!object || typeof object !== 'object') return false
  if (object['@type'] === type) return true
  return Array.isArray(object['@graph']) && object['@graph'].some(item => item['@type'] === type)
}

for (const requiredFile of ['robots.txt', 'sitemap.xml', 'atom.xml', 'index.html']) {
  if (!fs.existsSync(path.join(publicDir, requiredFile))) {
    fail(`missing public/${requiredFile}`)
  }
}

let sitemap = ''
if (fs.existsSync(path.join(publicDir, 'sitemap.xml'))) {
  sitemap = read(path.join(publicDir, 'sitemap.xml'))
}

if (fs.existsSync(path.join(publicDir, 'robots.txt'))) {
  const robots = read(path.join(publicDir, 'robots.txt'))
  for (const directive of [
    'User-agent: OAI-SearchBot',
    'User-agent: PerplexityBot',
    'Sitemap: https://theo1893.github.io/sitemap.xml'
  ]) {
    if (!robots.includes(directive)) fail(`robots.txt: missing ${directive}`)
  }
}

let articleCount = 0
let htmlCount = 0

if (fs.existsSync(publicDir)) {
  for (const filePath of walk(publicDir).filter(file => file.endsWith('.html'))) {
    htmlCount += 1
    const relativePath = path.relative(publicDir, filePath)
    const html = read(filePath)
    const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["'][^>]*>/i)
    const ogUrl = html.match(/<meta\s+property=["']og:url["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    const description = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    const objects = jsonLdObjects(html, relativePath)

    if (!canonical) {
      fail(`${relativePath}: missing canonical URL`)
      continue
    }

    if (canonical[1].endsWith('/index.html')) {
      fail(`${relativePath}: canonical URL contains index.html`)
    }
    if (!ogUrl || ogUrl[1] !== canonical[1]) {
      fail(`${relativePath}: og:url does not match canonical URL`)
    }
    if (!description || !description[1] || description[1].includes('This is nil.')) {
      fail(`${relativePath}: missing or placeholder meta description`)
    }
    if (!objects.length) {
      fail(`${relativePath}: missing JSON-LD`)
    }

    const article = objects.find(object => objectHasType(object, 'BlogPosting'))
    if (article) {
      articleCount += 1
      if (article.url !== canonical[1]) {
        fail(`${relativePath}: BlogPosting URL does not match canonical URL`)
      }
      if (!article.mainEntityOfPage || article.mainEntityOfPage['@id'] !== canonical[1]) {
        fail(`${relativePath}: BlogPosting mainEntityOfPage is inconsistent`)
      }
      if (sitemap && !sitemap.includes(`<loc>${canonical[1]}</loc>`)) {
        fail(`${relativePath}: canonical URL is absent from sitemap.xml`)
      }
    }
  }
}

if (!articleCount) fail('no BlogPosting pages were found')

if (failures.length) {
  console.error(`GEO checks failed (${failures.length}):`)
  failures.forEach(message => console.error(`- ${message}`))
  process.exitCode = 1
} else {
  console.log(`GEO checks passed: ${htmlCount} HTML pages, ${articleCount} articles`)
}
