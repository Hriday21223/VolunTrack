import { useEffect } from 'react'

// TODO: replace with your real production domain once it's finalized.
const SITE_URL = 'https://voluntrack.example.com'
const DEFAULT_TITLE = 'VolunTrack · Volunteer Hour Tracker'
const DEFAULT_DESCRIPTION = 'VolunTrack is a calm volunteer hour tracker. Log hours, set goals, earn badges, and generate reports for school or community service.'

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

/**
 * Sets document title, meta description, OG/Twitter tags, and canonical link
 * for the current route. Pass canonicalPath to point at a different URL
 * (e.g. duplicate-content pages that should canonicalize to the primary one).
 */
export function useSeo({ title, description, path, canonicalPath } = {}) {
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

    return () => {
      document.title = DEFAULT_TITLE
    }
  }, [title, description, path, canonicalPath])
}
