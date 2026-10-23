import { notify as toastr } from '../personal/notify.js';
import { getContext, extension_settings } from "/scripts/extensions.js";
import { SlashCommandParser } from "/scripts/slash-commands/SlashCommandParser.js";
import { extensionName } from "../utils/settings.js";
import { readGoldenLedgerProgress, getTargetLorebookName } from "./historiographer.js";
import { captureVisibility, visibilityPlan, visibilityCommands, isMemoryRecovering, getRecoveryRevision, chatKey } from '../personal/recovery.js';

export const captureMemoryVisibility = () => captureVisibility(getContext());
export const planMemoryVisibility = (snapshot, progress) => visibilityPlan(getContext(), snapshot, progress);
export async function restoreMemoryVisibility(snapshot, progress) {
    const context = getContext(), initialChat = chatKey(context);
    const desired = visibilityPlan(context, snapshot, progress);
    for (const command of visibilityCommands(context.chat, desired)) {
        if (chatKey(getContext()) !== initialChat) throw new Error('聊天已切换，楼层恢复已停止。');
        const closure = new SlashCommandParser().parse(command, false);
        if (typeof closure?.execute !== 'function') throw new Error('酒馆无法执行楼层显示指令。');
        await closure.execute();
    }
    if (chatKey(getContext()) !== initialChat || desired.some((hidden, index) => Boolean(getContext().chat[index]?.is_system) !== hidden)) throw new Error('楼层状态未能完整恢复，请重试。');
}


async function executeSlashCommand(commandString) {
    if (!commandString) return;
    try {
        console.log(`[Memory-敕令执行官] 准备执行圣谕: ${commandString}`);
        const parser = new SlashCommandParser();
        const closure = parser.parse(commandString, false);

        if (closure && typeof closure.execute === 'function') {
            await closure.execute();
            console.log(`[Memory-敕令执行官] 圣谕: "${commandString}" 已成功颁布。`);
            toastr.success(`楼层操作已执行：${commandString}`, "楼层管理");
        } else {
            const errorMsg = `无法执行楼层操作：${commandString}`;
            console.error(`[Memory-敕令执行官] ${errorMsg}`);
            toastr.error(errorMsg, "操作司紧急报告");
        }
    } catch (error) {
        console.error(`[Memory-敕令执行官] 执行圣谕 "${commandString}" 时发生意外:`, error);
        toastr.error(`执行操作失败: ${error.message}`, "操作司紧急报告");
    }
}

export async function executeAutoHide() {
    if (isMemoryRecovering()) return;
    const revision = getRecoveryRevision(), initialChat = chatKey(getContext());
    try {
        const settings = extension_settings[extensionName];
        const context = getContext();
        const chatLength = context.chat.length;
        let hideUntilIndex = -1;

        if (settings.autoHideSummarizedEnabled) {
            const targetLorebookName = await getTargetLorebookName();

            if (targetLorebookName) {
                const summarizedCount = await readGoldenLedgerProgress(targetLorebookName);
                if (summarizedCount > 0) {
                    hideUntilIndex = summarizedCount - 1;
                }
            }
        }

        if (settings.autoHideEnabled) {
            const threshold = settings.autoHideThreshold || 30;
            const thresholdHideIndex = chatLength - threshold - 1;
            if (thresholdHideIndex > hideUntilIndex) {
                hideUntilIndex = thresholdHideIndex;
            }
        }

        if (hideUntilIndex < 0) {
            return;
        }
        if (isMemoryRecovering() || revision !== getRecoveryRevision() || initialChat !== chatKey(getContext())) return;

        const commandString = `/hide 0-${hideUntilIndex}`;
        console.log(`[Memory-史册管理员] 颁布圣谕: ${commandString}`);
        const parser = new SlashCommandParser();
        const closure = parser.parse(commandString, false);

        if (closure && typeof closure.execute === 'function') {
            await closure.execute();
            console.log(`[Memory-史册管理员] 圣谕颁布成功。`);
        } else {
            console.error('[Memory-史册管理员] 致命错误：铸造出的圣谕法印无法执行！');
        }

    } catch (error) {
        console.error('[Memory-史册管理员] 执行自动隐藏律法时发生意外错误:', error);
    }
}

export async function executeManualCommand(commandType, params = {}) {
    if (isMemoryRecovering()) { toastr.info('正在恢复归档，请稍后调整楼层。'); return; }
    const { from, to } = params;

    let commandString = '';

    switch (commandType) {
        case 'unhide_all': {
            const chatLength = getContext().chat.length;
            if (chatLength > 0) {
                const lastIndex = chatLength - 1;
                commandString = `/unhide 0-${lastIndex}`;
            } else {
                toastr.info("总结为空，无需解除隐藏。", "操作司回报");
                return; 
            }
            break;
        }

        case 'manual_hide':
        case 'manual_unhide': {
            const command = commandType === 'manual_hide' ? '/hide' : '/unhide';
            if (from === '' && to !== '') {
                commandString = `${command} ${to}`;
            } else if (from !== '' && to !== '') {
                if (parseInt(from) > parseInt(to)) {
                    toastr.warning("起始层不能大于结束层", "操作司提示");
                    return;
                }
                commandString = `${command} ${from}-${to}`;
            } else {
                toastr.warning("请输入有效的楼层范围", "操作司提示");
                return;
            }
            break;
        }

        default:
            console.error(`[Memory-手动敕令司] 未知的命令类型: ${commandType}`);
            return;
    }

    await executeSlashCommand(commandString);
}
