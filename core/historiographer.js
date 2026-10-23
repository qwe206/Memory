import { beginMemoryRecovery, endMemoryRecovery, isMemoryRecovering, getRecoveryRevision, chatKey } from '../personal/recovery.js';
import { regenerationMessages } from '../personal/regeneration.js';
import { timelineReference } from '../personal/prompt-style.js';
import { notify as toastr } from '../personal/notify.js';
import { SUMMARY_NAME, isSummaryEntry, isArchivedSummary, summaryBookName, findActiveSummary } from '../personal/names.js';
import { parseLedgerForRefinement, partitionPendingMicroContent, renderIndependentLedger, RESERVED_LEDGER_STRUCTURE_REGEX, PROGRESS_SEAL_REGEX } from '../personal/ledger.js';
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
import { captureMemoryKnowledgeState, restoreMemoryKnowledgeState, ingestTextToHanlinyuan } from "./rag-processor.js";
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

const RUNNING_LOG_COMMENT = SUMMARY_NAME;


export async function readGoldenLedgerProgress(targetLorebookName) {
  if (!targetLorebookName) return 0;
  try {
    const bookData = await loadWorldInfo(targetLorebookName);
    if (!bookData || !bookData.entries) return 0;
    const ledgerEntry = findActiveSummary(bookData);
    if (!ledgerEntry) return 0;
    const match = ledgerEntry.content.match(PROGRESS_SEAL_REGEX);
    if (!match) throw new Error('旧总结缺少进度标记，未从头开始；请先检查原书。');
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
  const threshold = Number(settings.historiographySmallTriggerThreshold);
  if(!Number.isInteger(threshold)||threshold<1)throw new Error('每次总结楼层数必须是大于0的整数。');

  const context = getContext();
  let targetLorebookName = null;
  targetLorebookName = await getTargetLorebookName();

  if (!targetLorebookName) return;

  const characterCount = await readGoldenLedgerProgress(targetLorebookName);
  const currentChatLength = context.chat.length;
  const retentionCount = settings.historiographyRetentionCount ?? 5;
  const summarizableLength = currentChatLength - retentionCount;
  const unsummarizedCount = summarizableLength - characterCount;

  if (unsummarizedCount >= threshold) {
    const batchSize = threshold;
    const startFloor = characterCount + 1;
    const endFloor = characterCount + batchSize;
    
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

export async function executeManualSummary(startFloor, endFloor, isAuto = false, { silent = false } = {}) {
    silent = silent || !!extension_settings[extensionName].historiographySilent;
    if (isMemoryRecovering()) return false;
    const length = getContext().chat.length;
    if(!Number.isInteger(startFloor)||!Number.isInteger(endFloor)||startFloor<1||endFloor<startFloor||endFloor>length){toastr.warning('请选择有效的起止楼层。');return false;}
    const assertContext = captureMemoryContext();
    const success = await new Promise((resolve) => { (async () => {
        const toastTitle = isAuto ? "小总结 (自动)" : "小总结 (手动)";
        const context = getContext();
        
        if (isAuto || silent) {
            const messages = getRawMessagesForSummary(startFloor, endFloor);
            if (!messages || messages.length === 0) {
                toastr.warning("自动总结：未找到符合条件的消息。", toastTitle);
                return resolve(false);
            }
            const textToSummarize = messages.map(m => `【第 ${m.floor} 楼】 ${m.author}: ${m.content}`).join('\n');
            const summary = await getSummary(textToSummarize, toastTitle);
            assertContext();
            if (summary && (silent || extension_settings[extensionName].historiographySilent)) {
                return resolve(await writeSummary(summary,startFloor,endFloor,toastTitle,assertContext));
            }
            
            if (summary) {
                showSummaryModal(summary, {
                    isSilent: () => !!extension_settings[extensionName].historiographySilent,
                    onConfirm: async (finalSummary) => {
                        const success = await writeSummary(finalSummary, startFloor, endFloor, toastTitle, assertContext);
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

        const messages = getRawMessagesForSummary(startFloor, endFloor);
        if (!messages || messages.length === 0) {
            toastr.warning("选定的楼层范围内无有效对话或内容被规则排除。", "设置有误");
            return resolve(false);
        }

        const generateModalHtml = (msgList) => {
            const messageHtml = msgList.map(msg => `
                <details class="historiography-message-item" data-author-type="${msg.authorType}">
                    <summary>【第 ${msg.floor} 楼】 ${escapeHtml(msg.author)}</summary>
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
                        const author = $(this).closest('.historiography-message-item').find('summary').text().replace(`【第 ${floor} 楼】 `, '');
                        return `【第 ${floor} 楼】 ${author}: ${$(this).val()}`;
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
                            const success = await writeSummary(finalSummary, startFloor, endFloor, toastTitle, assertContext);
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

function getRawMessagesForSummary(startFloor, endFloor) {
    const context = getContext();
    const chat = context.chat;
    const settings = extension_settings[extensionName];

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
            author: msg.is_user ? userName : characterName,
            authorType: msg.is_user ? 'user' : 'char',
            content: content.trim()
        };
    }).filter(Boolean);

    return messages;
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
        { role: 'system', content: generateRandomSeed() }
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

async function writeSummary(summary, startFloor, endFloor, toastTitle, assertContext = captureMemoryContext()) {
    assertContext();
    if (!summary?.trim() || RESERVED_LEDGER_STRUCTURE_REGEX.test(summary)) throw new Error('总结为空或包含内部标记，请修改后保存。');
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
        return true;
    }

    if (shouldIngestToRag) {
        try {
            let targetLorebookName;
            targetLorebookName = await getTargetLorebookName();
            if (!targetLorebookName) throw new Error('请先选择总结世界书。');

            toastr.info("正在将此份“小总结”送往向量知识库...", "向量知识库");
            const metadata = {
                bookName: targetLorebookName,
                memoryRange: { startFloor, endFloor },
                entryName: `小总结 ${startFloor}-${endFloor}楼`
            };
            assertContext();
            const result = await ingestTextToHanlinyuan(summary, 'lorebook', metadata);
            if (result.success) toastr.success(`向量知识库已成功接收总结内容！`, "向量知识库");
            else throw new Error(result.error);
        } catch (ragError) {
            console.error('[翰林院] 向量化处理失败:', ragError);
            toastr.error(`送往向量知识库的内容处理失败: ${ragError.message}`, "向量知识库");
        }
    }

    if (shouldWriteToLorebook) {
        try {
            let targetLorebookName;
            targetLorebookName = await getTargetLorebookName();
            if (!targetLorebookName) throw new Error('请先选择总结世界书。');

            const contentUpdateCallback = (oldContent) => {
                assertContext();
                const previous = oldContent?.match(PROGRESS_SEAL_REGEX);
                if(previous && Number(previous[1]) >= startFloor)throw new Error('这个范围已包含已保存的小总结，请从尚未总结的楼层开始。');
                const newSeal = `\n\n本条勿动【前${endFloor}楼总结已完成】否则后续总结无法进行。`;
                const newChapter = `\n\n---\n\n【${startFloor}楼至${endFloor}楼详细总结记录】\n${summary}`;
                if (oldContent) {
                    const contentWithoutSeal = oldContent.replace(PROGRESS_SEAL_REGEX, "").trim();
                    return contentWithoutSeal + newChapter + newSeal;
                } else {
                    const firstChapter = `以下是依照顺序已发生剧情` + newChapter;
                    return firstChapter + newSeal;
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

            assertContext();
            const success = await compatibleWriteToLorebook(
                targetLorebookName,
                findActiveSummary(await loadWorldInfo(targetLorebookName))?.comment || RUNNING_LOG_COMMENT,
                contentUpdateCallback,
                optionsForNewEntry
            );

            if (success) {
                toastr.success(`总结已写入世界书。`, `${toastTitle} - 世界书`);
                executeAutoHide(); // 总结成功后立即触发自动隐藏
                return true;
            } else {
                // 错误已在 compatibleWriteToLorebook 内部处理和记录
                return false;
            }

        } catch (error) {
            console.error(`[大史官] ${toastTitle}写入国史馆失败:`, error);
            toastr.error(`写入世界书时发生错误: ${error.message}`, "世界书");
            return false;
        }
    }
    return true;
}

const CHAPTER_SEAL_REGEX = /【前(\d+)楼篇章编撰已完成】/;

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
        return await executeRefinement(worldbook,key,{automatic:true,blockCount:every,silent});
    } catch(error) {
        toastr.warning(`自动大总结未完成，小总结已保留：${error.message}`); return false;
    } finally { automaticRefinements.delete(worldbook); }
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
        contentToRefine = partition.selectedContent;
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
                    const latest = { startFloor: parsed.pendingBlocks[0]?.startFloor || oldChapterFloor + 1, endFloor: totalFloors, text: editedText.trim() };
                    const finalContent = renderIndependentLedger({ latest, history, pending: partition.remainingContent, progressSeal, legacyPrefix: parsed.legacyPrefix });
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
        return selected;
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
    return targetLorebookName;
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
   entry.amily3Archive = archiveSnapshot(worldbook);
   entry.comment = RUNNING_LOG_COMMENT + '_归档_' + new Date().toISOString();
   entry.disable = true;
   try { await saveArchiveBook(worldbook, book); }
   catch (error) {
    try { await saveArchiveBook(worldbook, originalBook); }
    catch (undoError) { throw new Error(error.message + ' 未能撤回，请检查世界书：' + undoError.message); }
    throw error;
   }
   reloadEditor(worldbook); toastr.success('已归档总结、知识库选择和楼层显示状态。');
   return true;
  });
 } catch (error) { toastr.error(error.message); return false; }
 finally { endMemoryRecovery(); }
}
export async function getArchivedLedgers() {
 try {
  const worldbook = await getTargetLorebookName();
  if (!worldbook) return [];
  const book = await loadWorldInfo(worldbook);
  return Object.entries(book?.entries || {}).filter(([,entry]) => isArchivedSummary(entry))
   .map(([key,entry]) => ({key,comment:entry.comment})).sort((a,b) => b.comment.localeCompare(a.comment));
 } catch (error) { toastr.error(error.message); return []; }
}
export async function restoreArchivedLedger(targetLoreKey) {
 let started = false;
 try {
  beginMemoryRecovery(); started = true;
  const assertContext = captureMemoryContext();
  const worldbook = await getTargetLorebookName();
  if (!worldbook) throw new Error('请先设置总结世界书。');
  return await withLoreLock('memory-restore:' + worldbook, async () => {
   assertContext();
   const book = structuredClone(await loadWorldInfo(worldbook)); assertContext();
   const target = book?.entries?.[targetLoreKey];
   if (!isArchivedSummary(target) || !target.disable) throw new Error('请选择有效的归档总结。');
   const progressMatch = String(target.content).match(PROGRESS_SEAL_REGEX);
   if (!progressMatch) throw new Error('归档缺少总结进度，未恢复。');
   const progress = Number(progressMatch[1]);
   const snapshot = target.amily3Archive?.version === 1 ? target.amily3Archive : null;
   planMemoryVisibility(snapshot?.visibility, progress); // Validate before changing anything.
   const originalBook = structuredClone(book), before = archiveSnapshot(worldbook);
   const active = findActiveSummary(book);
   if (active) {
    active.amily3Archive = before;
    active.comment = RUNNING_LOG_COMMENT + '_归档_' + new Date().toISOString();
    active.disable = true;
   }
   target.comment = RUNNING_LOG_COMMENT; target.disable = false;
   let saved = false, vectors;
   try {
    assertContext();
    saved = true; await saveArchiveBook(worldbook, book); assertContext();
    vectors = restoreMemoryKnowledgeState(worldbook, snapshot?.knowledge, progress);
    await restoreMemoryVisibility(snapshot?.visibility, progress); assertContext();
   } catch (error) {
    const failures = [];
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
   const result = await ingestTextToHanlinyuan(block.text, 'lorebook', { bookName: worldbook, entryName: `大总结 ${block.startFloor}-${block.endFloor}楼`, memoryRange: { startFloor: block.startFloor, endFloor: block.endFloor } });
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
 const content = renderIndependentLedger({ latest: parsed.latest, history, pending: parsed.pendingMicroContent, progressSeal: parsed.progressSeal, legacyPrefix: parsed.legacyPrefix });
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
 });
}
function captureMemoryContext() {
 const identify = () => {
  const ctx = getContext();
  return JSON.stringify([ctx.characterId, ctx.groupId, ctx.chatId ?? ctx.getCurrentChatId?.(), extension_settings[extensionName].historiographyWorldbookOverrides?.[chatKey(ctx)]]);
 };
 const initial = identify(), revision = getRecoveryRevision();
 return () => { if (identify() !== initial || revision !== getRecoveryRevision()) throw new Error('聊天或归档状态已变化，操作停止；原总结保留。'); };
}
