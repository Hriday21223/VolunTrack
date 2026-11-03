// One-page volunteer résumé (#656), made on the device from the student's own
// entries: totals, the places they gave the most time to, top skills, badges
// earned and (when there are any) written references. Rejected hours never
// count; approved hours are shown separately so a reader knows what was
// confirmed.
import jsPDF from 'jspdf'
import { countedLogs, BADGES } from '@/lib/achievements.js'
import { hoursBySkill } from '@/lib/skills.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10
const monthYear = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '')

/** Places with hours, first and last date, most hours first. */
export function placesFrom(logs) {
  const map = new Map()
  for (const l of logs) {
    const name = String(l.orgName || l.location || l.activity || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const p = map.get(key) || { name, hours: 0, first: l.date, last: l.date, activities: new Set() }
    p.hours += Number(l.hours) || 0
    if (l.date < p.first) p.first = l.date
    if (l.date > p.last) p.last = l.date
    if (l.activity) p.activities.add(String(l.activity).trim())
    map.set(key, p)
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours)
}

async function writtenReferences() {
  const token = localStorage.getItem('voluntrack:auth_token')
  if (!token) return []
  try {
    const res = await fetch(`${apiUrl}/references/mine`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return []
    const d = await res.json()
    return (d.references || []).filter((r) => r.status === 'written' && r.text)
  } catch { return [] }
}

/** Builds and downloads the PDF. Returns false if there is nothing to show. */
export async function downloadResume({ user, logs, earned = [] }) {
  const counted = countedLogs(logs)
  if (counted.length === 0) return false
  const total = counted.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const approved = counted.filter((l) => l.verificationStatus === 'approved').reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const dates = counted.map((l) => l.date).filter(Boolean).sort()
  const places = placesFrom(counted).slice(0, 6)
  const skills = hoursBySkill(counted).sort((a, b) => b.hours - a.hours).slice(0, 8)
  const badges = BADGES.filter((b) => earned.includes(b.id)).map((b) => b.title).slice(0, 8)
  const refs = (await writtenReferences()).slice(0, 2)

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 50
  let y = 60
  const room = (need) => y + need < H - 50
  const heading = (t) => {
    y += 8
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(39, 84, 45).text(t.toUpperCase(), M, y)
    doc.setDrawColor(63, 131, 68).setLineWidth(0.8).line(M, y + 4, W - M, y + 4)
    y += 20
  }
  const para = (t, size = 10, color = [40, 40, 40]) => {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...color)
    const lines = doc.splitTextToSize(t, W - 2 * M)
    doc.text(lines, M, y)
    y += lines.length * (size + 3)
  }

  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(20, 20, 20).text(user?.name || 'Volunteer', M, y)
  y += 18
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90)
  doc.text([user?.school, user?.email].filter(Boolean).join('  ·  '), M, y)
  y += 22

  heading('Volunteer service')
  para(`${r1(total)} hours across ${counted.length} sessions${dates.length ? `, ${monthYear(dates[0])} to ${monthYear(dates[dates.length - 1])}` : ''}. ${r1(approved)} hours confirmed by a supervisor, organizer or school.`)

  if (places.length) {
    heading('Where I volunteered')
    for (const p of places) {
      if (!room(40)) break
      doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(20).text(p.name, M, y)
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(90)
      doc.text(`${r1(p.hours)} hours · ${monthYear(p.first)}${p.last !== p.first ? ` – ${monthYear(p.last)}` : ''}`, W - M, y, { align: 'right' })
      y += 13
      const acts = [...p.activities].slice(0, 3).join(', ')
      if (acts) para(acts, 9.5, [70, 70, 70])
      y += 4
    }
  }

  if (skills.length && room(40)) {
    heading('Skills')
    para(skills.map((s) => `${s.skill} (${r1(s.hours)} h)`).join('  ·  '))
  }

  if (badges.length && room(40)) {
    heading('Recognition')
    para(badges.join('  ·  '))
  }

  for (const r of refs) {
    if (!room(70)) break
    if (r === refs[0]) heading('References')
    const text = r.text.length > 420 ? `${r.text.slice(0, 417).trim()}…` : r.text
    para(`“${text}”`, 9.5, [50, 50, 50])
    para(`— ${[r.writerName, r.writerTitle, r.organization].filter(Boolean).join(', ')}`, 9.5, [90, 90, 90])
    y += 6
  }

  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(140)
  doc.text(`Made with VolunTrack on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. Rejected hours are not counted.`, M, H - 30)
  const safe = String(user?.name || 'volunteer').replace(/[^\w-]+/g, '-').toLowerCase()
  doc.save(`${safe}-volunteer-resume.pdf`)
  return true
}
