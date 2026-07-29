'use strict'

/**
 * Butterfly 5.5.3 still renders the Busuanzi 2.x element IDs and an async
 * loader. Rewrite those fragments at build time so the blog can use the
 * Busuanzi 3.x API without maintaining a fork of the theme submodule.
 */

const idReplacements = {
  busuanzi_value_site_uv: 'busuanzi_site_uv',
  busuanzi_value_site_pv: 'busuanzi_site_pv',
  busuanzi_value_page_pv: 'busuanzi_page_pv'
}

const busuanziV3ScriptPattern =
  /<script async data-pjax src="(https:\/\/cdn\.busuanzi\.cc\/busuanzi\/[\d.]+\/busuanzi(?:\.abbr)?\.min\.js)"><\/script>/g

const pjaxResetScript =
  '<script>document.addEventListener("pjax:send",()=>{window.busuanziRequestSent=false})</script>'

hexo.extend.filter.register('after_render:html', html => {
  if (typeof html !== 'string') return html

  for (const [legacyId, currentId] of Object.entries(idReplacements)) {
    html = html.replaceAll(`id="${legacyId}"`, `id="${currentId}"`)
  }

  return html.replace(
    busuanziV3ScriptPattern,
    `${pjaxResetScript}<script defer data-pjax src="$1"></script>`
  )
})
