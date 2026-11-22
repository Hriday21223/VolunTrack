// Inbox draft replies (#757, #984): every language the app offers has every
// sentence, and incoming messages are recognised in each of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAFT_LANGUAGES, detectLanguage, generateDraft } from '../src/lib/inboxDraft.js'
import { DRAFTS_MORE, TOPICS_MORE } from '../src/lib/inboxDraftMore.js'

const KEYS = ['greet', 'greetNoName', 'signoff', 'costSeveral', 'costOne', 'several', 'featuresClub', 'featuresSchool', 'features', 'askQuote', 'askSetup', 'askSchools', 'askClubName', 'askSchoolName', 'askStudents', 'askRole', 'codeOrg', 'codeSchool', 'freeClub', 'general', 'bug', 'feature']

test('drafts cover all 11 app languages', () => {
  assert.deepEqual(Object.keys(DRAFT_LANGUAGES).sort(), ['ar', 'bn', 'en', 'es', 'fr', 'hi', 'ja', 'pt', 'ru', 'vi', 'zh'])
})

test('every added language has every sentence and topic', () => {
  for (const [lang, d] of Object.entries(DRAFTS_MORE)) {
    for (const k of KEYS) assert.ok(d[k], `${lang} is missing ${k}`)
    assert.ok(d.greet.includes('{name}'), `${lang} greet has no {name}`)
    assert.ok(d.codeOrg.includes('{site}') && d.codeSchool.includes('{site}'), `${lang} code lines need {site}`)
    assert.equal(Object.keys(TOPICS_MORE[lang]).length, 4, `${lang} topics`)
  }
})

test('detects the language a message is written in', () => {
  const cases = {
    en: 'Hi, how much does it cost for our school?',
    es: 'Hola, ¿cuánto cuesta para nuestra escuela?',
    pt: 'Olá, quanto custa para nossa escola? Temos alunos',
    fr: 'Bonjour, combien coûte VolunTrack pour notre école ? Nous avons des élèves',
    ru: 'Здравствуйте, сколько стоит?',
    ja: 'こんにちは、料金はいくらですか',
    zh: '你好，多少钱？',
    ar: 'مرحبا، كم السعر؟',
    hi: 'नमस्ते, कीमत क्या है?',
    bn: 'নমস্কার, দাম কত?',
  }
  for (const [want, text] of Object.entries(cases)) assert.equal(detectLanguage(text), want, text)
})

test('a French partnership question gets a French reply with the price answer', () => {
  const d = generateDraft({ name: 'Ana', subject: 'School or organization partnership', message: 'Bonjour, combien coûte VolunTrack pour notre école ? Nous avons des élèves', language: null }, 'https://example.org')
  assert.match(d, /^Bonjour Ana/)
  assert.match(d, /Côté prix/)
  assert.match(d, /https:\/\/example\.org\/for-schools/)
})
