import { beginMemoryRecovery, endMemoryRecovery, isMemoryRecovering, getRecoveryRevision, chatKey } from '../personal/recovery.js';
import { regenerationMessages } from '../personal/regeneration.js';
import { storySummaryBatch, storyProgressFooter, storySummarizedPrefix } from '../personal/story-memory.js';
import { readStoryChat, storyChatFingerprint } from '../personal/story-chat-source.js';
import { confirmStoryLedgerWrite } from '../personal/story-ledger-write.js';
import * as WorldInfo from '/scripts/world-info.js';
import { timelineReference } from '../personal/prompt-style.js';
import { notify as toastr } from '../personal/notify.js';
import { SUMMARY_NAME, isSummaryEntry, isArchivedSummary, summaryBookName, findActiveSummary } from '../personal/names.js';
import { parseLedgerForRefinement, partitionPendingMicroContent, renderIndependentLedger, formatFileSummarySources, RESERVED_LEDGER_STRUCTURE_REGEX, PROGRESS_SEAL_REGEX } from '../personal/ledger.js';
import { saveLedgerBackup } from '../personal/backups.js';
import { getContext, extension_settings } from "/scripts/extensions.js";
import { characters } from "/script.js";
import { extractBlocksByTags, applyExclusionRules } from './utils/rag-tag-extractor.js';
import {
  world_names,
  loadWorldInfo,
  createNewWorldInfo,
  createWorldInfoEntry,
  saveWorldInfo,
} from "/scripts/world-info.js";
import { saveBook as loreSaveBook, withLoreLock } from "./lore-service.js";
import { extensionName } from "../utils/settings.js";
import { getChatIdentifier } from "./lore.js";
import { compatibleWriteToLorebook } from "./tavernhelper-compatibility.js";
import { captureMemoryKnowledgeState, restoreMemoryKnowledgeState, ingestTextToHanlinyuan, getMemoryStoryContext, syncMemoryStoryProgress, resolveMemoryStoryWorldbook, noteMemoryStoryProgress, captureMemoryStoryState, archiveMemoryStory, restoreMemoryStory } from "./rag-processor.js";
import { showSummaryModal, showHtmlModal } from "../ui/page-window.js";
import { getPresetPrompts, getMixedOrder } from '../PresetSettings/index.js';
import { callAI, generateRandomSeed } from "./api.js";
import { callNgmsAI } from "./api/Ngms_api.js";
import { captureMemoryVisibility, planMemoryVisibility, restoreMemoryVisibility, executeAutoHide } from "./autoHideManager.js";

let reloadEditor = () => {
    console.warn("[大史官] reloadEditor 函数不可用，可能是旧版本。已使用空函数代替。");
};
(async () => {
    try {
        const { reloadEditor: importedReloadEditor } = await import("/scripts/world-info.js");
        if (importedReloadEditor) {
            reloadEditor = importedReloadEditor;
            console.log("[大史官] 已成功动态导入 reloadEditor。");
        }
    } catch (error) {
        console.warn("[大史官] 动态导入 reloadEditor 失败，将使用空函数。错误信息：", error.message);
    }
})();

let isExpeditionRunning = false; 
let manualStopRequested = false; 
const automaticRefinements = new Set();
const activeRefinements = new Set();
const refinementBatches = new Set();
const smallSummaryTasks = new Set();

const RUNNING_LOG_COMMENT = SUMMARY_NAME;


export async function readGoldenLedgerProgress(targetLorebookName) {
  if (!targetLorebookName) return 0;
  try {
    const bookData = await loadWorldInfo(targetLorebookName);
    if (!bookData || !bookData.entries) return 0;
    const ledgerEntry = findActiveSummary(bookData);
    if (!ledgerEntry) return storySummarizedPrefix(getMemoryStoryContext().story, getContext().chatId ?? getContext().getCurrentChatId?.());
    const match = ledgerEntry.content.match(PROGRESS_SEAL_REGEX);
    if (!match) throw new Error('旧总结缺少进度标记，未从头开始；请先检查原书。');
    if (getMemoryStoryContext().story?.worldbook === targetLorebookName) {
      const story = syncMemoryStoryProgress(ledgerEntry.content);
      return storySummarizedPrefix(story, getContext().chatId ?? getContext().getCurrentChatId?.());
    }
    return parseInt(match[1], 10);
  } catch (error) {
    console.error(`[大史官] 阅览《${targetLorebookName}》天机时出错:`, error);
    throw error;
  }
}

export async function checkAndTriggerAutoSummary() {
  if (isExpeditionRunning) {
    return;
  }

  const settings = extension_settings[extensionName];
  if (!settings.historiographySmallAutoEnable) return;
  const initial = captureMemoryContext();
  const threshold = Number(settings.historiographySmallTriggerThreshold);
  if(!Number.isInteger(threshold)||threshold<1)throw new Error('每次总结楼层数必须是大于0的整数。');

  const context = getContext();
  let targetLorebookName = null;
  targetLorebookName = await getTargetLorebookName();
  initial();

  if (!targetLorebookName) return;

  const characterCount = await readGoldenLedgerProgress(targetLorebookName);
  initial();
  const story = getMemoryStoryContext().story;
  if (story) {
    syncMemoryStoryProgress(findActiveSummary(await loadWorldInfo(targetLorebookName))?.content || ''); initial();
    const currentFile = getContext().chatId ?? getContext().getCurrentChatId?.();
    // Current work is independent of unavailable or unfinished historical files.
    for (const chatFile of [currentFile, ...Object.keys(story.files).filter(name => name !== currentFile)]) {
      const batch = storySummaryBatch(story, chatFile, threshold, chatFile === currentFile ? settings.historiographyRetentionCount ?? 5 : 0, chatFile === currentFile);
      if (!batch) continue;
      try {
        const chat = await readStoryChat(getContext(), chatFile); initial();
        await executeManualSummary(batch.startFloor, batch.endFloor, true, { sourceChat: { chatFile, chat } });
      } catch (error) { initial(); toastr.warning('聊天文件 ' + chatFile + ' 的补总结未完成，待处理位置已保留：' + error.message); }
    }
    return;
  }
  const currentChatLength = context.chat.length;
  const retentionCount = settings.historiographyRetentionCount ?? 5;
  const summarizableLength = currentChatLength - retentionCount;
  const unsummarizedCount = summarizableLength - characterCount;

  if (unsummarizedCount >= threshold) {
    const batchSize = threshold;
    const startFloor = characterCount + 1;
    const endFloor = startFloor + batchSize - 1;
    
    console.log(`[大史官] 自动小总结已触发，处理 ${startFloor} 至 ${endFloor} 楼。`);
    await executeManualSummary(startFloor, endFloor, true);
  }
}

export async function getAvailableWorldbooks() {
  return [...world_names];
}

