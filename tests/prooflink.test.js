// Proof as a link (#955): which links Log Hours and POST|PATCH /api/logs accept.
// School staff click these, so only https links to known file-sharing sites pass.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanProofLink, drivePreviewUrl } from '../server/proofLink.js'

test('accepts share links from the listed sites', () => {
  for (const link of [
    'https://drive.google.com/file/d/abc123/view?usp=sharing',
    'https://docs.google.com/document/d/abc/edit',
    'https://1drv.ms/i/s!AbC',
    'https://lincolnhs-my.sharepoint.com/:i:/g/personal/x',
    'https://www.dropbox.com/scl/fi/abc/sheet.jpg?dl=0',
    'https://www.icloud.com/photos/#abc',
    'https://app.box.com/s/abc',
  ]) {
    assert.ok(cleanProofLink(link).url, link)
  }
})

test('adds https:// when it was left off', () => {
  assert.equal(cleanProofLink('drive.google.com/file/d/abc/view').url, 'https://drive.google.com/file/d/abc/view')
})

test('empty means no link', () => {
  assert.deepEqual(cleanProofLink(''), { url: null })
  assert.deepEqual(cleanProofLink('   '), { url: null })
  assert.deepEqual(cleanProofLink(null), { url: null })
})

test('refuses other sites, look-alikes and non-https links', () => {
  for (const link of [
    'https://example.com/proof.jpg',
    'https://drive.google.com.evil.example/file',
    'https://evildrive.google.com.example/x',
    'https://notdropbox.com/x',
    'http://drive.google.com/file/d/abc',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@drive.google.com/x',
  ]) {
    assert.ok(cleanProofLink(link).error, link)
  }
})

test('refuses very long links', () => {
  assert.ok(cleanProofLink(`https://drive.google.com/${'a'.repeat(1000)}`).error)
})

test('Google Drive and Docs links get an in-app preview address', () => {
  assert.equal(drivePreviewUrl('https://drive.google.com/file/d/1AbC_dEf-GhIjKlMn/view?usp=sharing'), 'https://drive.google.com/file/d/1AbC_dEf-GhIjKlMn/preview')
  assert.equal(drivePreviewUrl('https://drive.google.com/file/u/0/d/1AbC_dEf-GhIjKlMn/view'), 'https://drive.google.com/file/d/1AbC_dEf-GhIjKlMn/preview')
  assert.equal(drivePreviewUrl('https://drive.google.com/open?id=1AbC_dEf-GhIjKlMn'), 'https://drive.google.com/file/d/1AbC_dEf-GhIjKlMn/preview')
  assert.equal(drivePreviewUrl('https://docs.google.com/document/d/1AbC_dEf-GhIjKlMn/edit'), 'https://docs.google.com/document/d/1AbC_dEf-GhIjKlMn/preview')
  assert.equal(drivePreviewUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf-GhIjKlMn/edit#gid=0'), 'https://docs.google.com/spreadsheets/d/1AbC_dEf-GhIjKlMn/preview')
})

test('other links have no in-app preview', () => {
  for (const link of [
    'https://www.dropbox.com/scl/fi/abc/sheet.jpg',
    'https://drive.google.com/drive/folders/1AbC_dEf-GhIjKlMn',
    'https://docs.google.com/forms/d/1AbC_dEf-GhIjKlMn/viewform',
    'https://drive.google.com/file/d/bad%22id/view',
    'https://example.com/file/d/1AbC_dEf-GhIjKlMn/view',
    '',
  ]) {
    assert.equal(drivePreviewUrl(link), null, link)
  }
})
