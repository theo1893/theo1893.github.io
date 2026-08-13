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
  const objectTypes = Array.isArray(object['@type']) ? object['@type'] : [object['@type']]
  return objectTypes.includes(type)
}

function findObjectByType (objects, type) {
  for (const object of objects) {
    if (objectHasType(object, type)) return object

    if (object && Array.isArray(object['@graph'])) {
      const match = findObjectByType(object['@graph'], type)
      if (match) return match
    }
  }

  return undefined
}

function escapeXml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

for (const requiredFile of ['robots.txt', 'sitemap.xml', 'image-sitemap.xml', 'atom.xml', 'index.html']) {
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
    'Sitemap: https://theo1893.github.io/sitemap.xml',
    'Sitemap: https://theo1893.github.io/image-sitemap.xml'
  ]) {
    if (!robots.includes(directive)) fail(`robots.txt: missing ${directive}`)
  }
}

let imageSitemap = ''
if (fs.existsSync(path.join(publicDir, 'image-sitemap.xml'))) {
  imageSitemap = read(path.join(publicDir, 'image-sitemap.xml'))

  if (!imageSitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')) {
    fail('image-sitemap.xml: missing Google image namespace')
  }
  if (!imageSitemap.includes('<image:loc>')) {
    fail('image-sitemap.xml: no images were found')
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
    if (description && /\d{20,}/.test(description[1])) {
      fail(`${relativePath}: meta description appears to contain code line numbers`)
    }
    if (!objects.length) {
      fail(`${relativePath}: missing JSON-LD`)
    }

    const article = findObjectByType(objects, 'BlogPosting')
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

      const breadcrumb = findObjectByType(objects, 'BreadcrumbList')
      if (!breadcrumb || !Array.isArray(breadcrumb.itemListElement)) {
        fail(`${relativePath}: missing BreadcrumbList JSON-LD`)
      } else {
        const lastItem = breadcrumb.itemListElement.at(-1)
        if (breadcrumb.itemListElement.length < 2 || !lastItem || lastItem.item !== canonical[1]) {
          fail(`${relativePath}: BreadcrumbList does not end at the canonical URL`)
        }
      }

      const images = Array.isArray(article.image) ? article.image : []
      for (const image of images) {
        if (imageSitemap && !imageSitemap.includes(`<image:loc>${escapeXml(image)}</image:loc>`)) {
          fail(`${relativePath}: article image is absent from image-sitemap.xml`)
        }
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
