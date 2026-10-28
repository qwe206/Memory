export const PROGRESS_SEAL_REGEX =
  /本条勿动【前(\d+)楼总结已完成】否则后续总结无法进行。[\t \r\n]*$/;
export const CHAPTER_SEAL_REGEX = /【(?:前(\d+)楼|以上小总结)篇章编撰已完成】/;
export const MICRO_SUMMARY_HEADING_REGEX = /【(\d+)楼至(\d+)楼详细总结记录】/g;
export const RESERVED_LEDGER_STRUCTURE_REGEX =
  /本条勿动【前\d+楼总结已完成】否则后续总结无法进行。?|【(?:前\d+楼|以上小总结)篇章编撰已完成】|【\d+楼至\d+楼详细总结记录】|<!--MemoryFiles\s/u;
export const LEGACY_VECTORIZED_PLACEHOLDER_REGEX =
  /AI你好，以上内容为rag向量化后注入的相关剧情|前\d+楼聊天记录总结已由翰林院向量化注入|【以下内容为\d+楼以后的总结内容】/iu;
export const REFINEMENT_INPUT_RESERVE_TOKENS = 4e3;
function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10),
    normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}
export function estimateHistoriographyTokens(text) {
  const value = String(text ?? "");
  if (!value) return 0;
  let cjk = 0;
  const nonCjk = value.replace(
    /[\u3000-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu,
    () => ((cjk += 1), ""),
  );
  return cjk + Math.ceil(nonCjk.length / 2);
}
export function estimateHistoriographyMessagesTokens(messages = []) {
  return Array.isArray(messages)
    ? messages.reduce((total, message) => {
        const role = String(message?.role ?? ""),
          content = String(message?.content ?? "");
        return (
          total +
          estimateHistoriographyTokens(role) +
          estimateHistoriographyTokens(content) +
          8
        );
      }, 2)
    : 0;
}
export function normalizeRefinementLimits(settings = {}) {
  const reminderBlocks = clampInteger(
      settings.historiographyRefineReminderBlocks,
      40,
      5,
      500,
    ),
    activeMaxTokens = clampInteger(
      settings.historiographyRollingSummaryMaxTokens,
      12e3,
      1e3,
      32e3,
    );
  let inputMaxTokens = clampInteger(
    settings.historiographyRefineInputMaxTokens,
    48e3,
    4e3,
    128e3,
  );
  return (
    (inputMaxTokens = Math.max(inputMaxTokens, activeMaxTokens + 4e3)),
    (inputMaxTokens = Math.min(128e3, inputMaxTokens)),
    {
      reminderBlocks: reminderBlocks,
      inputMaxTokens: inputMaxTokens,
      activeMaxTokens: activeMaxTokens,
    }
  );
}
export function parseLedgerForRefinement(content) {
  const source = String(content ?? "").replace(/\r\n/g, '\n'),
    progressSealMatch = source.match(PROGRESS_SEAL_REGEX);
  if (!progressSealMatch)
    return {
      valid: !1,
      reason: "missing-progress-seal",
      source: source,
      progressSeal: "",
      totalFloors: 0,
      compiledFloor: 0,
      existingRollingContent: "",
      pendingMicroContent: "",
      pendingBlockCount: 0,
      pendingBlocks: [],
      requiresHistoricalRecovery: !1,
    };
  const fileProgress = source.match(/<!--MemoryFiles \{[^\n]*\} -->/)?.[0] || '';
  const progressSeal = progressSealMatch[0],
    totalFloors = Number.parseInt(progressSealMatch[1], 10) || 0,
    withoutProgress = source.replace(PROGRESS_SEAL_REGEX, "").replace(fileProgress, '').trim(),
    chapterSealMatch = withoutProgress.match(CHAPTER_SEAL_REGEX);
  let compiledFloor = 0,
    existingRollingContent = "",
    pendingMicroContent = withoutProgress;
  if (chapterSealMatch) {
    compiledFloor = Number.parseInt(chapterSealMatch[1], 10) || 0;
    const sealIndex = chapterSealMatch.index ?? -1;
    ((existingRollingContent =
      sealIndex >= 0 ? withoutProgress.slice(0, sealIndex).trim() : ""),
      (pendingMicroContent =
        sealIndex >= 0
          ? withoutProgress.slice(sealIndex + chapterSealMatch[0].length).trim()
          : ""));
  }
  const history = [];
  existingRollingContent = existingRollingContent.replace(/【历史大总结(?:｜(\d+)-(\d+)楼)?】\n([\s\S]*?)\n【历史大总结结束】/gu, (_, start, end, text) => {
    history.push({ startFloor: Number(start) || 0, endFloor: Number(end) || 0, text: text.trim(), fileScoped: !start, sources: fileSummarySources(text) }); return '';
  }).trim();
  const oldPrefix = existingRollingContent.match(/^AI你好，以上内容为rag向量化后注入的相关剧情，以下内容是已发生的剧情回顾。\s*（前(\d+)楼聊天记录总结已由翰林院向量化注入。\s*）\s*【以下内容为\1楼以后的总结内容】\s*(?:---\s*)?/u);
  const legacyPrefix = oldPrefix?.[0]?.trim() || '';
  const missingHistoryThrough = oldPrefix ? Number(oldPrefix[1]) : 0;
  if (oldPrefix) existingRollingContent = existingRollingContent.slice(oldPrefix[0].length).trim();
  const latestHeading = existingRollingContent.match(/^【最新大总结(?:｜(\d+)-(\d+)楼)?】\n/u);
  let latest = compiledFloor > 0 || latestHeading ? {
    startFloor: latestHeading ? Number(latestHeading[1]) || 0 : 1,
    endFloor: compiledFloor,
    text: latestHeading ? existingRollingContent.slice(latestHeading[0].length).trim() : existingRollingContent.replace(/^以下内容是【1楼-\d+楼】已发生(?:剧情的滚动宏史卷|的剧情回顾)。\s*---\s*/u, '').trim(),
    fileScoped: Boolean(latestHeading && !latestHeading[1]),
    sources: fileSummarySources(existingRollingContent),
  } : null;
  let malformedLegacy = Boolean(missingHistoryThrough && compiledFloor > 0 && missingHistoryThrough >= compiledFloor);
  if (latest && !latestHeading) {
    const parts = [...latest.text.matchAll(/^===【截止至第(\d+)楼的宏史卷】===[ \t]*$/gmu)];
    let from = missingHistoryThrough + 1, cursor = 0;
    for (const part of parts) {
      const end = Number(part[1]), text = latest.text.slice(cursor, part.index).trim();
      if (!text || end < from || end >= compiledFloor) { malformedLegacy = true; break; }
      history.push({ startFloor: from, endFloor: end, text });
      from = end + 1; cursor = part.index + part[0].length;
    }
    latest = { startFloor: from, endFloor: compiledFloor, text: latest.text.slice(cursor).trim() };
    if (!latest.text) malformedLegacy = true;
  }
  const pendingBlocks = Array.from(
      pendingMicroContent.matchAll(MICRO_SUMMARY_HEADING_REGEX),
      (match) => ({
        startFloor: Number.parseInt(match[1], 10) || 0,
        endFloor: Number.parseInt(match[2], 10) || 0,
        headingIndex: match.index ?? 0,
        heading: match[0],
      }),
    ),
    pendingBlockCount = pendingBlocks.length;
  MICRO_SUMMARY_HEADING_REGEX.lastIndex = 0;
  const requiresHistoricalRecovery =
    malformedLegacy || LEGACY_VECTORIZED_PLACEHOLDER_REGEX.test(withoutProgress.replace(legacyPrefix, ''));
  return {
    valid: !requiresHistoricalRecovery,
    reason: requiresHistoricalRecovery ? (malformedLegacy ? 'invalid-legacy-range' : 'legacy-vector-placeholder') : "",
    source: source,
    progressSeal: progressSeal,
    fileProgress,
    totalFloors: totalFloors,
    compiledFloor: compiledFloor,
    existingRollingContent: latest?.text || "",
    latest: latest,
    history: history,
    legacyPrefix,
    missingHistoryThrough,
    pendingMicroContent: pendingMicroContent,
    pendingBlockCount: pendingBlockCount,
    pendingBlocks: pendingBlocks,
    requiresHistoricalRecovery: requiresHistoricalRecovery,
  };
}
function findPendingBoundaryBeforeHeading(source, headingIndex) {
  if (!(headingIndex > 0)) return 0;
  const match = source
    .slice(0, headingIndex)
    .match(/(?:\r?\n){1,3}---(?:\r?\n){1,3}\s*$/u);
  return match?.index ?? headingIndex;
}
export function partitionPendingMicroContent(parsedLedger, selectedBlockCount) {
  const parsed = parsedLedger || {},
    source = String(parsed.pendingMicroContent ?? ""),
    blocks = Array.isArray(parsed.pendingBlocks) ? parsed.pendingBlocks : [],
    count = Math.max(
      0,
      Math.min(blocks.length, Number.parseInt(selectedBlockCount, 10) || 0),
    );
  if (0 === count)
    return {
      selectedBlockCount: 0,
      selectedContent: "",
      remainingContent: source,
      selectedEndFloor: Number.parseInt(parsed.compiledFloor, 10) || 0,
    };
  const nextBlock = blocks[count],
    boundary = nextBlock
      ? findPendingBoundaryBeforeHeading(source, nextBlock.headingIndex)
      : source.length;
  return {
    selectedBlockCount: count,
    selectedContent: source.slice(0, boundary),
    sources: fileSummarySources(source.slice(0, boundary)),
    remainingContent: source.slice(boundary),
    selectedEndFloor: Math.max(Number.parseInt(parsed.compiledFloor, 10) || 0,
      ...blocks.slice(0, count).map(block => Number.parseInt(block.endFloor, 10) || 0)),
  };
}
export function buildRollingRefinementInput(parsedLedger, selectedBlockCount = parsedLedger?.pendingBlockCount) {
  if (parsedLedger?.requiresHistoricalRecovery) return '';
  return partitionPendingMicroContent(parsedLedger, selectedBlockCount).selectedContent.trim();
}

export function fileSummarySources(content) {
  const sources = [...String(content || '').matchAll(/^来源聊天文件：(\"(?:\\.|[^\"\\])*\")；本地第(\d+)至(\d+)楼[。；]/gm)]
    .map(match => ({ chatFile: JSON.parse(match[1]), startFloor: Number(match[2]), endFloor: Number(match[3]) }));
  return [...new Map(sources.map(source => [JSON.stringify(source), source])).values()];
}
export function formatFileSummarySources(sources = []) {
  return sources.map(source => `来源聊天文件：${JSON.stringify(source.chatFile)}；本地第${source.startFloor}至${source.endFloor}楼。`).join('\n');
}

export function renderIndependentLedger({ latest, history = [], pending = '', progressSeal, legacyPrefix = '', fileProgress = '' }) {
  if (!latest?.text?.trim() || !progressSeal) return '';
  const body = block => {
    const text = block.text.trim(), provenance = formatFileSummarySources(block.sources);
    return block.fileScoped && provenance && !text.startsWith(provenance) ? provenance + '\n' + text : text;
  };
  const sections = [`${latest.fileScoped ? '【最新大总结】' : `【最新大总结｜${latest.startFloor}-${latest.endFloor}楼】`}\n${body(latest)}`];
  if (legacyPrefix) sections.unshift(legacyPrefix.trim());
  for (const block of history) sections.push(`${block.fileScoped ? '【历史大总结】' : `【历史大总结｜${block.startFloor}-${block.endFloor}楼】`}\n${body(block)}\n【历史大总结结束】`);
  sections.push(latest.fileScoped ? '【以上小总结篇章编撰已完成】' : `【前${latest.endFloor}楼篇章编撰已完成】`);
  if (pending.trim()) sections.push(pending.trim());
  if (fileProgress) sections.push(fileProgress);
  sections.push(progressSeal);
  return sections.join('\n\n');
}

export function buildRollingLedgerContent(summary, parsedLedger, selectedBlockCount = parsedLedger?.pendingBlockCount) {
  const parsed = parsedLedger || {};
  const partition = partitionPendingMicroContent(parsed, selectedBlockCount);
  if (!summary?.trim() || !partition.selectedBlockCount || !parsed.progressSeal) return '';
  return renderIndependentLedger({
    latest: { startFloor: parsed.pendingBlocks?.[0]?.startFloor || parsed.compiledFloor + 1, endFloor: partition.selectedEndFloor, text: summary, fileScoped: Boolean(parsed.fileProgress), sources: partition.sources },
    history: [...(parsed.history || []), ...(parsed.latest?.text ? [parsed.latest] : [])],
    pending: partition.remainingContent, progressSeal: parsed.progressSeal,
    legacyPrefix: parsed.legacyPrefix, fileProgress: parsed.fileProgress,
  });
}
export function appendMicroSummaryBlock(
  oldContent,
  summary,
  startFloor,
  endFloor,
  maxTokens,
) {
  const start = Math.max(1, Number.parseInt(startFloor, 10) || 1),
    end = Math.max(start, Number.parseInt(endFloor, 10) || start),
    budget = clampInteger(maxTokens, 48e3, 4e3, 128e3),
    source = String(oldContent ?? ""),
    newSeal = `\n\n本条勿动【前${end}楼总结已完成】否则后续总结无法进行。`,
    newChapter =
      `\n\n---\n\n【${start}楼至${end}楼详细总结记录】\n` +
      String(summary ?? "").trim(),
    content = source
      ? `${source.replace(PROGRESS_SEAL_REGEX, "").trim()}${newChapter}${newSeal}`
      : `以下是依照顺序已发生剧情${newChapter}${newSeal}`,
    estimatedTokens = estimateHistoriographyTokens(content);
  return {
    fits: estimatedTokens <= budget,
    content: content,
    estimatedTokens: estimatedTokens,
    maxTokens: budget,
  };
}
export function rollingSummaryFitsBudget(summary, maxTokens) {
  const budget = clampInteger(maxTokens, 12e3, 1e3, 32e3);
  return {
    fits: estimateHistoriographyTokens(summary) <= budget,
    estimatedTokens: estimateHistoriographyTokens(summary),
    maxTokens: budget,
  };
}
export function rollingLedgerFitsBudget(summary, parsedLedger, maxTokens, selectedBlockCount = parsedLedger?.pendingBlockCount) {
  const content = buildRollingLedgerContent(summary, parsedLedger, selectedBlockCount);
  const budget = clampInteger(maxTokens, 12000, 1000, 32000);
  const estimatedTokens = estimateHistoriographyTokens(summary);
  return { fits: Boolean(content) && estimatedTokens <= budget, content, estimatedTokens, maxTokens: budget };
}
export function containsReservedLedgerStructure(text) {
  return RESERVED_LEDGER_STRUCTURE_REGEX.test(String(text ?? "")) || /【(?:历史大总结|最新大总结)[^】]*】/u.test(String(text ?? ""));
}
