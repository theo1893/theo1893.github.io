'use strict'

function escapeXml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function absoluteUrl (value, baseUrl) {
  if (!value || String(value).startsWith('data:')) return undefined

  try {
    return new URL(String(value), baseUrl).href
  } catch {
    return undefined
  }
}

function postImages (post, postUrl) {
  const images = []
  const imagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  const content = String(post.content || '')
  let match

  while ((match = imagePattern.exec(content)) !== null && images.length < 1000) {
    const imageUrl = absoluteUrl(match[1], postUrl)
    if (imageUrl) images.push(imageUrl)
  }

  return [...new Set(images)]
}

hexo.extend.generator.register('image-sitemap', locals => {
  const siteUrl = new URL(hexo.config.root || '/', `${hexo.config.url}/`).href
  const entries = locals.posts.toArray().map(post => {
    const postUrl = absoluteUrl(post.path, siteUrl)
    if (!postUrl) return undefined

    const images = postImages(post, postUrl)
    if (!images.length) return undefined

    const imageElements = images
      .map(image => `    <image:image><image:loc>${escapeXml(image)}</image:loc></image:image>`)
      .join('\n')

    return [
      '  <url>',
      `    <loc>${escapeXml(postUrl)}</loc>`,
      imageElements,
      '  </url>'
    ].join('\n')
  }).filter(Boolean)

  const data = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...entries,
    '</urlset>',
    ''
  ].join('\n')

  return {
    path: 'image-sitemap.xml',
    data
  }
})
