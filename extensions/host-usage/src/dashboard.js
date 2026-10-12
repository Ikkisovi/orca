const token = location.hash.slice(1)
const $ = id => document.getElementById(id)
const number = value => new Intl.NumberFormat('en').format(value)
const compact = value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
const date = value => value ? new Date(value).toLocaleString() : '尚未扫描'
let requestId = 0, current = null
async function api(path, body) {
  const result = await fetch(path, { cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })
  if (!result.ok) throw new Error(result.status === 401 ? '连接已过期，请重新打开用量面板。' : (await result.text()))
  return result.json()
}
function text(tag, value, className) { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element }
function table(id, columns, rows) {
  const root = $(id); root.replaceChildren()
  if (!rows.length) { root.append(text('p', '所选范围暂无已采集用量。', 'empty')); return }
  const node = document.createElement('table'), head = document.createElement('tr')
  for (const column of columns) head.append(text('th', column.label, column.numeric ? 'num' : ''))
  const thead = document.createElement('thead'); thead.append(head); node.append(thead)
  const body = document.createElement('tbody')
  for (const row of rows) { const tr = document.createElement('tr'); for (const column of columns) tr.append(text('td', column.format ? column.format(row) : row[column.key], column.numeric ? 'num' : '')); body.append(tr) }
  node.append(body); root.append(node)
}
function chart(rows) {
  $('chart').replaceChildren()
  if (!rows.length) { $('chart').append(text('p', '扫描主机后显示每日用量。', 'empty')); return }
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 1000 200'); svg.setAttribute('role', 'img')
  const max = Math.max(...rows.map(row => row.total), 1), width = 950 / rows.length
  rows.forEach((row, index) => {
    const rect = document.createElementNS(ns, 'rect'), height = 150 * row.total / max
    for (const [key, value] of Object.entries({ x: 40 + index * width, y: 170 - height, width: Math.max(width - 2, 1), height, rx: 1 })) rect.setAttribute(key, value)
    const title = document.createElementNS(ns, 'title'); title.textContent = `${row.key}: ${number(row.total)} tokens`; rect.append(title); svg.append(rect)
  })
  for (const [x, value, anchor] of [[40, rows[0].key, 'start'], [990, rows.at(-1).key, 'end'], [40, `${compact(max)} tokens`, 'start']]) {
    const label = document.createElementNS(ns, 'text'); label.setAttribute('x', x); label.setAttribute('y', value.includes('tokens') ? 14 : 195); label.setAttribute('text-anchor', anchor); label.textContent = value; svg.append(label)
  }
  $('chart').append(svg)
}
function dates() {
  const now = new Date(), today = now.toISOString().slice(0, 10), mode = $('range').value
  let from = '', to = today
  if (/^\d+$/.test(mode)) from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - Number(mode) + 1)).toISOString().slice(0, 10)
  else if (mode === 'month') from = `${today.slice(0, 7)}-01`
  else if (mode === 'previous') { from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10); to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10) }
  else if (mode === 'all') to = ''
  if (mode !== 'custom') { $('from').value = from; $('to').value = to }
}
async function reload() {
  const id = ++requestId
  try {
    const query = new URLSearchParams({ host: $('host').value, provider: $('provider').value, from: $('from').value, to: $('to').value, project: $('project').value })
    const value = await api(`/api/usage?${query}`)
    if (id !== requestId) return
    current = value; $('error').hidden = true
    const selected = $('host').value
    $('host').replaceChildren(new Option('所有主机', 'all'), ...value.hosts.map(host => new Option(host.label, host.key)))
    if ([...$('host').options].some(option => option.value === selected)) $('host').value = selected
    $('interval').value = String(value.interval)
    $('hosts').replaceChildren()
    const states = { unscanned: '尚未扫描', scanning: '正在扫描', ready: '扫描完成', partial: '部分客户端失败', error: '连接或扫描失败', 'needs-ssh': '需要 SSH 连接' }
    for (const host of value.hosts) {
      const card = text('article', '', 'host'); card.append(text('h3', host.hostname ?? host.label), text('p', host.aliases.join(' · ')), text('p', states[host.state] ?? host.state), text('p', `最近成功：${date(host.lastSuccessAt)}`))
      if (host.error) card.append(text('p', host.error, 'error'))
      if (host.providers) {
        const details = document.createElement('details'); details.append(text('summary', '客户端扫描状态'))
        for (const provider of host.providers) details.append(text('p', `${provider.provider}: ${provider.state} · ${date(provider.completedAt ?? provider.lastGoodAt)}${provider.error ? ' · ' + provider.error : ''}`, provider.error ? 'error' : ''))
        card.append(details)
      }
      $('hosts').append(card)
    }
    $('scan').disabled = value.scanning; $('scan').textContent = value.scanning ? '正在扫描…' : '扫描主机'
    $('status').textContent = value.scanning ? '采集进行中；面板显示最近一次已完成的数据。' : value.warnings.length ? value.warnings.join(' · ') : `${value.data.includedHosts.length} 台主机已有统计 · 自动扫描${value.interval ? '已开启' : '已关闭'}`
    const { summary } = value.data
    $('total').textContent = compact(summary.total); $('total').title = number(summary.total)
    $('io').textContent = `${compact(summary.input)} / ${compact(summary.output)}`
    $('cached').textContent = compact(summary.cached); $('sessions').textContent = number(summary.sessions)
    $('cost').textContent = `$${summary.knownCost.toFixed(2)}`
    $('cost-note').textContent = summary.unknownCostRows ? `${summary.unknownCostRows} 条统计的价格未知` : '按已知模型费率估算'
    chart(value.data.daily)
    const metrics = [{ key: 'key', label: '名称' }, { label: 'Tokens', numeric: true, format: row => number(row.total) }, { label: '输出', numeric: true, format: row => number(row.output) }]
    table('providers', metrics, value.data.providers); table('models', metrics, value.data.models.slice(0, 30)); table('projects', metrics, value.data.projects.slice(0, 30))
    table('recent', [{ key: 'project', label: '项目' }, { key: 'host', label: '主机' }, { key: 'provider', label: '客户端' }, { key: 'model', label: '模型' }, { label: '最近活动', format: row => date(row.lastAt) }, { label: '会话累计 Tokens', numeric: true, format: row => number(row.total) }], value.data.recent)
  } catch (error) { $('error').hidden = false; $('error').textContent = error.message; $('status').textContent = '读取失败；保留当前显示。'; $('scan').disabled = false; $('scan').textContent = '扫描主机' }
}
async function submit(path, body) {
  try { await api(path, body); await reload() } catch (error) { $('error').hidden = false; $('error').textContent = error.message }
}
$('reload').onclick = reload
$('scan').onclick = async () => { $('scan').disabled = true; await submit('/api/scan', { host: $('host').value }) }
$('interval').onchange = () => submit('/api/settings', { interval: Number($('interval').value) })
$('add-host').onsubmit = event => { event.preventDefault(); void submit('/api/hosts', { alias: $('alias').value.trim() }) }
for (const id of ['host', 'provider', 'project']) $(id).onchange = reload
$('range').onchange = () => { dates(); void reload() }
for (const id of ['from', 'to']) $(id).onchange = () => { $('range').value = 'custom'; void reload() }
dates(); void reload()
setInterval(() => { if (!document.hidden) void reload() }, 3000)
