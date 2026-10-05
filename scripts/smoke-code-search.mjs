// Explicit opt-in live smoke: uses the DSH credential provider, never prints tokens.
// Selected code is sent to Devin/Windsurf. Run only on a workspace you may upload.
import { Context } from '@deepseek-ai/cordis'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Authorization from '@deepseek-ai/dsh-authorization'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { Sessions } from '../dist/session.js'
import { WindsurfCompletion } from '../dist/completion.js'
import { codeSearch } from '../dist/code-search.js'
import { toolMarker } from '../dist/protocol.js'
import { safeError } from '../dist/safety.js'

const root = resolve(process.argv[2] ?? process.cwd())
const query = process.argv[3] ?? 'Locate agent task execution, session lifecycle and tool dispatch implementations. Return verified code locations.'
const controller = new AbortController()
const interrupt = () => controller.abort()
process.once('SIGINT', interrupt)
const ctx = new Context()
const fibers = [
  ctx.plugin(Credentials, { dshHome: process.env.DSH_HOME ?? resolve(homedir(), '.dsh'), watch: false }),
  ctx.plugin(Authorization),
]
let sessions
let cloud
try {
  await Promise.all(fibers.map(f => f.await()))
  sessions = new Sessions(ctx)
  await sessions.reload()
  if (!sessions.available()) throw new Error('No active Devin session in the DSH credential store. Log in through DSH first.')
  cloud = new WindsurfCompletion(sessions)
  let turns = 0
  const completion = {
    async complete(...args) {
      const text = await cloud.complete(...args)
      let marker
      try { marker = toolMarker(text) }
      catch (error) {
        if (process.env.DSH_SMOKE_TRACE === '1') console.log('Malformed tool response (credential-redacted, capped):', text.slice(0, 8192))
        console.log('Cloud turn', ++turns, 'response: malformed tool marker')
        return text
      }
      console.log('Cloud turn', ++turns, 'response:', marker?.name ?? 'final text')
      if (process.env.DSH_SMOKE_TRACE === '1' && marker?.name === 'ANSWER') console.log('Answer references:', JSON.stringify(marker.args))
      if (process.env.DSH_SMOKE_TRACE === '1' && marker?.name === 'restricted_exec') {
        console.log('Command scopes:', JSON.stringify(Object.entries(marker.args).map(([key, value]) => ({
          key, op: value?.op, path: typeof value?.path === 'string' && value.path.startsWith('/codebase') ? value.path : '(default/invalid)',
          start: value?.start, end: value?.end,
        }))))
      }
      return text
    },
  }
  const result = await codeSearch({ search_term: query, search_folder_absolute_uri: root }, root, p => p, completion, controller.signal)
  console.log(JSON.stringify({
    status: result.status,
    turns,
    files: result.files.map(f => ({ path: f.path, ranges: f.ranges.map(r => ({ start: r.start, end: r.end })) })),
    error: result.status === 'error' ? result.content : undefined,
  }, null, 2))
  if (result.status !== 'success' || !result.files.length) process.exitCode = 1
} catch (error) {
  console.error(cloud ? safeError(error) : 'Live smoke unavailable: check the DSH installation and active Devin login.')
  process.exitCode = 1
} finally {
  process.removeListener('SIGINT', interrupt)
  cloud?.invalidate()
  await sessions?.dispose()
  for (const fiber of fibers.reverse()) await fiber.dispose()
}
