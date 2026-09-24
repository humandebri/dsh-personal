/** Copy for the side-chat tab type, its body, and its header action. */

/** Locale namespace owned by this plugin. */
export const NS = 'uiSideChat'

/** Copy keys owned by this plugin. */
export type SideChatKey =
  | 'user'
  | 'assistant'
  | 'responding'
  | 'closed'
  | 'title'
  | 'open'
  | 'openHint'
  | 'opening'
  | 'placeholder'
  | 'send'
  | 'stop'
  | 'sendQueue'
  | 'sendSteer'
  | 'pending'
  | 'attach'
  | 'attachments'
  | 'attachment'
  | 'removeAttachment'
  | 'attachmentUploading'
  | 'attachmentFailed'
  | 'dropHint'
  | 'enterHint'
  | 'copy'
  | 'copied'
  | 'footnotes'
  | 'empty'
  | 'boundary'
  | 'closeFailed'
  | 'openFailed'

/** English copy. */
export const en: Record<SideChatKey, string> = {
  user: 'You', assistant: 'Assistant', responding: 'Replying…', closed: 'This side chat has ended. Close the tab and open a new side chat.',
  title: 'Side chat',
  open: 'Side chat',
  openHint: 'Ask a question beside this conversation',
  opening: 'Opening side chat…',
  placeholder: 'Ask about this conversation…',
  send: 'Send', stop: 'Stop', sendQueue: 'Queue message', sendSteer: 'Steer message', pending: 'Waiting to send', enterHint: 'Enter to send · Shift+Enter for a new line', copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes',
  attach: 'Attach files', attachments: 'Draft attachments', attachment: 'Attached image', removeAttachment: 'Remove {name}', attachmentUploading: 'Uploading…', attachmentFailed: 'Attachment refused', dropHint: 'Drop files to attach',
  empty: 'This side chat continues from the conversation beside it. Ask a question to start.',
  boundary: 'Inherited history is reference only',
  closeFailed: 'The side chat could not be closed and is still running.',
  openFailed: 'The side chat could not be opened.',
}

/** Chinese copy. */
export const zh: Record<SideChatKey, string> = {
  user: '你', assistant: '助手', responding: '正在回复…', closed: '对话已结束，请关闭标签后重新打开。',
  title: '侧边对话',
  open: '侧边对话',
  openHint: '在当前对话旁边提一个问题',
  opening: '正在打开侧边对话…',
  placeholder: '就当前对话提问…',
  send: '发送', stop: '停止', sendQueue: '排队发送', sendSteer: '插话发送', pending: '等待发送', enterHint: 'Enter 发送 · Shift+Enter 换行', copy: '复制', copied: '已复制', footnotes: '脚注',
  attach: '添加附件', attachments: '草稿附件', attachment: '附加图片', removeAttachment: '移除 {name}', attachmentUploading: '上传中…', attachmentFailed: '附件被拒绝', dropHint: '拖放文件以添加附件',
  empty: '这个侧边对话从旁边的对话继续。提一个问题即可开始。',
  boundary: '继承的历史仅供参考',
  closeFailed: '侧边对话未能关闭，仍在运行。',
  openFailed: '侧边对话未能打开。',
}

/** Japanese copy. */
export const ja: Record<SideChatKey, string> = {
  title: 'サイドチャット', open: 'サイドチャット', openHint: 'この会話について別に質問する',
  opening: 'サイドチャットを開いています…', placeholder: 'この会話について質問…', send: '送信', stop: '停止',
  sendQueue: 'キュー送信', sendSteer: '割り込み送信', pending: '送信待ち',
  attach: 'ファイルを添付', attachments: '添付の下書き', attachment: '添付画像', removeAttachment: '{name} を外す', attachmentUploading: 'アップロード中…', attachmentFailed: '添付できませんでした', dropHint: 'ファイルをドロップして添付',
  enterHint: 'Enterで送信・Shift+Enterで改行', copy: 'コピー', copied: 'コピーしました', footnotes: '脚注',
  empty: 'メインの会話を参考に質問できます。', boundary: '引き継いだ会話は参考情報として扱います',
  closeFailed: 'サイドチャットを終了できませんでした。', openFailed: 'サイドチャットを開けませんでした。',
  user: 'あなた', assistant: 'アシスタント', responding: '返信中…', closed: 'このサイドチャットは終了しました。タブを閉じて開き直してください。',
}
