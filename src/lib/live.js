// PSS-AI P2.5 live updates (G28): the edge functions send an empty "changed" broadcast after each
// change (topic branch:<id>, or pss:all). Screens subscribe here and re-fetch through api().
// One Realtime channel per topic is shared by every listener; bursts are merged (1 s).
import { supabase } from './api'

const topics = new Map() // topic → { channel, listeners: Set }

export function onLiveChange(topicNames, listener) {
  let timer = null
  const fire = () => { clearTimeout(timer); timer = setTimeout(listener, 1000) }
  for (const topic of topicNames) {
    let t = topics.get(topic)
    if (!t) {
      const channel = supabase.channel(topic).on('broadcast', { event: 'changed' }, () => { for (const l of t.listeners) l() })
      t = { channel, listeners: new Set() }
      topics.set(topic, t)
      channel.subscribe()
    }
    t.listeners.add(fire)
  }
  return () => {
    clearTimeout(timer)
    for (const topic of topicNames) {
      const t = topics.get(topic)
      if (!t) continue
      t.listeners.delete(fire)
      if (!t.listeners.size) { supabase.removeChannel(t.channel); topics.delete(topic) }
    }
  }
}
