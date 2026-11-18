import { createHash } from 'node:crypto'
import { keelError } from '../errors.js'

export function docName(pathWithNamespace: string): string {
  const replaced = pathWithNamespace.replaceAll('/', ' - ')
  const codePoints = [...replaced]
  if (codePoints.length <= 255) {
    return replaced
  }
  const hash = createHash('sha256')
    .update(pathWithNamespace, 'utf8')
    .digest('hex')
    .slice(0, 14)
    .toLowerCase()
  return codePoints.slice(0, 240).join('') + '-' + hash
}

export function docidFromUrl(url: string): string | null {
  const marker = '/doc/'
  const idx = url.indexOf(marker)
  if (idx === -1) {
    return null
  }
  const rest = url.slice(idx + marker.length)
  let endIdx = rest.length
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (ch === '?' || ch === '#' || ch === '/') {
      endIdx = i
      break
    }
  }
  const segment = rest.slice(0, endIdx)
  return segment.length > 0 ? segment : null
}

export function joinText(nodes: { begin: number; end: number; text: string }[]): { text: string; offset: number } {
  if (nodes.length === 0) {
    return { text: '', offset: 0 }
  }
  let text = ''
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.end - node.begin !== node.text.length) {
      throw keelError('keel/wecom-doc-index')
    }
    if (i > 0 && node.begin !== nodes[i - 1].end) {
      throw keelError('keel/wecom-doc-index')
    }
    text += node.text
  }
  return { text, offset: nodes[0].begin }
}

const WEEKLY_SECTION_RE = /^周报 \d{4}-\d{2}-\d{2}$/
const MONTHLY_SECTION_RE = /^月报 \d{4}-\d{2}$/

export function sectionRange(text: string, title: string): { begin: number; end: number } | null {
  const lines = text.split('\n')
  const lineIndices: number[] = []
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    lineIndices.push(offset)
    offset += lines[i].length + 1
  }

  let titleIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === title) {
      titleIndex = i
      break
    }
  }

  if (titleIndex === -1) {
    return null
  }

  const begin = lineIndices[titleIndex]
  let end = text.length

  for (let i = titleIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (WEEKLY_SECTION_RE.test(line) || MONTHLY_SECTION_RE.test(line)) {
      end = lineIndices[i]
      break
    }
  }

  return { begin, end }
}

export function docHeader(pathWithNamespace: string): string {
  return 'Keel 周报\n' + pathWithNamespace + '\n'
}
