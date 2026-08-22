import { useEffect } from 'react'

// Falls back to a safe localhost origin when VITE_SITE_URL is unset — see
// vite.config.js / scripts/site-url.mjs, which guarantee this is always
// populated at build time. Set the real production domain as a Netlify
// dashboard env var once it's known (see DEPLOYMENT.md).
const SITE_URL = import.meta.env.VITE_SITE_URL
const DEFAULT_TITLE = 'VolunTrack · Volunteer Hour Tracker'
const DEFAULT_DESCRIPTION = 'VolunTrack is a calm volunteer hour tracker. Log hours, set goals, earn badges, and generate reports for school or community service.'
const DEFAULT_CANONICAL_URL = `${SITE_URL}/`

function setMetaTag(attr, key, content) {
  let el = document.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonicalLink(href) {
  let el = document.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

const JSON_LD_ATTR = 'data-seo-jsonld'

// Route-specific structured data lives in a script tag tagged with
// data-seo-jsonld so it can be swapped/removed on unmount without touching
// the static SoftwareApplication block in index.html.
function setJsonLd(data) {
  let el = document.querySelector(`script[${JSON_LD_ATTR}]`)
  if (!data) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.setAttribute(JSON_LD_ATTR, 'true')
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

/**
 * Sets document title, meta description, OG/Twitter tags, and canonical link
 * for the current route. Pass canonicalPath to point at a different URL
 * (e.g. duplicate-content pages that should canonicalize to the primary one).
 * Pass jsonLd (a schema.org object, or an array for multiple schemas) to
 * inject page-specific structured data — e.g. FAQPage, AggregateRating.
 */
export function useSeo({ title, description, path, canonicalPath, jsonLd } = {}) {
  useEffect(() => {
    const fullTitle = title ? `${title} · VolunTrack` : DEFAULT_TITLE
    const desc = description || DEFAULT_DESCRIPTION
    const canonicalUrl = `${SITE_URL}${canonicalPath ?? path ?? window.location.pathname}`

    document.title = fullTitle
    setMetaTag('name', 'description', desc)
    setMetaTag('property', 'og:title', fullTitle)
    setMetaTag('property', 'og:description', desc)
    setMetaTag('property', 'og:url', canonicalUrl)
    setMetaTag('name', 'twitter:title', fullTitle)
    setMetaTag('name', 'twitter:description', desc)
    setCanonicalLink(canonicalUrl)
    setJsonLd(jsonLd)

    return () => {
      document.title = DEFAULT_TITLE
      setMetaTag('name', 'description', DEFAULT_DESCRIPTION)
      setMetaTag('property', 'og:title', DEFAULT_TITLE)
      setMetaTag('property', 'og:description', DEFAULT_DESCRIPTION)
      setMetaTag('property', 'og:url', DEFAULT_CANONICAL_URL)
      setMetaTag('name', 'twitter:title', DEFAULT_TITLE)
      setMetaTag('name', 'twitter:description', DEFAULT_DESCRIPTION)
      setCanonicalLink(DEFAULT_CANONICAL_URL)
      setJsonLd(null)
    }
  }, [title, description, path, canonicalPath, jsonLd])
}
