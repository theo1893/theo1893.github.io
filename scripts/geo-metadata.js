'use strict'

const {
  stripHTML,
  unescapeHTML
} = require('hexo-util')

const jsonLdPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi

function compactText (value) {
  if (!value) return ''

  return unescapeHTML(stripHTML(String(value)))
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeAttribute (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function pageDescription (page, config) {
  const title = compactText(page.title)
  let description = compactText(
    page.description || page.excerpt || page.content || config.description
  )

  if (title && description.startsWith(title)) {
    description = description.slice(title.length).trim()
  }

  return (description || compactText(config.description)).slice(0, 200)
}

function taxonomyNames (taxonomy) {
  if (!taxonomy) return []

  let items
  if (typeof taxonomy.toArray === 'function') {
    items = taxonomy.toArray()
  } else if (Array.isArray(taxonomy)) {
    items = taxonomy
  } else {
    items = [taxonomy]
  }

  return items
    .map(item => compactText(item && item.name ? item.name : item))
    .filter(Boolean)
}

function toIsoString (value) {
  if (!value) return undefined

  const date = new Date(value.valueOf ? value.valueOf() : value)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function absoluteUrl (value, baseUrl) {
  if (!value || String(value).startsWith('data:')) return undefined

  try {
    return new URL(String(value), baseUrl).href
  } catch {
    return undefined
  }
}

function articleImages (page, canonicalUrl) {
  const candidates = []

  if (typeof page.cover === 'string') candidates.push(page.cover)
  if (Array.isArray(page.photos)) candidates.push(...page.photos)

  const content = String(page.content || '')
  const imagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  let match
  while ((match = imagePattern.exec(content)) !== null && candidates.length < 3) {
    candidates.push(match[1])
  }

  return [...new Set(
    candidates
      .map(candidate => absoluteUrl(candidate, canonicalUrl))
      .filter(Boolean)
  )]
}

function authorEntity (config, siteUrl) {
  const geoConfig = config.geo || {}
  const authorUrl = absoluteUrl(geoConfig.author_url, siteUrl) || siteUrl
  const sameAs = (Array.isArray(geoConfig.same_as) ? geoConfig.same_as : [])
    .map(url => absoluteUrl(url, siteUrl))
    .filter(Boolean)

  const author = {
    '@type': 'Person',
    '@id': `${siteUrl}#person`,
    name: config.author,
    url: authorUrl
  }

  if (sameAs.length) author.sameAs = sameAs
  return author
}

function createJsonLd (page, config, canonicalUrl, description) {
  const siteUrl = new URL(config.root || '/', `${config.url}/`).href
  const language = page.lang || page.language || config.language
  const author = authorEntity(config, siteUrl)
  const websiteId = `${siteUrl}#website`
  const isPost = page.__post || page.layout === 'post'
  const isHome = page.__index && (!page.current || page.current === 1)

  if (isPost) {
    const images = articleImages(page, canonicalUrl)
    const categories = taxonomyNames(page.categories)
    const tags = taxonomyNames(page.tags)
    const article = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      '@id': `${canonicalUrl}#article`,
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': canonicalUrl
      },
      isPartOf: {
        '@id': websiteId
      },
      headline: compactText(page.title),
      description,
      url: canonicalUrl,
      datePublished: toIsoString(page.date),
      author,
      publisher: {
        '@id': author['@id']
      },
      inLanguage: language,
      isAccessibleForFree: true
    }

    const dateModified = toIsoString(page.updated)
    if (dateModified) article.dateModified = dateModified
    if (images.length) article.image = images
    if (categories.length) article.articleSection = categories
    if (tags.length) article.keywords = tags

    return article
  }

  if (isHome) {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': websiteId,
          name: config.title,
          description: compactText(config.description),
          url: siteUrl,
          inLanguage: language,
          publisher: {
            '@id': author['@id']
          }
        },
        author
      ]
    }
  }

  const isCollection = page.archive || page.tag || page.category
  return {
    '@context': 'https://schema.org',
    '@type': isCollection ? 'CollectionPage' : 'WebPage',
    '@id': `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: compactText(page.title || config.title),
    description,
    isPartOf: {
      '@id': websiteId
    },
    inLanguage: language
  }
}

function replaceMeta (html, attribute, name, content) {
  const pattern = new RegExp(`<meta\\s+${attribute}=["']${name}["'][^>]*>`, 'i')
  const tag = `<meta ${attribute}="${name}" content="${escapeAttribute(content)}">`

  if (pattern.test(html)) return html.replace(pattern, tag)
  return html.replace('</head>', `${tag}</head>`)
}

function canonicalUrlFromHtml (html, page, config) {
  const match = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["'][^>]*>/i)
  if (match) return unescapeHTML(match[1])

  return absoluteUrl(page.path || '/', `${config.url}/`) || config.url
}

hexo.extend.filter.register('after_render:html', (html, locals) => {
  if (typeof html !== 'string' || !locals || !locals.page) return html

  const { page } = locals
  const { config } = hexo
  const description = pageDescription(page, config)
  const canonicalUrl = canonicalUrlFromHtml(html, page, config)

  html = replaceMeta(html, 'name', 'description', description)
  html = replaceMeta(html, 'property', 'og:description', description)
  html = replaceMeta(html, 'property', 'og:url', canonicalUrl)

  const jsonLd = JSON.stringify(
    createJsonLd(page, config, canonicalUrl, description)
  ).replace(/</g, '\\u003c')
  const jsonLdTag = `<script type="application/ld+json">${jsonLd}</script>`

  return html.replace(
    /(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i,
    (full, open, head, close) => {
      return `${open}${head.replace(jsonLdPattern, '')}${jsonLdTag}${close}`
    }
  )
})
