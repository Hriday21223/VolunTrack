// Browser translation (Chrome, Safari, Edge "Translate this page") swaps the
// page's text nodes for its own, behind React's back. When React later
// removes or moves one of those nodes it finds a different parent and throws
// ("Failed to execute 'removeChild' on 'Node'"), which blanks the screen.
// These two patches make that case a no-op instead of a crash, so people can
// use their browser's translate for any language we don't ship (#720).
// Known React issue: github.com/facebook/react/issues/11538.
export function installTranslateGuard() {
  if (typeof Node !== 'function' || !Node.prototype || Node.prototype.__vtTranslateGuard) return
  const removeChild = Node.prototype.removeChild
  Node.prototype.removeChild = function guardedRemoveChild(child) {
    if (child && child.parentNode !== this) return child
    return removeChild.call(this, child)
  }
  const insertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function guardedInsertBefore(newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) return newNode
    return insertBefore.call(this, newNode, referenceNode)
  }
  Node.prototype.__vtTranslateGuard = true
}
