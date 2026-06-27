export default async function (ctx) {
  const { defineComponent, h, ref, reactive } = ctx.vue

  const TAGS_URL = 'https://oss.xt-url.com/EchoMusic/channel-wander/tags.json'
  let tagGroups = []

  async function loadTags() {
    try {
      const localPath = ctx.descriptor.directory + '/tags.json'
      const localResult = await ctx.fs.readTextFile(localPath)
      if (localResult.ok) {
        const parsed = JSON.parse(localResult.data)
        tagGroups = parsed.data || []
        checkUpdate(parsed.version || 0, localPath)
        return
      }
    } catch {
      /* 本地不存在或读取失败 */
    }

    try {
      const res = await ctx.net.fetch(TAGS_URL + '?t=' + Date.now())
      if (res.ok) {
        const remote = await res.json()
        const localPath = ctx.descriptor.directory + '/tags.json'
        await ctx.fs.writeFile(localPath, JSON.stringify(remote, null, 2))
        tagGroups = remote.data || []
      }
    } catch {
      /* 静默 */
    }
  }

  async function checkUpdate(localVersion, localPath) {
    try {
      const res = await ctx.net.fetch(TAGS_URL + '?t=' + Date.now())
      if (res.ok) {
        const remote = await res.json()
        if ((remote.version || 0) > localVersion) {
          await ctx.fs.writeFile(localPath, JSON.stringify(remote, null, 2), { overwrite: true })
          tagGroups = remote.data || []
        }
      }
    } catch {
      /* 静默 */
    }
  }

  await loadTags()

  const fetchedSongIds = new Set()
  const isLoading = ref(false)
  const songBuffer = ref([])
  let currentTagIds = ''
  let autoRefillActive = false
  let cleanupAutoRefill = null
  let previousPlayMode = null
  let modeWatcher = null
  let removeLockStyle = null
  let dialogDisposer = null

  const removeStyle = ctx.css.inject(`
    .home-feature-row {
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    }
    .cw-feature-card {
      display: flex;
      align-items: center;
      gap: 14px;
      height: 72px;
      padding: 0 18px;
      border-radius: 16px;
      background: var(--color-bg-elevated);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
    }
    .cw-feature-card .feature-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      box-shadow: 0 6px 14px rgba(0, 0, 0, 0.12);
      flex-shrink: 0;
    }
    .cw-feature-card .gradient-tertiary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .cw-feature-card .feature-meta {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      min-width: 0;
    }
    .cw-feature-card .feature-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-main);
    }
    .cw-feature-card .feature-sub {
      font-size: 12px;
      font-weight: 500;
      color: color-mix(in srgb, var(--color-text-main) 60%, transparent);
    }
    .cw-feature-card .feature-action {
      width: 30px;
      height: 30px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--color-primary) 12%, transparent);
      color: var(--color-primary);
      cursor: pointer;
      flex-shrink: 0;
    }
    .cw-feature-card .feature-action:hover {
      opacity: 0.85;
    }
    .cw-tag-dialog .cw-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }
    .cw-tag-dialog .cw-dialog {
      background: var(--color-bg-elevated);
      border-radius: 16px;
      padding: 20px 24px;
      width: min(480px, 90vw);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 16px 48px rgba(0,0,0,0.2);
    }
    .cw-tag-dialog .cw-dialog-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 16px;
      font-weight: 600;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--color-text-main);
    }
    .cw-tag-dialog .cw-dialog-close {
      border: none;
      background: none;
      font-size: 18px;
      cursor: pointer;
      color: var(--color-text-secondary);
      padding: 4px;
      border-radius: 6px;
    }
    .cw-tag-dialog .cw-dialog-close:hover {
      background: var(--color-bg-secondary);
    }
    .cw-tag-dialog .cw-dialog-body {
      padding: 16px 0;
      overflow-y: auto;
      flex: 1;
    }
    .cw-tag-dialog .cw-group {
      margin-bottom: 20px;
    }
    .cw-tag-dialog .cw-group:last-child {
      margin-bottom: 0;
    }
    .cw-tag-dialog .cw-group-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-secondary);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cw-tag-dialog .cw-group-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .cw-tag-dialog .cw-chip {
      display: inline-block;
      padding: 5px 14px;
      border-radius: 20px;
      font-size: 13px;
      cursor: pointer;
      user-select: none;
      border: 1px solid var(--border-subtle);
      color: var(--color-text-main);
      background: transparent;
      transition: all 0.15s;
    }
    .cw-tag-dialog .cw-chip:hover {
      background: var(--color-bg-secondary);
    }
    .cw-tag-dialog .cw-chip.cw-chip-on {
      background: var(--color-primary);
      color: #fff;
      border-color: var(--color-primary);
    }
    .cw-tag-dialog .cw-chip.cw-chip-all,
    .cw-tag-dialog .cw-chip.cw-chip-all-partial {
      background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      border-color: var(--color-primary);
      color: var(--color-primary);
      font-weight: 500;
    }
    .cw-tag-dialog .cw-chip.cw-chip-all-partial {
      opacity: 0.6;
    }
    .cw-tag-dialog .cw-chip.cw-chip-all:hover,
    .cw-tag-dialog .cw-chip.cw-chip-all-partial:hover {
      background: color-mix(in srgb, var(--color-primary) 20%, transparent);
    }
    .cw-tag-dialog .cw-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
    }
    .cw-tag-dialog .cw-btn {
      padding: 8px 20px;
      border-radius: 10px;
      font-size: 14px;
      cursor: pointer;
      border: 1px solid var(--border-subtle);
      background: transparent;
      color: var(--color-text-main);
      transition: all 0.15s;
    }
    .cw-tag-dialog .cw-btn:hover {
      background: var(--color-bg-secondary);
    }
    .cw-tag-dialog .cw-btn-cancel {
    }
    .cw-tag-dialog .cw-btn-confirm {
      background: var(--color-primary);
      color: #fff;
      border-color: var(--color-primary);
    }
    .cw-tag-dialog .cw-btn-confirm:hover {
      opacity: 0.9;
    }
  `)

  async function fetchChannelSongs(tagIds) {
    const res = await ctx.net.fetch(
      'https://gateway.kugou.com/youth/v1/recommend/channel_wander',
      {
        method: 'POST',
        headers: {
          'User-Agent': navigator.userAgent,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ tags: tagIds || '' }),
      },
    )
    const json = await res.json()
    if (json.status !== 1 || !json.data) return []

    return json.data.map((item) => {
      const s = item.song
      return {
        id: String(s.base.wide_audio_id || s.base.audio_id),
        title: s.base.songname || '',
        name: s.base.songname || '',
        artist: s.base.author_name || '未知歌手',
        artists: [{ name: s.base.author_name || '' }],
        singers: [{ name: s.base.author_name || '' }],
        album: s.base.album_name || '',
        albumName: s.base.album_name || '',
        albumId: String(s.base.album_id || ''),
        coverUrl: (s.album_info?.cover || '').replace('{size}', '400'),
        audioUrl: '',
        hash: s.audio_info.hash || '',
        albumAudioId: '',
        mixSongId: 0,
        fileId: s.base.audio_id ? Number(s.base.audio_id) : undefined,
        relateGoods: [
          ...(s.audio_info.hash_320
            ? [{ hash: s.audio_info.hash_320, quality: '320' }]
            : []),
          ...(s.audio_info.hash_flac
            ? [{ hash: s.audio_info.hash_flac, quality: 'flac' }]
            : []),
        ],
      }
    })
  }

  function lockPlayMode() {
    if (modeWatcher) return

    previousPlayMode = ctx.player.playMode.value
    ctx.player.setPlayMode('sequential')

    modeWatcher = ctx.vue.watch(
      () => ctx.player.playMode.value,
      (newMode) => {
        if (newMode !== 'sequential') {
          ctx.player.setPlayMode('sequential')
        }
      },
    )

    removeLockStyle = ctx.css.inject(`
      div.flex.items-center.justify-center.gap-4.h-10 > button:first-child {
        pointer-events: none !important;
        opacity: 0.4 !important;
      }
      .bar-controls > button.bar-ctrl-muted {
        pointer-events: none !important;
        opacity: 0.4 !important;
      }
    `, { id: 'lock' })
  }

  function unlockPlayMode() {
    if (removeLockStyle) {
      removeLockStyle()
      removeLockStyle = null
    }
    if (modeWatcher) {
      modeWatcher()
      modeWatcher = null
    }
    if (previousPlayMode != null) {
      ctx.player.setPlayMode(previousPlayMode)
      previousPlayMode = null
    }
  }

  async function playChannelWander(tagIdsStr) {
    if (isLoading.value) return
    isLoading.value = true
    try {
      const songs = await fetchChannelSongs(tagIdsStr)
      if (songs.length === 0) {
        ctx.toast.warning('暂无频道漫游推荐')
        return
      }
      songs.forEach((s) => fetchedSongIds.add(s.id))
      songBuffer.value = songs
      ctx.playlist.replaceAndPlay([songBuffer.value.shift()])
      lockPlayMode()
      startAutoRefill()
    } catch {
      ctx.toast.danger('频道漫游请求失败')
    } finally {
      isLoading.value = false
    }
  }

  function getRemaining() {
    const queue = ctx.playlist.store.activeQueue
    if (!queue || !queue.songs || queue.songs.length === 0) return 0
    if (!queue.currentTrackId) return queue.songs.length
    const idx = queue.songs.findIndex(
      (s) => String(s.id) === String(queue.currentTrackId),
    )
    return idx === -1 ? queue.songs.length : queue.songs.length - idx - 1
  }

  function isOurSession() {
    const queue = ctx.playlist.store.activeQueue
    if (!queue || !queue.songs || queue.songs.length === 0) return false
    return queue.songs.some((s) => fetchedSongIds.has(String(s.id)))
  }

  async function ensureBuffer() {
    if (isLoading.value) return
    if (songBuffer.value.length > 4) return
    isLoading.value = true
    try {
      const songs = await fetchChannelSongs(currentTagIds)
      const newSongs = songs.filter((s) => !fetchedSongIds.has(s.id))
      if (newSongs.length === 0) return
      newSongs.forEach((s) => fetchedSongIds.add(s.id))
      songBuffer.value.push(...newSongs)
    } catch {
      /* 静默 */
    } finally {
      isLoading.value = false
    }
  }

  function feedBufferToQueue() {
    if (songBuffer.value.length === 0) return
    if (getRemaining() > 0) return
    ctx.playlist.append([songBuffer.value.shift()])
  }

  function startAutoRefill() {
    if (autoRefillActive) return
    autoRefillActive = true

    const unsubTrack = ctx.events.onTrackChange(() => {
      if (!isOurSession()) return stop()
      ensureBuffer()
      feedBufferToQueue()
    })
    const unsubEnded = ctx.events.onEnded(() => {
      if (!isOurSession()) return stop()
      ensureBuffer()
      feedBufferToQueue()
    })
    const unsubError = ctx.events.onError(() => {
      if (!isOurSession()) return
      ensureBuffer()
    })

    function stop() {
      unsubTrack()
      unsubEnded()
      unsubError()
      unlockPlayMode()
      autoRefillActive = false
      cleanupAutoRefill = null
    }
    cleanupAutoRefill = stop
    ctx.dispose(stop)
  }

  const TagDialog = defineComponent({
    props: ['groups', 'savedTagIds', 'onConfirm', 'onCancel'],
    setup(props) {
      const state = reactive({ selected: {} })

      props.groups.forEach((g) => {
        state.selected[g.tag_id] = []
      })

      if (props.savedTagIds) {
        const savedIds = props.savedTagIds.split(',')
        for (const group of props.groups) {
          const arr = state.selected[group.tag_id]
          if (savedIds.includes(group.tag_id)) {
            arr.splice(0, arr.length, ...group.son.map(c => c.tag_id))
          } else {
            const childIds = savedIds.filter(id =>
              group.son.some(c => c.tag_id === id),
            )
            arr.splice(0, arr.length, ...childIds)
          }
        }
      }

      function toggleAll(group) {
        const arr = state.selected[group.tag_id]
        const allSelected = group.son.every((c) => arr.includes(c.tag_id))
        if (allSelected) {
          arr.splice(0, arr.length)
        } else {
          arr.splice(0, arr.length, ...group.son.map((c) => c.tag_id))
        }
      }

      function toggleChild(groupId, childId) {
        const arr = state.selected[groupId]
        const idx = arr.indexOf(childId)
        if (idx === -1) {
          arr.push(childId)
        } else {
          arr.splice(idx, 1)
        }
      }

      function buildTagIds() {
        const ids = []
        for (const g of props.groups) {
          const arr = state.selected[g.tag_id] || []
          if (arr.length === 0) continue
          if (arr.length === g.son.length) {
            ids.push(g.tag_id)
          } else {
            ids.push(...arr)
          }
        }
        return ids.join(',')
      }

      return () =>
        h('div', { class: 'cw-overlay', onClick: () => props.onCancel() }, [
          h('div', { class: 'cw-dialog', onClick: (e) => e.stopPropagation() }, [
            h('div', { class: 'cw-dialog-title' }, [
              h('span', '频道漫游 - 选择标签'),
              h('button', {
                class: 'cw-dialog-close',
                onClick: () => props.onCancel(),
              }, '✕'),
            ]),
            h('div', { class: 'cw-dialog-body' }, [
              ...props.groups.map((group) => {
                const arr = state.selected[group.tag_id] || []
                const allSelected = arr.length === group.son.length
                const anySelected = arr.length > 0

                return h('div', { class: 'cw-group' }, [
                  h('div', { class: 'cw-group-name' }, [
                    h('span', group.tag_name),
                    h('span', {
                      class: [
                        'cw-chip',
                        allSelected ? 'cw-chip-all' : anySelected ? 'cw-chip-all-partial' : '',
                      ].filter(Boolean),
                      onClick: (e) => {
                        e.stopPropagation()
                        toggleAll(group)
                      },
                    }, '全部'),
                  ]),
                  h('div', { class: 'cw-group-tags' }, [
                    ...group.son.map((child) => {
                      const isSelected = arr.includes(child.tag_id)
                      return h('span', {
                        class: ['cw-chip', isSelected ? 'cw-chip-on' : ''].filter(Boolean),
                        onClick: () => toggleChild(group.tag_id, child.tag_id),
                      }, child.tag_name)
                    }),
                  ]),
                ])
              }),
            ]),
            h('div', { class: 'cw-dialog-actions' }, [
              h('button', {
                class: 'cw-btn cw-btn-cancel',
                onClick: () => props.onCancel(),
              }, '取消'),
              h('button', {
                class: 'cw-btn cw-btn-confirm',
                onClick: () => {
                  const ids = buildTagIds()
                  if (!ids) {
                    ctx.toast.warning('请至少选择一个标签')
                    return
                  }
                  props.onConfirm(ids)
                },
              }, '确认播放'),
            ]),
          ]),
        ])
    },
  })

  async function openTagDialog() {
    if (dialogDisposer) return

    const saved = await ctx.storage.get('selectedTagIds')
    const savedTagIds = typeof saved === 'string' ? saved : ''

    function closeDialog() {
      if (dialogDisposer) {
        dialogDisposer()
        dialogDisposer = null
      }
    }

    dialogDisposer = ctx.ui.teleport(TagDialog, {
      className: 'cw-tag-dialog',
      props: {
        groups: tagGroups,
        savedTagIds,
        onConfirm: (tagIdsStr) => {
          currentTagIds = tagIdsStr
          ctx.storage.set('selectedTagIds', tagIdsStr)
          closeDialog()
          playChannelWander(tagIdsStr)
        },
        onCancel: closeDialog,
      },
    })
  }

  async function quickPlay() {
    if (isLoading.value || dialogDisposer) return
    const saved = await ctx.storage.get('selectedTagIds')
    const tagIdsStr = typeof saved === 'string' ? saved : ''
    currentTagIds = tagIdsStr
    playChannelWander(tagIdsStr)
  }

  const ChannelWanderCard = defineComponent({
    setup() {
      const IconComp = ctx.vue.resolveComponent('Icon')
      const playIcon = ctx.icons.iconPlay
      return () =>
        h('div', {
          class: 'home-feature-card cw-feature-card',
          onClick: () => openTagDialog(),
        }, [
          h('div', { class: 'feature-icon gradient-tertiary' }, '漫游'),
          h('div', { class: 'feature-meta' }, [
            h('div', { class: 'feature-title' }, '频道漫游'),
            h('div', { class: 'feature-sub' }, '探索发现'),
          ]),
          h('div', {
            class: 'feature-action',
            style: { cursor: 'pointer' },
            onClick: (e) => {
              e.stopPropagation()
              quickPlay()
            },
          }, [
            h(IconComp, { icon: playIcon, width: 14, height: 14 }),
          ]),
        ])
    },
  })

  function injectCard() {
    if (document.querySelector('.cw-feature-card')) return
    const firstCard = document.querySelector('.home-feature-card')
    if (firstCard) {
      ctx.ui.mount(firstCard, ChannelWanderCard, { position: 'after' })
    }
  }

  const removeObserve = ctx.dom.observe('.home-feature-row', injectCard)

  ctx.dispose(() => {
    removeStyle()
    removeObserve()
    if (cleanupAutoRefill) cleanupAutoRefill()
    if (dialogDisposer) dialogDisposer()
  })
}
