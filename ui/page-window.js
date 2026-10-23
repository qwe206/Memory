import { notify as toastr } from '../personal/notify.js';
import { messageFormatting } from '/script.js';
import { themeMemoryDialog } from '../personal/shell.js';

function loadShowdown() {
    return new Promise((resolve, reject) => {
        if (window.showdown) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/showdown/2.1.0/showdown.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}


export async function showContentModal(title, contentUrl) {
    try {

        await loadShowdown();

        const markdownContent = await $.get(contentUrl);

        const converter = new showdown.Converter({
            tables: true,
            strikethrough: true,
            ghCodeBlocks: true
        });
        const htmlContent = converter.makeHtml(markdownContent);

        const dialogHtml = `
            <dialog class="popup wide_dialogue_popup">
              <div class="popup-body">
                <h3 style="margin-top:0; color: #eee; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 10px;">
                    <i class="fas fa-book-open" style="color: #58a6ff;"></i> ${title}
                </h3>
                <div class="popup-content" style="height: 60vh; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 5px;">
                    <div class="mes_text">${htmlContent}</div>
                </div>
                <div class="popup-controls"><div class="popup-button-ok menu_button menu_button_primary interactable">朕已阅</div></div>
              </div>
            </dialog>`;

        const dialogElement = $(dialogHtml).appendTo('body');
        themeMemoryDialog(dialogElement[0]);
        const closeDialog = () => {
            dialogElement[0].close();
            dialogElement.remove();
        };
        dialogElement.find('.popup-button-ok').on('click', closeDialog);
        dialogElement[0].showModal();

    } catch (error) {
        console.error(`[Memory-翰林院] 紧急报告：加载教程内容 [${title}] 时发生意外:`, error);
        toastr.error(`无法加载教程: ${error.message}`, "向量知识库回报");
    }
}


export function showHtmlModal(title, htmlContent, options = {}) {
    const {
        okText = '确认',
        cancelText = '取消',
        onOk,
        onCancel,
        onShow,
        showCancel = true,
    } = options;

    const buttonsHtml = `
        ${showCancel ? `<button class="popup-button-cancel menu_button secondary interactable">${cancelText}</button>` : ''}
        <button class="popup-button-ok menu_button menu_button_primary interactable">${okText}</button>
    `;

    const dialogHtml = `
        <dialog class="popup wide_dialogue_popup">
          <div class="popup-body">
            <h3 style="margin-top:0; color: #eee; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 10px;">
                <i class="fas fa-edit" style="color: #58a6ff;"></i> ${title}
            </h3>
            <div class="popup-content" style="height: 60vh; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 5px;">
                ${htmlContent}
            </div>
            <div class="popup-controls" style="display: flex; justify-content: flex-end; gap: 10px;">${buttonsHtml}</div>
          </div>
        </dialog>`;

    const dialogElement = $(dialogHtml).appendTo('body');
    themeMemoryDialog(dialogElement[0]);

    let closed = false;
    const closeDialog = (confirmed = false) => {
        if (closed) return;
        closed = true;
        if (dialogElement[0].open) dialogElement[0].close();
        dialogElement.remove();
        options.onClosed?.(confirmed);
    };

    const restoreDialog = () => {
        if (closed || !dialogElement[0].isConnected) return;
        if (options.shouldReopen?.() !== false) dialogElement[0].showModal();
        else { onCancel?.(); closeDialog(); }
    };

    dialogElement.find('.popup-button-ok').on('click', async () => {
        const buttons = dialogElement.find('button');
        if (buttons.prop('disabled')) return;
        buttons.prop('disabled', true);
        try {
            const pending = onOk ? onOk(dialogElement) : true;
            if (options.background && dialogElement[0].open) dialogElement[0].close();
            const shouldClose = await pending;
            if (shouldClose !== false) closeDialog(true);
            else if (options.background) restoreDialog();
        } catch (error) {
            toastr.error(error.message, '操作失败，内容仍保留');
            if (options.background) restoreDialog();
        } finally {
            buttons.prop('disabled', false);
        }
    });

    if (showCancel) {
        dialogElement.find('.popup-button-cancel').on('click', () => {
            if (onCancel) {
                onCancel();
            }
            closeDialog();
        });
    }
    dialogElement[0].addEventListener('cancel', event => {
        event.preventDefault();
        if (dialogElement.find('button').prop('disabled')) return;
        onCancel?.(); closeDialog();
    });

    dialogElement[0].showModal();
    (onShow || options.onOpen)?.(dialogElement);
    return dialogElement; 
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

export function showSummaryModal(summaryText, callbacks) {
    const { onConfirm, onRegenerate, onCancel, onSaved, isSilent } = callbacks;
    if (isSilent?.()) {
        Promise.resolve().then(() => onConfirm?.(summaryText)).then(result => {
            if (result !== false) onSaved?.(); else onCancel?.();
        }).catch(error => { toastr.error(error.message, '总结写入失败'); onCancel?.(); });
        return;
    }

    const modalHtml = `
        <div class="historiographer-summary-modal">
            <textarea class="text_pole" style="width: 100%; height: 50vh; resize: vertical;">${escapeHtml(summaryText)}</textarea>
        </div>
    `;

    const dialogElement = showHtmlModal('预览与修订', modalHtml, {
        background: true,
        shouldReopen: () => !isSilent?.(),
        okText: '确认写入',
        cancelText: '取消写入',
        showCancel: true,
        onOk: (dialog) => {
            const editedText = dialog.find('textarea').val();
            if (onConfirm) {
                return onConfirm(editedText);
            }

        },
        onClosed: confirmed => { if (confirmed) onSaved?.(); },
        onCancel: () => {
            if (onCancel) {
                onCancel();
            }
        }
    });

    const regenerateButton = $('<button class="menu_button secondary interactable" style="margin-right: auto;">重新生成</button>');
    regenerateButton.on('click', () => {
        if (!onRegenerate) return;
        const requestDialog = showHtmlModal('重新生成', `
            <label class="am-regenerate-label">补充要求（可留空）
              <textarea class="text_pole am-regenerate-request" placeholder="例如：保留关键对话；按后面的日期重新梳理时间线。"></textarea>
            </label>
            <p class="notes am-regenerate-status">填写后结合原始输入和第一版结果修改；留空则按原始输入重新生成。</p>`, {
            okText: '重新生成', cancelText: '返回预览',
            background: true,
            onOk: async request => {
                const requirements = String(request.find('textarea').val() || '').trim();
                const editor = dialogElement.find('textarea'), previous = editor.val();
                if (dialogElement[0].open) dialogElement[0].close();
                toastr.info('正在后台重新生成，完成后将显示结果。');
                try {
                    const result = await onRegenerate(dialogElement, { requirements, firstDraft: summaryText });
                    if (!result?.trim()) throw new Error('重新生成没有返回内容，原预览已保留。');
                    editor.val(result);
                    if (isSilent?.()) {
                        if (await onConfirm?.(result) === false) throw new Error('总结写入失败，原内容仍保留。');
                        dialogElement.remove(); onSaved?.();
                    } else dialogElement[0].showModal();
                } catch (error) {
                    editor.val(previous); toastr.error(error.message, '重新生成失败');
                    if (!isSilent?.()) dialogElement[0].showModal();
                    else { dialogElement.remove(); onCancel?.(); }
                }
                return true;
            },
            onShow: request => request.find('textarea').trigger('focus'),
        });
        requestDialog.addClass('am-regenerate-dialog');
    });

    dialogElement.find('.popup-controls').prepend(regenerateButton);
    return dialogElement;
}
