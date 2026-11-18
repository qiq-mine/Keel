import { createHash } from 'node:crypto'
import { keelError, KeelError } from '../errors.js'
import type { WecomHttp } from './http.js'

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
  const base = url.split(/[?#]/)[0]
  const marker = '/doc/'
  const idx = base.indexOf(marker)
  if (idx === -1) {
    return null
  }
  const rest = base.slice(idx + marker.length)
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

export interface DocTarget {
  spaceid: string
  fatherid: string
}

interface FileListItem {
  fileid: string
  file_name: string
  file_type: number
  file_status: number
  url?: string
}

interface FileListResponse {
  has_more?: boolean
  next_start?: number
  file_list?: {
    item?: FileListItem[]
  }
}

interface CreateDocResponse {
  docid: string
  url: string
}

export async function listDocsByName(
  http: WecomHttp,
  target: DocTarget,
  name: string
): Promise<{ fileid: string; url: string }[]> {
  let start = 0
  const results: { fileid: string; url: string }[] = []
  let page = 1

  while (page <= 20) {
    const res = await http.call<FileListResponse>('/cgi-bin/wedrive/file_list', {
      spaceid: target.spaceid,
      fatherid: target.fatherid,
      sort_type: 1,
      start,
      limit: 1000
    })

    const items = res.file_list?.item ?? []
    for (const item of items) {
      if (item.file_status === 1 && item.file_type === 3 && item.file_name === name) {
        results.push({ fileid: item.fileid, url: item.url ?? '' })
      }
    }

    if (!res.has_more) {
      return results
    }

    if (page === 20) {
      throw keelError('keel/wecom-ambiguous-doc')
    }

    start = typeof res.next_start === 'number' ? res.next_start : start + 1000
    page++
  }

  return results
}

export async function createDoc(
  http: WecomHttp,
  target: DocTarget,
  name: string
): Promise<{ docid: string; url: string }> {
  try {
    const res = await http.call<CreateDocResponse>('/cgi-bin/wedoc/create_doc', {
      spaceid: target.spaceid,
      fatherid: target.fatherid,
      doc_type: 3,
      doc_name: name
    })
    return { docid: res.docid, url: res.url }
  } catch (err) {
    if (err instanceof KeelError && err.code === 'keel/wecom-unavailable') {
      const matches = await listDocsByName(http, target, name)
      if (matches.length === 1) {
        return { docid: matches[0].fileid, url: matches[0].url }
      }
      if (matches.length === 0) {
        throw err
      }
      throw keelError('keel/wecom-ambiguous-doc')
    }
    throw err
  }
}

export async function resolveDocid(
  http: WecomHttp,
  file: { fileid: string; url: string }
): Promise<string> {
  try {
    await http.call('/cgi-bin/wedoc/document/get', { docid: file.fileid })
    return file.fileid
  } catch (err) {
    if (
      !(
        err instanceof KeelError &&
        (err.code === 'keel/wecom-rejected' || err.code === 'keel/wecom-forbidden')
      )
    ) {
      throw err
    }
  }

  const urlDocid = docidFromUrl(file.url)
  if (urlDocid !== null) {
    try {
      await http.call('/cgi-bin/wedoc/document/get', { docid: urlDocid })
      return urlDocid
    } catch (err) {
      if (
        !(
          err instanceof KeelError &&
          (err.code === 'keel/wecom-rejected' || err.code === 'keel/wecom-forbidden')
        )
      ) {
        throw err
      }
    }
  }

  throw keelError('keel/wecom-docid-unreadable')
}

interface TextNode {
  begin: number
  end: number
  text: string
}

function isTextNode(val: unknown): val is TextNode {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false
  }
  const obj = val as Record<string, unknown>
  return (
    typeof obj.begin === 'number' &&
    typeof obj.end === 'number' &&
    typeof obj.text === 'string'
  )
}

function collectTextNodes(root: unknown): TextNode[] {
  const nodes: TextNode[] = []
  function walk(val: unknown): void {
    if (typeof val !== 'object' || val === null) {
      return
    }
    if (isTextNode(val)) {
      nodes.push(val)
      return
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        walk(item)
      }
      return
    }
    for (const key of Object.keys(val)) {
      walk((val as Record<string, unknown>)[key])
    }
  }
  walk(root)
  return nodes
}

interface DocumentGetResponse {
  version: number
  document: unknown
}

export async function readDoc(
  http: WecomHttp,
  docid: string
): Promise<{ version: number; text: string; offset: number }> {
  const res = await http.call<DocumentGetResponse>('/cgi-bin/wedoc/document/get', { docid })
  const nodes = collectTextNodes(res.document)
  const { text, offset } = joinText(nodes)
  return { version: res.version, text, offset }
}

export type ReplacePolicy = 'if-different' | 'if-missing'

interface DeleteContentRequest {
  delete_content: {
    range: {
      start_index: number
      length: number
    }
  }
}

interface InsertTextRequest {
  insert_text: {
    text: string
    location: {
      index: number
    }
  }
}

type BatchUpdateRequest = DeleteContentRequest | InsertTextRequest

export async function replaceSection(
  http: WecomHttp,
  docid: string,
  title: string,
  sectionText: string,
  policy: ReplacePolicy,
  same: (existing: string, next: string) => boolean = (a, b) => a === b
): Promise<'written' | 'skipped'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = await readDoc(http, docid)
    const range = sectionRange(doc.text, title)

    if (range !== null) {
      if (policy === 'if-missing') {
        return 'skipped'
      }
      if (same(doc.text.slice(range.begin, range.end), sectionText)) {
        return 'skipped'
      }
    }

    let requests: BatchUpdateRequest[]

    if (range !== null) {
      requests = [
        {
          delete_content: {
            range: {
              start_index: doc.offset + range.begin,
              length: range.end - range.begin
            }
          }
        },
        {
          insert_text: {
            text: sectionText,
            location: {
              index: doc.offset + range.begin
            }
          }
        }
      ]
    } else {
      let textToInsert = sectionText
      if (doc.text.length > 0 && !doc.text.endsWith('\n')) {
        textToInsert = '\n' + sectionText
      }
      requests = [
        {
          insert_text: {
            text: textToInsert,
            location: {
              index: doc.offset + doc.text.length
            }
          }
        }
      ]
    }

    try {
      await http.call('/cgi-bin/wedoc/document/batch_update', {
        docid,
        version: doc.version,
        requests
      })
      return 'written'
    } catch (err) {
      if (attempt === 1) {
        throw err
      }
    }
  }

  return 'written'
}