export async function getLoresForWorldbook(bookName) {
  if (!bookName) return [];
  try {
    const bookData = await loadWorldInfo(bookName);
    if (!bookData || !bookData.entries) return [];
    return Object.entries(bookData.entries)
      .filter(([, entry]) => entry && typeof entry === 'object' && !entry.disable)
      .map(([key, entry]) => ({
        key: key,
        comment: entry.comment || "无标题条目",
      }));
  } catch (error) {
    console.error(`[大史官] 检阅《${bookName}》时出错:`, error);
    return [];
  }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export async function executeManualSummary(startFloor, endFloor, isAuto = false, options = {}) {
    const key = JSON.stringify([getMemoryStoryContext().story?.id || chatKey(getContext()), options.sourceChat?.chatFile ?? getContext().chatId ?? getContext().getCurrentChatId?.()]);
    if (smallSummaryTasks.has(key)) { toastr.info('这份剧情已有小总结任务正在处理。'); return false; }
    smallSummaryTasks.add(key);
    try { return await performManualSummary(startFloor, endFloor, isAuto, options); }
    catch (error) { toastr.error(error.message, '小总结未完成，原文与待处理进度保留'); return false; }
    finally { smallSummaryTasks.delete(key); }
}

async function performManualSummary(startFloor, endFloor, isAuto = false, { silent = false, sourceChat = null } = {}) {
    silent = silent || !!extension_settings[extensionName].historiographySilent;
    if (isMemoryRecovering()) return false;
    if (getMemoryStoryContext().story?.archived) { toastr.warning('当前剧情已归档，请新建聊天开始新剧情，或先回溯归档。'); return false; }
    const origin = sourceChat || { chatFile: getContext().chatId ?? getContext().getCurrentChatId?.() ?? getContext().chat_filename, chat: getContext().chat };
    const length = origin.chat.length;
    if(!Number.isInteger(startFloor)||!Number.isInteger(endFloor)||startFloor<1||endFloor<startFloor||endFloor>length){toastr.warning('请选择有效的起止楼层。');return false;}
    const assertContext = captureMemoryContext();
    const worldbook = await getTargetLorebookName(); assertContext();
    if (worldbook) {
        const entry = findActiveSummary(await loadWorldInfo(worldbook)); assertContext();
        syncMemoryStoryProgress(entry?.content || '');
    }
    const story = getMemoryStoryContext().story;
    const sources = [{ chatFile: origin.chatFile, localStartFloor: startFloor, localEndFloor: endFloor }];
    if (story) {
        const file = story.files[origin.chatFile];
        if (!file || startFloor !== Math.max(file.summarizedThrough, file.skipThrough || 0) + 1) throw new Error('请从这个聊天文件尚未总结的楼层开始，已保存的内容不会重复写入。');
    }
    const source = { ...origin, sources, storyId: story?.id, fingerprint: storyChatFingerprint(origin.chat, startFloor, endFloor) };
    const success = await new Promise((resolve) => { (async () => {
        const toastTitle = isAuto ? "小总结 (自动)" : "小总结 (手动)";
        const context = getContext();
        
        if (isAuto || silent) {
            const messages = getRawMessagesForSummary(startFloor, endFloor, source);
            if (!messages || messages.length === 0) {
                toastr.warning("自动总结：未找到符合条件的消息。", toastTitle);
                return resolve(false);
            }
            const textToSummarize = messages.map(m => `${summarySourceLabel(m)} ${m.author}: ${m.content}`).join('\n');
            const summary = await getSummary(textToSummarize, toastTitle);
            assertContext();
            if (summary && (silent || extension_settings[extensionName].historiographySilent)) {
                return resolve(await writeSummary(summary,startFloor,endFloor,toastTitle,assertContext,source));
            }
            
            if (summary) {
                showSummaryModal(summary, {
                    isSilent: () => !!extension_settings[extensionName].historiographySilent,
                    onConfirm: async (finalSummary) => {
                        const success = await writeSummary(finalSummary, startFloor, endFloor, toastTitle, assertContext, source);
                        return success;
                    },
                    onSaved: () => resolve(true),
                    onRegenerate: async (summaryDialog, regeneration) => {
                        assertContext();
                        const result = await getSummary(textToSummarize, toastTitle, 0, regeneration);
                        assertContext(); return result;
                    },
                    onCancel: () => {
                        toastr.info("本批次总结已取消。", toastTitle);
                        resolve(false);
                    },
                });
            } else {
                resolve(false);
            }
            return;
        }

        const messages = getRawMessagesForSummary(startFloor, endFloor, source);
        if (!messages || messages.length === 0) {
            toastr.warning("选定的楼层范围内无有效对话或内容被规则排除。", "设置有误");
            return resolve(false);
        }

        const generateModalHtml = (msgList) => {
            const messageHtml = msgList.map(msg => `
                <details class="historiography-message-item" data-author-type="${msg.authorType}">
                    <summary>${escapeHtml(summarySourceLabel(msg))} ${escapeHtml(msg.author)}</summary>
                    <div class="historiography-editor-container">
                        <textarea class="text_pole" data-floor="${msg.floor}">${escapeHtml(msg.content)}</textarea>
                    </div>
                </details>
            `).join('');

            return `
                <div id="historiography-preview-controls">
                    <label><input type="checkbox" id="hist-include-user" checked> ${escapeHtml(context.name1 || '用户')}</label>
                    <label><input type="checkbox" id="hist-include-char" checked> ${escapeHtml(context.name2 || '角色')}</label>
                </div>
                <div id="historiography-preview-container">${messageHtml}</div>

            `;
        };

        const modalHtml = generateModalHtml(messages);

        showHtmlModal('原文预览与编辑', modalHtml, {
            background: true,
            shouldReopen: () => !extension_settings[extensionName].historiographySilent,
            okText: '确认原文并总结',
            cancelText: '取消',
            onOpen: (dialog) => {
                const userCheckbox = dialog.find('#hist-include-user');
                const charCheckbox = dialog.find('#hist-include-char');
                const container = dialog.find('#historiography-preview-container');

                const updateVisibility = () => {
                    const includeUser = userCheckbox.is(':checked');
                    const includeChar = charCheckbox.is(':checked');
                    container.find('.historiography-message-item').each(function() {
                        const item = $(this);
                        const authorType = item.data('author-type');
                        const shouldBeHidden = (authorType === 'user' && !includeUser) || (authorType === 'char' && !includeChar);
                        item.toggle(!shouldBeHidden);
                    });
                };

                userCheckbox.on('change', updateVisibility);
                charCheckbox.on('change', updateVisibility);
            },
            onOk: async (dialog) => {
                const includeUser = dialog.find('#hist-include-user').is(':checked');
                const includeChar = dialog.find('#hist-include-char').is(':checked');
                
                const textToSummarize = dialog.find('.historiography-message-item')
                    .filter(function() {
                        const authorType = $(this).data('author-type');
                        if (authorType === 'user' && !includeUser) return false;
                        if (authorType === 'char' && !includeChar) return false;
                        return true;
                    })
                    .find('textarea')
                    .map(function() {
                        const floor = $(this).data('floor');
                        const source = messages.find(message => message.floor === Number(floor));
                        if (!source) throw new Error('原文来源已变化，请重新打开预览。');
                        return `${summarySourceLabel(source)} ${source.author}: ${$(this).val()}`;
                    }).get().join('\n');

                if (!textToSummarize.trim()) {
                    toastr.error("请至少选择一条消息进行总结！", "设置有误");
                    return false;
                }
                
                assertContext();
                const summary = await getSummary(textToSummarize, toastTitle);
                assertContext();
                if (summary) {
                    if (dialog[0].open) dialog[0].close();
                    dialog.remove();
                    showSummaryModal(summary, {
                        isSilent: () => !!extension_settings[extensionName].historiographySilent,
                        onConfirm: async (finalSummary) => {
                            const success = await writeSummary(finalSummary, startFloor, endFloor, toastTitle, assertContext, source);
                            return success;
                        },
                        onSaved: () => resolve(true),
                        onRegenerate: async (summaryDialog, regeneration) => {
                        assertContext();
                        const result = await getSummary(textToSummarize, toastTitle, 0, regeneration);
                        assertContext(); return result;
                    },
                    onCancel: () => {
                            toastr.info("本批次总结已取消。", "操作已取消");
                            resolve(false);
                        },
                    });
                }
                return !!summary;
            },
            onCancel: () => {
                toastr.info("操作已取消。", toastTitle);
                resolve(false);
            }
        });
    })().catch(error => { toastr.error(error.message,'总结失败'); resolve(false); }); });
    // Close the small-summary preview before opening an automatic large preview.
    if (success && (extension_settings[extensionName].historiographyWriteToLorebook ?? true)) {
        try { await maybeTriggerAutomaticRefinement(await getTargetLorebookName(), assertContext, { silent }); }
        catch (error) { toastr.warning(`小总结已保存，自动大总结未完成：${error.message}`); }
    }
    return success;
}

function getRawMessagesForSummary(startFloor, endFloor, source = null) {
    const context = getContext();
    const chat = source?.chat || context.chat;
    const settings = extension_settings[extensionName];
    const chatFile = source?.chatFile ?? context.getCurrentChatId?.() ?? context.chatId ?? context.chat_filename ?? '当前聊天';

    const historySlice = chat.slice(startFloor - 1, endFloor);
    if (historySlice.length === 0) return null;

    const userName = context.name1 || '用户';
    const characterName = context.name2 || '角色';
    
    const useTagExtraction = settings.historiographyTagExtractionEnabled ?? false;
    const tagsToExtract = useTagExtraction ? (settings.historiographyTags || '').split(',').map(t => t.trim()).filter(Boolean) : [];
    const exclusionRules = settings.historiographyExclusionRules || [];

    const messages = historySlice.map((msg, index) => {
        let content = msg.mes;

        if (useTagExtraction && tagsToExtract.length > 0) {
            const blocks = extractBlocksByTags(content, tagsToExtract);
            if (blocks.length > 0) {
                content = blocks.join('\n\n');
            }
        }

        content = applyExclusionRules(content, exclusionRules);
        
        if (!content.trim()) return null;

        return {
            floor: startFloor + index,
            localFloor: startFloor + index,
            chatFile,
            author: msg.is_user ? userName : characterName,
            authorType: msg.is_user ? 'user' : 'char',
            content: content.trim()
        };
    }).filter(Boolean);

    return messages;
}

function summarySourceLabel(message) {
    return `【来源文件 ${JSON.stringify(String(message.chatFile))}｜第 ${message.localFloor} 楼】`;
}

async function getSummary(formattedHistory, toastTitle, retryCount = 0, regeneration = {}) {
    toastr.info(`正在生成小总结…`, toastTitle);
    const settings = extension_settings[extensionName];
    const presetPrompts = await getPresetPrompts('small_summary');
    
    // 获取混合排序
    let mixedOrder;
    try {
        const savedOrder = localStorage.getItem('amily2_prompt_presets_v2_mixed_order');
        if (savedOrder) {
            mixedOrder = JSON.parse(savedOrder);
        }
    } catch (e) {
        console.error("[大史官] 加载混合顺序失败:", e);
    }
    const order = getMixedOrder('small_summary') || [];

    const messages = [
        { role: 'system', content: generateRandomSeed() },
        { role: 'system', content: '原文按聊天文件区分，每个文件的楼层独立从1开始。引用消息时必须同时保留来源文件和该文件的楼层；B文件第1楼与C文件第1楼是不同消息，不要把不同文件的楼层相加。' }
    ];
    
    // 根据混合排序添加提示词
    let promptCounter = 0; // 用于跟踪已处理的提示词数量
    
    for (const item of order) {
        if (item.type === 'prompt') {
            // 处理普通提示词 - getPresetPrompts已经按照mixedOrder排序，直接按顺序使用
            if (presetPrompts && presetPrompts[promptCounter]) {
                messages.push(presetPrompts[promptCounter]);
                promptCounter++; // 递增计数器
            }
        } else if (item.type === 'conditional') {
            // 处理条件块
            switch (item.id) {
                case 'jailbreakPrompt':
                    if (settings.historiographySmallJailbreakPrompt) {
                        messages.push({ role: "system", content: settings.historiographySmallJailbreakPrompt });
                    }
                    break;
                case 'summaryPrompt':
                    if (settings.historiographySmallSummaryPrompt) {
                        messages.push({ role: "system", content: settings.historiographySmallSummaryPrompt });
                    }
                    break;
                case 'coreContent':
                    messages.push({ role: 'user', content: `请严格根据以下"对话记录"中的内容进行总结，不要添加任何额外信息。\n\n<对话记录>\n${formattedHistory}\n</对话记录>` });
                    break;
            }
        }
    }

    const bookName = await getTargetLorebookName();
    const book = bookName ? await loadWorldInfo(bookName) : null;
    const active = findActiveSummary(book);
    const reference = timelineReference(active?.content);
    if (reference) messages.push({ role: 'user', content: '以下仅作为时间连续性参照，不属于本次待总结事件；不要重复收录其中的事件。\n' + reference });
    const request = regenerationMessages(messages, regeneration.firstDraft, regeneration.requirements);
    const summary = settings.ngmsEnabled ? await callNgmsAI(request) : await callAI(request);
    console.log('[大史官-小总结] AI回复的全部内容:', summary);
    
    if (!summary || !summary.trim()) {
        const maxRetries = settings.historiographyMaxRetries ?? 2;
        if (retryCount < maxRetries) {
            console.warn(`[大史官-小总结] AI返回空内容，正在进行第 ${retryCount + 1}/${maxRetries} 次重试...`);
            toastr.warning(`AI返回空内容，正在进行第 ${retryCount + 1}/${maxRetries} 次重试...`, toastTitle);
            await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒后重试
            return await getSummary(formattedHistory, toastTitle, retryCount + 1, regeneration);
        } else {
            console.error(`[大史官-小总结] 达到最大重试次数 (${maxRetries})，总结失败。`);
            toastr.error(`达到最大重试次数 (${maxRetries})，总结失败。`, toastTitle);
            return null;
        }
    }
    
    return summary;
}

async function writeSummary(summary, startFloor, endFloor, toastTitle, assertContext = captureMemoryContext(), source = null) {
    assertContext();
    const localStartFloor = startFloor, localEndFloor = endFloor;
    const sourceContext = getContext();
    const chatFile = source?.chatFile ?? sourceContext.getCurrentChatId?.() ?? sourceContext.chatId ?? sourceContext.chat_filename ?? '当前聊天';
    const verifySource = async () => {
        assertContext();
        if (!source) return;
        if (source.storyId && source.storyId !== getMemoryStoryContext().story?.id) throw new Error('剧情已切换，本次结果未写入。');
        const raw = await readStoryChat(getContext(), chatFile); assertContext();
        if (raw.length < localEndFloor || storyChatFingerprint(raw, localStartFloor, localEndFloor) !== source.fingerprint) throw new Error('生成期间原文已修改或缺失，本次结果未写入，待总结内容保留。');
    };
    if (!summary?.trim() || RESERVED_LEDGER_STRUCTURE_REGEX.test(summary) || /<!--Memory(?:Source|Files)\s/.test(summary)) throw new Error('总结为空或包含内部标记，请修改后保存。');
    const settings = extension_settings[extensionName];
    const context = getContext();
    const shouldWriteToLorebook = settings.historiographyWriteToLorebook ?? true;
    const shouldIngestToRag = settings.historiographyIngestToRag ?? false;
    const preflightBook = await getTargetLorebookName();
    if (preflightBook) {
        const active = findActiveSummary(await loadWorldInfo(preflightBook));
        if (active?.content?.trim() && !PROGRESS_SEAL_REGEX.test(active.content)) throw new Error('旧总结缺少进度标记，原文保留；请先检查原书。');
    }

    if (!shouldWriteToLorebook && !shouldIngestToRag) {
        toastr.warning("“写入总结”和“存入向量知识库”均未启用，总结任务已完成但未保存。", toastTitle);
        return !source?.storyId;
    }

    let ragSaved = false;
    if (shouldIngestToRag) {
        try {
            let targetLorebookName;
            targetLorebookName = await getTargetLorebookName();
            if (!targetLorebookName) throw new Error('请先选择总结世界书。');

            toastr.info("正在将此份“小总结”送往向量知识库...", "向量知识库");
            const metadata = {
                bookName: targetLorebookName,
                memoryRange: { startFloor, endFloor, chatFile, localStartFloor, localEndFloor, storyId: source?.storyId, sourceRanges: source?.sources },
                entryName: `小总结 ${startFloor}-${endFloor}楼`
            };
            await verifySource();
            const result = await ingestTextToHanlinyuan(summary, 'lorebook', metadata);
            if (result.success) { ragSaved = true; toastr.success(`向量知识库已成功接收总结内容！`, "向量知识库"); }
            else throw new Error(result.error);
        } catch (ragError) {
            console.error('[翰林院] 向量化处理失败:', ragError);
            toastr.error(`送往向量知识库的内容处理失败: ${ragError.message}`, "向量知识库");
            if (!shouldWriteToLorebook) return false;
        }
    }

    if (shouldWriteToLorebook) {
        try {
            let targetLorebookName;
            targetLorebookName = await getTargetLorebookName();
            if (!targetLorebookName) throw new Error('请先选择总结世界书。');

            let expectedContent;
            const contentUpdateCallback = (oldContent) => {
                assertContext();
                const currentFile = getContext().chatId ?? getContext().getCurrentChatId?.();
                if (source && currentFile === chatFile && storyChatFingerprint(getContext().chat, localStartFloor, localEndFloor) !== source.fingerprint) throw new Error('原文已修改，本次结果未写入。');
                const previous = oldContent?.match(PROGRESS_SEAL_REGEX);
                if (source?.storyId) {
                    const story = syncMemoryStoryProgress(oldContent || '');
                    const file = story?.files[chatFile];
                    if (!file || localStartFloor !== Math.max(file.summarizedThrough, file.skipThrough || 0) + 1) throw new Error('该来源已保存或进度已变化，本次不重复写入。');
                } else if(previous && Number(previous[1]) >= startFloor)throw new Error('这个范围已包含已保存的小总结，请从尚未总结的楼层开始。');
                const newSeal = `\n\n本条勿动【前${endFloor}楼总结已完成】否则后续总结无法进行。`;
                const provenance = `来源聊天文件：${JSON.stringify(String(chatFile))}；本地第${localStartFloor}至${localEndFloor}楼。`;
                const footer = source?.storyId ? storyProgressFooter(getMemoryStoryContext().story, source.sources) + '\n\n' : '';
                const newChapter = '\n\n---\n\n【' + startFloor + '楼至' + endFloor + '楼详细总结记录】\n' + provenance + '\n' + summary;
                if (oldContent) {
                    const contentWithoutSeal = oldContent.replace(PROGRESS_SEAL_REGEX, "").replace(/<!--MemoryFiles \{[^\n]*\} -->\s*/g, "").trim();
                    return expectedContent = contentWithoutSeal + newChapter + "\n\n" + footer + newSeal;
                } else {
                    const firstChapter = `以下是依照顺序已发生剧情` + newChapter;
                    return expectedContent = firstChapter + "\n\n" + footer + newSeal;
                }
            };

            console.log('[大史官-调试] 读取到的原始设置:', {
                loreActivationMode: settings.loreActivationMode,
                loreInsertionPosition: settings.loreInsertionPosition,
                loreDepth: settings.loreDepth,
                loreKeywords: settings.loreKeywords
            });

            const optionsForNewEntry = {
                keys: (String(settings.loreKeywords || '').split(",").map(k => k.trim()).filter(Boolean)),
                isConstant: settings.loreActivationMode !== 'keyed', 
                insertion_position: settings.loreInsertionPosition,
                depth: settings.loreDepth,
            };

            console.log('[大史官-调试] 构建并传递的选项:', optionsForNewEntry);

            await verifySource();
            const success = await compatibleWriteToLorebook(
                targetLorebookName,
                findActiveSummary(await loadWorldInfo(targetLorebookName))?.comment || RUNNING_LOG_COMMENT,
                contentUpdateCallback,
                optionsForNewEntry
            );

            if (success) {
                if (source?.storyId) await confirmStoryLedgerWrite(getContext(), targetLorebookName, expectedContent, () => WorldInfo.worldInfoCache?.delete(targetLorebookName));
                assertContext();
                noteMemoryStoryProgress(endFloor, source?.sources || []);
                toastr.success(`总结已写入世界书。`, `${toastTitle} - 世界书`);
                executeAutoHide(); // 总结成功后立即触发自动隐藏
                return true;
            } else {
                WorldInfo?.worldInfoCache?.delete(targetLorebookName);
                // 错误已在 compatibleWriteToLorebook 内部处理和记录
                return false;
            }

        } catch (error) {
            console.error(`[大史官] ${toastTitle}写入国史馆失败:`, error);
            toastr.error(`写入世界书时发生错误: ${error.message}`, "世界书");
            return false;
        }
    }
    if (ragSaved) { assertContext(); noteMemoryStoryProgress(endFloor, source?.sources || []); }
    return true;
}

const CHAPTER_SEAL_REGEX = /【(?:前(\d+)楼|以上小总结)篇章编撰已完成】/;

export async function maybeTriggerAutomaticRefinement(worldbook, assertContext = captureMemoryContext(), { silent = false } = {}) {
    const every = Number(extension_settings[extensionName].historiographyLargeAutoEvery) || 0;
    if (!Number.isInteger(every) || every < 1 || every > 500 || automaticRefinements.has(worldbook)) return false;
    automaticRefinements.add(worldbook);
    try {
        assertContext();
        const book = await loadWorldInfo(worldbook); assertContext();
        const active = findActiveSummary(book);
        const found = Object.entries(book?.entries || {}).find(([,entry])=>entry===active);
        if (!found) return false;
        const [key,entry]=found, parsed=parseLedgerForRefinement(entry.content);
        if (!parsed.valid || parsed.pendingBlockCount < every) return false;
        return await executeRefinementBatches(worldbook,key,{automatic:true,blockCount:every,silent,assertContext});
    } catch(error) {
        toastr.warning(`自动大总结未完成，小总结已保留：${error.message}`); return false;
    } finally { automaticRefinements.delete(worldbook); }
}

export async function executeRefinementBatches(worldbook, loreKey, options = {}) {
    const lock = JSON.stringify([String(worldbook), String(loreKey)]);
    if (isMemoryRecovering() || refinementBatches.has(lock) || activeRefinements.has(lock)) return false;
    const configured = Number(extension_settings[extensionName].historiographyLargeAutoEvery);
    const count = Number(options.blockCount ?? (configured || 3));
    if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('每次大总结需要 1～500 份小总结。');
    const assertContext = options.assertContext || captureMemoryContext();
    refinementBatches.add(lock);
    let saved = false;
    try {
        while (true) {
            assertContext();
            const book = await loadWorldInfo(worldbook); assertContext();
            const entry = book?.entries?.[loreKey];
            if (!entry || entry.disable || !isSummaryEntry(entry)) throw new Error('活动总结条目已变化，已停止。');
            const parsed = parseLedgerForRefinement(entry.content);
            if (!parsed.valid) throw new Error('总结结构不完整，已停止，原文保留。');
            if (parsed.pendingBlockCount < count) {
                if (!saved) toastr.info(`已攒 ${parsed.pendingBlockCount} 份小总结，需要 ${count} 份才生成大总结。`, '等待完整批次');
                return saved;
            }
            const result = await executeRefinement(worldbook,loreKey,{...options,blockCount:count});
            if (!result) return saved;
            saved = true;
            assertContext();
            const updated = await loadWorldInfo(worldbook); assertContext();
            if (updated?.entries?.[loreKey]?.content === entry.content) throw new Error('大总结未确认写入，后续批次已停止。');
        }
    } finally { refinementBatches.delete(lock); }
}

export async function executeRefinement(worldbook, loreKey, options = {}) {
    if (isMemoryRecovering()) return false;
    const key = JSON.stringify([String(worldbook),String(loreKey)]);
    if (activeRefinements.has(key)) return false;
    activeRefinements.add(key);
    try { return await runRefinement(worldbook,loreKey,options); }
    finally { activeRefinements.delete(key); }
}

async function runRefinement(worldbook, loreKey, {automatic = false, blockCount, silent = false} = {}) {
    const assertContext = captureMemoryContext();
    toastr.info(`正在合并《${worldbook}》中的小总结…`, "大总结合并总结");

    try {
        const bookData = await loadWorldInfo(worldbook);
        const entry = bookData?.entries[loreKey];
        if (!entry) {
            toastr.error("找不到指定的总结条目，合并总结任务中止。", "设置有误");
            return;
        }

        const originalContent = entry.content;
        const parsedInput = parseLedgerForRefinement(originalContent);
        if (!parsedInput.valid) throw new Error('条目结构需要先恢复；未修改原文。');
        const settings = extension_settings[extensionName];
        const partition = partitionPendingMicroContent(parsedInput,blockCount ?? parsedInput.pendingBlockCount);
        if (!partition.selectedBlockCount) return false;

        const progressSealMatch = originalContent.match(PROGRESS_SEAL_REGEX);
        if (!progressSealMatch) {
            toastr.error("总结缺少【进度标记】，无法执行合并总结。", "结构异常");
            return;
        }
        const progressSeal = progressSealMatch[0];
        const totalFloors = partition.selectedEndFloor;

        const chapterSealMatch = originalContent.match(CHAPTER_SEAL_REGEX);
        let lockedContent = "";
        let contentToRefine = "";
        let oldChapterFloor = 0;

        if (chapterSealMatch) {
            const chapterSealText = chapterSealMatch[0];
            oldChapterFloor = parseInt(chapterSealMatch[1], 10);
            const contentParts = originalContent.split(chapterSealText);
            lockedContent = contentParts[0].trim();
            contentToRefine = contentParts[1].replace(PROGRESS_SEAL_REGEX, '').trim();
        } else {
            contentToRefine = originalContent.replace(PROGRESS_SEAL_REGEX, '').trim();
        }

        // Only new small summaries enter this request; old large summaries stay independent.
        contentToRefine = partition.selectedContent.replace(/<!--MemorySource \{[^\n]*\} -->\n?/g, '');
        if (!contentToRefine.trim()) {
            toastr.warning("总结条目中没有新的内容可供合并总结。", "没有新内容");
            return;
        }

        const presetPrompts = await getPresetPrompts('large_summary');

        let mixedOrder;
        try {
            const savedOrder = localStorage.getItem('amily2_prompt_presets_v2_mixed_order');
            if (savedOrder) {
                mixedOrder = JSON.parse(savedOrder);
            }
        } catch (e) {
            console.error("[大史官] 加载混合顺序失败:", e);
        }
        const order = getMixedOrder('large_summary') || [];

        
        const messages = [
            { role: 'system', content: generateRandomSeed() }
        ];
        if (parsedInput.fileProgress) messages.push({ role: 'system', content: '这些小总结可能来自不同聊天文件。每个文件的楼层独立编号，必须用“来源文件＋文件内楼层”区分，合并后保留来源文件，不要相加或改编成全局楼层。' });
 
        let promptCounter = 0; 
        
        for (const item of order) {
            if (item.type === 'prompt') {
                if (presetPrompts && presetPrompts[promptCounter]) {
                    messages.push(presetPrompts[promptCounter]);
                    promptCounter++; 
                }
            } else if (item.type === 'conditional') {
                switch (item.id) {
                    case 'jailbreakPrompt':
                        if (settings.historiographyLargeJailbreakPrompt) {
                            messages.push({ role: "system", content: settings.historiographyLargeJailbreakPrompt });
                        }
                        break;
                    case 'summaryPrompt':
                        if (settings.historiographyLargeRefinePrompt) {
                            messages.push({ role: "system", content: settings.historiographyLargeRefinePrompt });
                        }
                        break;
                    case 'coreContent':
                        messages.push({ role: "user", content: `<核心处理内容>\n\n${contentToRefine}\n\n</核心处理内容>` });
                        break;
                }
            }
        }

        const getRefinedContent = async (retryCount = 0, regeneration = {}) => {
            toastr.info("正在生成大总结…", "大总结合并总结");
            const reference = timelineReference(parsedInput.latest?.text);
            const baseMessages = reference ? [...messages, {role: 'user', content: '已有时间参照，仅用于校正时间，不要重复收录其中的事件：\n' + reference}] : messages;
            const request = regenerationMessages(baseMessages, regeneration.firstDraft, regeneration.requirements);
            const content = settings.ngmsEnabled ? await callNgmsAI(request) : await callAI(request);
            
            if (!content || !content.trim()) {
                const maxRetries = settings.historiographyMaxRetries ?? 2;
                if (retryCount < maxRetries) {
                    console.warn(`[大史官-大总结重铸] AI返回空内容，正在进行第 ${retryCount + 1}/${maxRetries} 次重试...`);
                    toastr.warning(`AI返回空内容，正在进行第 ${retryCount + 1}/${maxRetries} 次重试...`, "大总结合并总结");
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    return await getRefinedContent(retryCount + 1, regeneration);
                } else {
                    console.error(`[大史官-大总结重铸] 达到最大重试次数 (${maxRetries})，重铸失败。`);
                    toastr.error(`达到最大重试次数 (${maxRetries})，合并总结失败。`, "大总结合并总结失败");
                    return null;
                }
            }
            return content;
        };

        const initialRefinedContent = await getRefinedContent();
        if (!initialRefinedContent) {
            return; // 错误提示已在 getRefinedContent 中处理
        }

        const saveRefinement = async (editedText) => {
                    assertContext();
                    if (!editedText?.trim() || RESERVED_LEDGER_STRUCTURE_REGEX.test(editedText)) throw new Error('总结为空或包含内部进度标记，请修改后保存。');
                    const parsed = parseLedgerForRefinement(originalContent);
                    if (!parsed.valid) throw new Error('旧条目结构需要恢复，原文未修改。');
                    await saveLedgerBackup(worldbook, loreKey, entry);
                    let history = [...parsed.history, ...(parsed.latest?.text ? [parsed.latest] : [])];
                    if (extension_settings[extensionName].historiographyVectorizeSummary ?? document.getElementById('amily2_vectorize_summary_content')?.checked) {
                        history = await ingestHistory(worldbook, history, assertContext);
                    }
                    const latest = { startFloor: parsed.pendingBlocks[0]?.startFloor || oldChapterFloor + 1, endFloor: totalFloors, text: editedText.trim(), fileScoped: Boolean(parsed.fileProgress), sources: partition.sources };
                    const finalContent = renderIndependentLedger({ latest, history, pending: partition.remainingContent, progressSeal, legacyPrefix: parsed.legacyPrefix, fileProgress: parsed.fileProgress });
                    await saveLedgerIfUnchanged(worldbook, loreKey, originalContent, finalContent, assertContext);
                    reloadEditor(worldbook);
                    toastr.success(`大总结已生成，并保存到《${worldbook}》！`, "大总结合并总结完毕");
                    return true;
        };
        if (silent || settings.historiographySilent) return await saveRefinement(initialRefinedContent);
        const processLoop = async (currentRefinedContent) => {
            let settle;
            const finished = new Promise(resolve => {settle=resolve;});
            showSummaryModal(currentRefinedContent, {
                isSilent: () => !!extension_settings[extensionName].historiographySilent,
                onConfirm: async (editedText) => {
                    return await saveRefinement(editedText);
                },
                onSaved: () => settle(true),
                onRegenerate: async (dialog, regeneration) => {
                    assertContext();
                    const result = await getRefinedContent(0, regeneration);
                    assertContext(); return result;
                },
                onCancel: () => {
                    toastr.info("大总结操作已取消。", "操作已取消");
                    settle(false);
                },
            });
            return finished;
        };

        return await processLoop(initialRefinedContent);

    } catch (error) {
        console.error("[大史官] 重铸任务失败:", error);
        toastr.error(`生成大总结失败: ${error.message}`, "世界书");
        return false;
    }
}

export async function executeExpedition() {
    if (isExpeditionRunning) {
        toastr.info("批量总结正在进行，请勿重复启动。", "设置悉知");
        return;
    }

    isExpeditionRunning = true;
    manualStopRequested = false;
    document.dispatchEvent(new CustomEvent('amily2-expedition-state-change', { detail: { isRunning: true } }));

    try {
        const settings = extension_settings[extensionName];
        const context = getContext();

        let targetLorebookName = null;
        targetLorebookName = await getTargetLorebookName();
            if (!targetLorebookName) throw new Error('请先选择总结世界书。');

        const summarizedCount = await readGoldenLedgerProgress(targetLorebookName);
        const story = getMemoryStoryContext().story;
        if (story) {
            const assertContext = captureMemoryContext();
            syncMemoryStoryProgress(findActiveSummary(await loadWorldInfo(targetLorebookName))?.content || ''); assertContext();
            const size = Number(settings.historiographySmallTriggerThreshold);
            if (!Number.isInteger(size) || size < 1) throw new Error('每次总结楼层数必须是大于0的整数。');
            const chatFile = getContext().chatId ?? getContext().getCurrentChatId?.();
            let count = 0;
            while (!manualStopRequested) {
                assertContext();
                const batch = storySummaryBatch(story, chatFile, size, settings.historiographyRetentionCount ?? 5, true);
                if (!batch) break;
                if (!await executeManualSummary(batch.startFloor, batch.endFloor, false)) { manualStopRequested = true; break; }
                count++;
                if (JSON.stringify(storySummaryBatch(story, chatFile, size, settings.historiographyRetentionCount ?? 5, true)) === JSON.stringify(batch)) break;
            }
            if (!manualStopRequested) toastr.info(count ? '当前聊天已完成 ' + count + ' 批总结，其余原文继续保留。' : '当前聊天暂无达到条件的待总结内容。', '批量总结');
            return;
        }
        const retentionCount = settings.historiographyRetentionCount ?? 5;
        const totalHistory = context.chat.length;
        const summarizableLength = totalHistory - retentionCount;
        const remainingHistory = summarizableLength - summarizedCount;

        const batchSize = Number(settings.historiographySmallTriggerThreshold);
        if(!Number.isInteger(batchSize)||batchSize<1)throw new Error('每次总结楼层数必须是大于0的整数。');
        // Match automatic summaries: keep the retained tail and wait until a
        // complete batch is available. Never consume a partial final batch.
        const totalBatches = Math.floor(Math.max(0, remainingHistory) / batchSize);
        if (totalBatches === 0) {
            toastr.info(`未总结的对话尚未凑满 ${batchSize} 楼（另保留 ${retentionCount} 楼），本次不生成总结。`, "等待完整批次");
            return;
        }
        toastr.info(`开始批量总结：${totalBatches * batchSize} 层历史，分 ${totalBatches} 批次处理！不足一批的对话继续保留。`, "批量总结开始");
        let currentProgress = summarizedCount;

        for (let i = 0; i < totalBatches; i++) {
            if (manualStopRequested) {
                toastr.warning("批量总结已暂停，可以稍后继续。", "已暂停");
                break;
            }

            const startFloor = currentProgress + 1;
            const endFloor = currentProgress + batchSize;
            const toastTitle = `远征战役 (${i + 1}/${totalBatches})`;

            const delay = 2000;
            if (i > 0) {
                toastr.info(`第 ${i + 1} 批次准备中... (${delay / 1000}秒后开始)`, toastTitle);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            if (manualStopRequested) {
                toastr.warning("批量总结已暂停。", "已暂停");
                break;
            }

            const success = await executeManualSummary(startFloor, endFloor, false);
            if (success) {
                currentProgress = endFloor;
            } else {
                toastr.warning(`批量总结因第 ${i + 1} 批次任务失败而中止。`, "批量总结中止");
                manualStopRequested = true;
                break;
            }
        }

        if(!manualStopRequested) {
             toastr.success(`批量总结已完成，已总结至第 ${currentProgress} 楼；剩余 ${totalHistory - currentProgress} 楼继续保留，等待凑满下一批。`, "批量总结完毕");
        }

    } catch (error) {
        console.error("[大史官-远征失败]", error);
        toastr.error("批量总结失败，任务已停止，可以稍后继续。", "批量总结失败");
    } finally {
        isExpeditionRunning = false;
        document.dispatchEvent(new CustomEvent('amily2-expedition-state-change', { detail: { isRunning: false, manualStop: manualStopRequested } }));
    }
}

export function stopExpedition() {
    if (isExpeditionRunning) {
        manualStopRequested = true;
        toastr.info("已请求暂停，将在当前批次完成后停止。", "设置传达");
    } else {
        toastr.warning("当前没有正在运行的批量总结任务。", "设置悉知");
    }
}

export async function executeCompilation(worldbook, loreKeys) {
    if (!Array.isArray(loreKeys) || loreKeys.length === 0) {
        toastr.warning("未选择任何条目进行入库。", "设置不明");
        return { success: false, error: "No lore keys provided." };
    }

    toastr.info(`开始对《${worldbook}》中的 ${loreKeys.length} 个条目进行批量入库...`, "向量知识库入库");
    let totalSuccessCount = 0;
    let totalVectorCount = 0;
    let errors = [];

    try {
        const bookData = await loadWorldInfo(worldbook);
        if (!bookData || !bookData.entries) {
            throw new Error(`无法加载书库《${worldbook}》的数据。`);
        }

        for (const loreKey of loreKeys) {
            const entry = bookData.entries[loreKey];
            if (!entry) {
                errors.push(`条目【${loreKey}】未找到。`);
                continue;
            }

            const contentToIngest = entry.content;
            if (!contentToIngest.trim()) {
                errors.push(`条目【${entry.comment || loreKey}】内容为空。`);
                continue;
            }

            const metadata = {
                bookName: worldbook,
                entryName: entry.comment || loreKey
            };

            try {
                const ingestResult = await ingestTextToHanlinyuan(contentToIngest, 'lorebook', metadata);
                if (ingestResult.success) {
                    totalSuccessCount++;
                    totalVectorCount += ingestResult.count;
                } else {
                    errors.push(`条目【${entry.comment || loreKey}】处理失败: ${ingestResult.error}`);
                }
            } catch (ingestError) {
                errors.push(`条目【${entry.comment || loreKey}】处理时发生严重错误: ${ingestError.message}`);
            }
        }

        let finalMessage = `批量编纂完成！\n成功处理 ${totalSuccessCount} / ${loreKeys.length} 个条目，共新增 ${totalVectorCount} 条忆识。`;
        if (errors.length > 0) {
            finalMessage += `\n\n发生以下错误:\n- ${errors.join('\n- ')}`;
            toastr.warning("批量入库期间发生部分错误，详情请查看控制台。", "向量知识库");
            console.warn("[翰林院] 批量编纂错误详情:", errors);
        } else {
            toastr.success(`批量入库已完成！新增 ${totalVectorCount} 条记忆。`, "向量知识库");
        }

        return { 
            success: errors.length === 0, 
            content: finalMessage,
            totalSuccess: totalSuccessCount,
            totalVectors: totalVectorCount,
            errors: errors
        };

    } catch (error) {
        console.error("[翰林院] 批量条目入库失败:", error);
        toastr.error(`批量入库失败: ${error.message}`, "向量知识库");
        return { success: false, error: error.message };
    }
}

// ========== 史册归档与回溯系统 ==========

export async function getTargetLorebookName() {
    const settings = extension_settings[extensionName];
    const context = getContext();
    const selected = settings.historiographyWorldbookOverrides?.[chatKey(context)];
    if (selected) {
        if (!world_names.includes(selected)) throw new Error('选中的旧世界书已不存在，请重新选择，未创建新书。');
        return resolveMemoryStoryWorldbook(selected);
    }
    let targetLorebookName = null;
    switch (settings.lorebookTarget) {
        case "character_main":
            targetLorebookName = characters[context.characterId]?.data?.extensions?.world;
            break;
        case "dedicated":
            const chatIdentifier = await getChatIdentifier();
            if (!chatIdentifier || chatIdentifier === 'unknown_chat_timeout') throw new Error('无法确定聊天标识，请在世界书设置中选择旧书。');
            targetLorebookName = summaryBookName(chatIdentifier, world_names);
            break;
    }
    return resolveMemoryStoryWorldbook(targetLorebookName);
}

function archiveSnapshot(worldbook) {
 return { version: 1, visibility: captureMemoryVisibility(), knowledge: captureMemoryKnowledgeState(worldbook) };
}
async function saveArchiveBook(worldbook, book) {
 if (await saveWorldInfo(worldbook, book, true) === false) throw new Error('世界书保存失败。');
}
export async function archiveCurrentLedger() {
 if (isMemoryRecovering()) return false;
 beginMemoryRecovery();
 const assertContext = captureMemoryContext();
 try {
  const worldbook = await getTargetLorebookName();
  if (!worldbook) throw new Error('请先设置总结世界书。');
  return await withLoreLock('memory-archive:' + worldbook, async () => {
   assertContext();
   const book = structuredClone(await loadWorldInfo(worldbook)); assertContext();
   const entry = findActiveSummary(book);
   if (!entry) throw new Error('没有可归档的活动总结。');
   const originalBook = structuredClone(book);
   syncMemoryStoryProgress(entry.content);
   const progress = String(entry.content).match(PROGRESS_SEAL_REGEX);
   if (progress) noteMemoryStoryProgress(Number(progress[1]));
   const storySnapshot = await captureMemoryStoryState(); assertContext();
   if (storySnapshot) storySnapshot.archiveChat = getContext().chatId ?? getContext().getCurrentChatId?.();
   entry.amily3Archive = { ...archiveSnapshot(worldbook), version: 2, story: storySnapshot };
   entry.comment = RUNNING_LOG_COMMENT + '_归档_' + new Date().toISOString();
   entry.disable = true;
   try { await saveArchiveBook(worldbook, book); assertContext(); archiveMemoryStory(storySnapshot); }
   catch (error) {
    try { await saveArchiveBook(worldbook, originalBook); }
    catch (undoError) { throw new Error(error.message + ' 未能撤回，请检查世界书：' + undoError.message); }
    throw error;
   }
   reloadEditor(worldbook); toastr.success('已归档当前剧情的总结和向量记忆。下个新聊天会从空白开始。');
   return true;
  });
 } catch (error) { toastr.error(error.message); return false; }
 finally { endMemoryRecovery(); }
}
export async function getArchivedLedgers() {
 try {
  const worldbook = await getTargetLorebookName();
  if (!worldbook) return [];
  const story = getMemoryStoryContext().story;
  const books = new Set([worldbook, ...Object.values(getContext().extensionSettings?.['hanlinyuan-rag-core']?.chatMemoryBindings?.stories || {})
    .filter(item => item.owner === story?.owner).map(item => item.worldbook).filter(Boolean)]);
  const result = [];
  for (const name of books) {
    const book = await loadWorldInfo(name);
    for (const [key,entry] of Object.entries(book?.entries || {})) if (isArchivedSummary(entry)) {
      result.push({key: name === worldbook ? key : JSON.stringify([name,key]), comment: `${entry.comment}${entry.amily3Archive?.story?.archiveChat ? ' · ' + entry.amily3Archive.story.archiveChat : ''}`});
    }
  }
  return result.sort((a,b) => b.comment.localeCompare(a.comment));
 } catch (error) { toastr.error(error.message); return []; }
}
export async function restoreArchivedLedger(targetLoreKey) {
 let started = false;
 try {
  beginMemoryRecovery(); started = true;
  const assertContext = captureMemoryContext();
  let worldbook = await getTargetLorebookName();
  if (String(targetLoreKey).startsWith('[')) {
    const destination = JSON.parse(targetLoreKey);
    if (!Array.isArray(destination) || destination.length !== 2 || !world_names.includes(destination[0])) throw new Error('归档位置无效。');
    [worldbook, targetLoreKey] = destination;
  }
  if (!worldbook) throw new Error('请先设置总结世界书。');
  return await withLoreLock('memory-restore:' + worldbook, async () => {
   assertContext();
   const book = structuredClone(await loadWorldInfo(worldbook)); assertContext();
   let target = book?.entries?.[targetLoreKey];
   if (!isArchivedSummary(target) || !target.disable) throw new Error('请选择有效的归档总结。');
   const progressMatch = String(target.content).match(PROGRESS_SEAL_REGEX);
   if (!progressMatch) throw new Error('归档缺少总结进度，未恢复。');
   const progress = Number(progressMatch[1]);
   const snapshot = [1,2].includes(target.amily3Archive?.version) ? target.amily3Archive : null;
   const sameChat = !snapshot?.visibility || snapshot.visibility.chat === chatKey(getContext());
   if (!sameChat && !snapshot?.story) throw new Error('旧归档属于另一个聊天，请在原聊天恢复；旧格式不支持跨文件回溯。');
   const currentFile = getContext().chatId ?? getContext().getCurrentChatId?.();
   const localProgress = snapshot?.story ? (snapshot.story.files ? storySummarizedPrefix(snapshot.story, currentFile) : Math.max(0, progress - (snapshot.story.segments?.[currentFile]?.offset || 0))) : progress;
   if (sameChat) planMemoryVisibility(snapshot?.visibility, localProgress);
   const originalBook = structuredClone(book), before = { ...archiveSnapshot(worldbook), version: 2, story: await captureMemoryStoryState() };
   assertContext();
   if (before.story) before.story.archiveChat = getContext().chatId ?? getContext().getCurrentChatId?.();
   const active = findActiveSummary(book);
   if (active) {
    active.amily3Archive = before;
    active.comment = RUNNING_LOG_COMMENT + '_归档_' + new Date().toISOString();
    active.disable = true;
   }
   if (snapshot?.story) {
    target = structuredClone(target);
    const newKey = String(Math.max(0, ...Object.keys(book.entries).map(Number).filter(Number.isFinite)) + 1);
    target.uid = Number(newKey); delete target.amily3Archive;
    book.entries[newKey] = target;
   }
   target.comment = RUNNING_LOG_COMMENT; target.disable = false;
   let saved = false, vectors, storyline;
   try {
    assertContext();
    saved = true; await saveArchiveBook(worldbook, book); assertContext();
    if (snapshot?.story) storyline = restoreMemoryStory(snapshot.story);
    else vectors = restoreMemoryKnowledgeState(worldbook, snapshot?.knowledge, progress);
    if (sameChat) await restoreMemoryVisibility(snapshot?.visibility, localProgress);
    else await restoreMemoryVisibility(null, getContext().chat.length);
    assertContext();
   } catch (error) {
    const failures = [];
    try { storyline?.undo(); } catch (undoError) { failures.push(undoError.message); }
    try { vectors?.undo(); } catch (undoError) { failures.push(undoError.message); }
    if (saved) try { await saveArchiveBook(worldbook, originalBook); } catch (undoError) { failures.push(undoError.message); }
    try { assertContext(); await restoreMemoryVisibility(before.visibility, 0); } catch (undoError) { failures.push(undoError.message); }
    if (failures.length) throw new Error(error.message + ' 部分状态未能撤回，请检查总结和楼层显示：' + failures.join('；'));
    throw error;
   }
   reloadEditor(worldbook);
   toastr.success('已恢复总结、相关知识库选择和楼层显示。' + (snapshot ? '' : '旧归档按总结进度恢复；无法确认范围的相关旧库已停用。'));
   return true;
  });
 } catch (error) { toastr.error(error.message); return false; }
 finally { if (started) endMemoryRecovery(); }
}

async function ingestHistory(worldbook, history, assertContext) {
 const remaining = [];
 for (const block of history) {
  assertContext();
  try {
   const result = await ingestTextToHanlinyuan(block.fileScoped ? formatFileSummarySources(block.sources) + '\n' + block.text : block.text, 'lorebook', { bookName: worldbook, entryName: block.fileScoped ? `大总结 ${block.sources?.map(source => source.chatFile + ':' + source.startFloor + '-' + source.endFloor).join('；')}` : `大总结 ${block.startFloor}-${block.endFloor}楼`, memoryRange: block.fileScoped ? { sourceFiles: block.sources } : { startFloor: block.startFloor, endFloor: block.endFloor } });
   if (!result?.success || !(result.count > 0)) throw new Error(result?.error || '没有成功入库的分块');
  } catch (error) { remaining.push(block); toastr.warning(`历史总结保留：${error.message}`); }
 }
 return remaining;
}
export async function vectorizeRetainedLedgerHistory(worldbook, loreKey) {
 const assertContext = captureMemoryContext();
 const book = await loadWorldInfo(worldbook), entry = book?.entries?.[loreKey];
 if (!entry) throw new Error('未找到总结条目');
 const source = entry.content, parsed = parseLedgerForRefinement(source);
 if (!parsed.valid || !parsed.latest) throw new Error('此条目不是可识别的单条目总结');
 if (!parsed.history.length) { toastr.info('没有待入库的历史大总结'); return; }
 await saveLedgerBackup(worldbook, loreKey, entry);
 const history = await ingestHistory(worldbook, parsed.history, assertContext);
 const content = renderIndependentLedger({ latest: parsed.latest, history, pending: parsed.pendingMicroContent, progressSeal: parsed.progressSeal, legacyPrefix: parsed.legacyPrefix, fileProgress: parsed.fileProgress });
 await saveLedgerIfUnchanged(worldbook, loreKey, source, content, assertContext);
 reloadEditor(worldbook);
}
function saveLedgerIfUnchanged(bookName, key, original, content, assertContext) {
 return withLoreLock(`memory-refinement:${bookName}`, async () => {
  assertContext();
  const fresh = await loadWorldInfo(bookName);
  assertContext();
  if (fresh?.entries?.[key]?.content !== original) throw new Error('总结生成期间原条目发生变化，请重新操作。');
  fresh.entries[key].content = content;
  const saved = await saveWorldInfo(bookName, fresh, true);
  if (saved === false) throw new Error('世界书保存失败，本地备份与预览保留。');
  if (/<!--MemoryFiles /.test(content)) await confirmStoryLedgerWrite(getContext(), bookName, content, () => WorldInfo.worldInfoCache?.delete(bookName));
 });
}
function captureMemoryContext() {
 const identify = () => {
  const ctx = getContext();
  return JSON.stringify([ctx.characterId, ctx.groupId, ctx.chatId ?? ctx.getCurrentChatId?.(), extension_settings[extensionName].historiographyWorldbookOverrides?.[chatKey(ctx)], extension_settings[extensionName].lorebookTarget, characters[ctx.characterId]?.data?.extensions?.world]);
 };
 const initial = identify(), revision = getRecoveryRevision();
 return () => { if (identify() !== initial || revision !== getRecoveryRevision()) throw new Error('聊天或归档状态已变化，操作停止；原总结保留。'); };
}
