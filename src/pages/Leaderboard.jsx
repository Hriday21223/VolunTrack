import { useEffect, useState } from 'react'
import { Medal, School, User } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { cn } from '@/utils/cn.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const RANK_COLOR = ['text-amber-500', 'text-earth-400', 'text-orange-700']

function RankBadge({ rank }) {
  return (
    <div className={cn(
      'w-8 h-8 rounded-full grid place-items-center text-sm font-display font-bold flex-shrink-0',
      rank <= 3 ? 'bg-brand-100 dark:bg-brand-900/30' : 'bg-earth-100 dark:bg-[#1a2620]',
      RANK_COLOR[rank - 1] || 'text-earth-500 dark:text-earth-400',
    )}>
      {rank}
    </div>
  )
}

export default function Leaderboard() {
  const [tab, setTab] = useState('school')
  const [students, setStudents] = useState([])
  const [schools, setSchools] = useState([])
  const [schoolId, setSchoolId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    Promise.all([
      fetch(`${apiUrl}/leaderboard/students`, { headers: authHeaders() }).then((r) => r.json()),
      fetch(`${apiUrl}/leaderboard/schools`).then((r) => r.json()),
    ])
      .then(([s, sc]) => {
        setStudents(s.students || [])
        setSchoolId(s.schoolId ?? null)
        setSchools(sc.schools || [])
      })
      .catch(() => setError('Could not load the leaderboard.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AppLayout title="Leaderboard" subtitle="See how your hours stack up.">
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setTab('school')}
          className={cn('px-4 py-2 rounded-xl text-sm font-medium', tab === 'school' ? 'bg-brand-500 text-white' : 'btn-ghost')}
        >
          <User className="w-4 h-4 inline mr-1.5" /> My School
        </button>
        <button
          onClick={() => setTab('all')}
          className={cn('px-4 py-2 rounded-xl text-sm font-medium', tab === 'all' ? 'bg-brand-500 text-white' : 'btn-ghost')}
        >
          <School className="w-4 h-4 inline mr-1.5" /> All Schools
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-earth-400 py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-500 py-8 text-center">{error}</div>
      ) : tab === 'school' ? (
        !schoolId ? (
          <Card>
            <p className="text-sm text-earth-500 dark:text-earth-400">
              Join a school in Settings to see how you rank against your classmates.
            </p>
          </Card>
        ) : students.length === 0 ? (
          <Card>
            <p className="text-sm text-earth-500 dark:text-earth-400">No approved hours logged at your school yet.</p>
          </Card>
        ) : (
          <Card>
            <ul className="space-y-2">
              {students.map((s, i) => (
                <li
                  key={s.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-xl',
                    s.you && 'bg-brand-500/10 ring-1 ring-brand-500/30',
                  )}
                >
                  <RankBadge rank={i + 1} />
                  <div className="flex-1 min-w-0 font-medium truncate">{s.name}{s.you && ' (you)'}</div>
                  <div className="text-sm font-display font-semibold text-brand-700 dark:text-brand-300">{s.hours}h</div>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : schools.length === 0 ? (
        <Card>
          <p className="text-sm text-earth-500 dark:text-earth-400">No schools have logged approved hours yet.</p>
        </Card>
      ) : (
        <Card>
          <ul className="space-y-2">
            {schools.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 p-3 rounded-xl">
                <RankBadge rank={i + 1} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-xs text-earth-500 dark:text-earth-400">{s.studentCount} student{s.studentCount === 1 ? '' : 's'}</div>
                </div>
                <div className="text-sm font-display font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1">
                  <Medal className="w-4 h-4" /> {s.hours}h
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppLayout>
  )
}
