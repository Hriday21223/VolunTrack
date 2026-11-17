// SharePoint storage (#924): which site addresses and tenant ids are accepted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSiteUrl, validTenantId } from '../server/storage/graph.js'

test('accepts a SharePoint site address', () => {
  assert.deepEqual(parseSiteUrl('https://lincolnhs.sharepoint.com/sites/Volunteering'), { host: 'lincolnhs.sharepoint.com', path: '/sites/Volunteering' })
  assert.deepEqual(parseSiteUrl('https://district.sharepoint.us/teams/Service/'), { host: 'district.sharepoint.us', path: '/teams/Service' })
})

test('refuses anything that is not a SharePoint site', () => {
  for (const bad of ['http://x.sharepoint.com/sites/a', 'https://evil.com/sites/a', 'https://x.sharepoint.com.evil.com/sites/a', 'https://x.sharepoint.com/', 'https://x.sharepoint.com/sites/a/b', 'not a url', 'https://127.0.0.1/sites/a']) {
    assert.equal(parseSiteUrl(bad), null, bad)
  }
})

test('tenant ids are GUIDs', () => {
  assert.equal(validTenantId('72f988bf-86f1-41af-91ab-2d7cd011db47'), true)
  assert.equal(validTenantId('common'), false)
  assert.equal(validTenantId('72f988bf-86f1-41af-91ab-2d7cd011db4'), false)
})
